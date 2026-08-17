import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect } from "vitest";
import {
  control,
  createAndSelectWorkspace,
  denFetch,
  evalIn,
  go,
  waitFor,
} from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import type { Surface } from "@openwork/cdp";
import { screenshot, validate } from "@openwork/fraimz";
import type { Shot } from "@openwork/fraimz";
import { app, eventually, needs, server, test } from "@openwork/testkit";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const ammRepoRoot = fileURLToPath(new URL("../../../ai-api-magic", import.meta.url));
const skillSource = join(repoRoot, ".opencode", "skills", "kdp-niche-research", "SKILL.md");
const defaultAmmApiBaseUrl = "http://127.0.0.1:3000";
const defaultAmmDatabaseUrl = "postgres://postgres:postgres@127.0.0.1:55432/amm_api";
const exactPrompt = "Research the Amazon.com paperback niche \"fantasy romance\" using the managed KDP capability and real provider evidence. Use at most 20 capability units, 3 search results, 3 enriched products, and 1 page. Record the validated result in one local Portfolio research project using the canonical research history, and register the final Markdown niche brief as linked evidence. Do not record a decision, create a book project or manuscript, publish, or spend beyond this research request.";
const terminalAmmStates = new Set(["succeeded", "partially_succeeded"]);
const terminalPortfolioStatusByAmmState: Record<string, string> = {
  succeeded: "completed",
  partially_succeeded: "partial",
};
const terminalSnapshotStateByAmmState: Record<string, string> = {
  succeeded: "complete",
  partially_succeeded: "partial",
};

type CapturedAmmRequest = {
  body: string;
  headers: Record<string, string>;
  method: string;
  responseBody: string;
  status: number;
  url: string;
};

type AmmRequestWitness = AsyncDisposable & {
  baseUrl: string;
  requests: CapturedAmmRequest[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} was not an object.`);
  return value;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(`${label} was not an object array.`);
  return value;
}

function recordField(value: unknown, key: string, label: string): Record<string, unknown> {
  return requireRecord(requireRecord(value, label)[key], `${label}.${key}`);
}

function recordArrayField(value: unknown, key: string, label: string): Record<string, unknown>[] {
  return records(requireRecord(value, label)[key], `${label}.${key}`);
}

function stringField(value: unknown, key: string, label: string): string {
  const field = requireRecord(value, label)[key];
  if (typeof field !== "string" || !field.trim()) throw new Error(`${label}.${key} was not a non-empty string.`);
  return field;
}

function numberField(value: unknown, key: string, label: string): number {
  const field = requireRecord(value, label)[key];
  const number = typeof field === "number" ? field : typeof field === "string" ? Number(field) : Number.NaN;
  if (!Number.isFinite(number)) throw new Error(`${label}.${key} was not numeric.`);
  return number;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return { ...value };
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = parseJson(value, "JSON object");
  return isRecord(parsed) ? { ...parsed } : {};
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} was required after needs() completed.`);
  return value;
}

function redactId(value: string): string {
  return value.length <= 8 ? "[redacted]" : `…${value.slice(-8)}`;
}

function secretFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

function assertSecretAbsent(label: string, value: string | Buffer, secret: string, fingerprint: string): void {
  const found = typeof value === "string"
    ? value.includes(secret)
    : value.indexOf(Buffer.from(secret)) !== -1;
  if (found) throw new Error(`${label} contained service-key fingerprint sha256:${fingerprint}.`);
}

function assertIdentifiersAbsent(label: string, value: unknown, identifiers: Array<{ label: string; value: string }>): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const identifier of identifiers) {
    if (identifier.value && serialized.includes(identifier.value)) {
      throw new Error(`${label} contained a forbidden ${identifier.label}.`);
    }
  }
}

function forbiddenIdentityPaths(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenIdentityPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const next = `${path}.${key}`;
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "");
    if (/^(?:tenant|org|organization|member|user|subscription|reservation|workspace|project|portfolio)(?:id|key|ref)?$/i.test(normalizedKey)) {
      found.push(next);
    }
    forbiddenIdentityPaths(child, next, found);
  }
  return found;
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[name.toLowerCase()] = value;
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
  }
  return normalized;
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.once("end", () => resolveBody(Buffer.concat(chunks)));
    request.once("error", rejectBody);
  });
}

async function startAmmRequestWitness(upstreamBaseUrl: string): Promise<AmmRequestWitness> {
  const requests: CapturedAmmRequest[] = [];
  const witnessServer = createServer((request, response) => {
    void (async () => {
      const body = await requestBody(request);
      const method = request.method ?? "GET";
      const headers = normalizeHeaders(request.headers);
      const forwardedHeaders = new Headers();
      for (const [name, value] of Object.entries(headers)) {
        if (["host", "connection", "content-length", "transfer-encoding", "accept-encoding"].includes(name)) continue;
        forwardedHeaders.set(name, value);
      }
      const target = new URL(request.url ?? "/", `${upstreamBaseUrl.replace(/\/$/, "")}/`);
      const init: RequestInit = { method, headers: forwardedHeaders, redirect: "manual" };
      if (method !== "GET" && method !== "HEAD" && body.length > 0) init.body = body;
      const upstream = await fetch(target, init);
      const responseBytes = Buffer.from(await upstream.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())) return;
        responseHeaders[name] = value;
      });
      requests.push({
        body: body.toString("utf8"),
        headers,
        method,
        responseBody: responseBytes.toString("utf8"),
        status: upstream.status,
        url: target.toString(),
      });
      response.writeHead(upstream.status, responseHeaders);
      response.end(responseBytes);
    })().catch((error: unknown) => {
      requests.push({
        body: "",
        headers: normalizeHeaders(request.headers),
        method: request.method ?? "GET",
        responseBody: "forwarding failed",
        status: 502,
        url: request.url ?? "/",
      });
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "amm_live_witness_forward_failed" }));
      if (error instanceof Error && error.name === "AbortError") return;
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    witnessServer.once("error", rejectListen);
    witnessServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = witnessServer.address();
  if (!address || typeof address === "string") throw new Error("AMM request witness did not bind a TCP port.");
  let disposed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await new Promise<void>((resolveClose, rejectClose) => witnessServer.close((error) => error ? rejectClose(error) : resolveClose()));
    },
  };
}

async function withTemporaryEnvironment<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

async function denQuery(databaseUrl: string, sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  const mysql = await import("../packages/testkit/node_modules/mysql2/promise.js");
  const connection = await mysql.createConnection(databaseUrl);
  try {
    const [rows] = await connection.query(sql, values);
    if (Array.isArray(rows)) return records(rows, "Den SQL result");
    if (isRecord(rows)) return [];
    throw new Error("Den SQL result was neither rows nor a mutation result.");
  } finally {
    await connection.end();
  }
}

async function seedLiveAmmOrganization(databaseUrl: string, organizationId: string): Promise<Record<string, unknown>> {
  const organizations = await denQuery(databaseUrl, "SELECT metadata FROM organization WHERE id = ?", [organizationId]);
  expect(organizations).toHaveLength(1);
  const metadata = jsonObject(organizations[0]?.metadata);
  const features = jsonObject(metadata.features);
  const seededMetadata = { ...metadata, features: { ...features, ammResearch: true } };
  const bucketId = `aub_${randomUUID().replaceAll("-", "").slice(0, 26)}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - 60_000);
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  await denQuery(databaseUrl, "UPDATE organization SET metadata = ? WHERE id = ?", [JSON.stringify(seededMetadata), organizationId]);
  await denQuery(
    databaseUrl,
    "INSERT INTO amm_usage_buckets (id, organization_id, limit_units, reserved_units, used_units, window_start_at, window_end_at) VALUES (?, ?, 100, 0, 0, ?, ?)",
    [bucketId, organizationId, windowStart, windowEnd],
  );
  return { bucketId, limitUnits: 100, windowStart, windowEnd };
}

const ammQueryProgram = `
import postgres from "postgres";
const query = process.argv[1];
const parameters = JSON.parse(process.argv[2] || "[]");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const rows = await sql.unsafe(query, parameters);
  process.stdout.write(JSON.stringify(rows));
} finally {
  await sql.end({ timeout: 5 });
}
`;

async function ammQuery(databaseUrl: string, sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  const result = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", ammQueryProgram, sql, JSON.stringify(values)],
    {
      cwd: ammRepoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return records(parseJson(result.stdout, "AMM PostgreSQL result"), "AMM PostgreSQL result");
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const orgs = isRecord(result.body) && Array.isArray(result.body.orgs) ? result.body.orgs.filter(isRecord) : [];
  const id = orgs[0] && typeof orgs[0].id === "string" ? orgs[0].id : "";
  if (!result.response.ok || !id) throw new Error(`Finding the seeded organization failed with HTTP ${result.response.status}.`);
  return id;
}

async function mintMcpToken(session: DenSession, orgId: string): Promise<string> {
  const result = await denFetch(session, "/v1/mcp/token", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}`, "x-openwork-org-id": orgId },
    body: JSON.stringify({}),
  });
  const token = isRecord(result.body) && typeof result.body.token === "string" ? result.body.token : "";
  if (!result.response.ok || !token.startsWith("ow_mcp_at_")) {
    throw new Error(`Minting the seeded member MCP token failed with HTTP ${result.response.status}.`);
  }
  return token;
}

let mcpRequestId = 0;
async function callTool(
  apiUrl: string,
  mcpToken: string,
  name: "search_capabilities" | "execute_capability",
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${apiUrl}/mcp/agent`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${mcpToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++mcpRequestId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP tools/call failed with HTTP ${response.status}.`);
  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error("MCP tools/call returned no SSE data frame.");
  const payload = requireRecord(parseJson(dataLine.slice(5), "MCP JSON-RPC payload"), "MCP JSON-RPC payload");
  if (payload.error) throw new Error("MCP tools/call returned a JSON-RPC error.");
  return payload.result;
}

function toolJson(result: unknown): unknown {
  const record = requireRecord(result, "MCP tool result");
  const content = Array.isArray(record.content) ? record.content : [];
  const textPart = content.find((part) => isRecord(part) && part.type === "text" && typeof part.text === "string");
  if (!isRecord(textPart) || typeof textPart.text !== "string") throw new Error("MCP tool result had no text content.");
  return parseJson(textPart.text, "MCP tool text");
}

async function installBrowserResponseWitness(surface: Surface): Promise<void> {
  const installed = await evalIn(surface, `(() => {
    if (window.__openworkKdpEvalFetchInstalled) return true;
    window.__openworkKdpEvalFetchInstalled = true;
    window.__openworkKdpEvalResponseBodies = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      void response.clone().text().then((text) => {
        window.__openworkKdpEvalResponseBodies.push(text.slice(0, 1_000_000));
        if (window.__openworkKdpEvalResponseBodies.length > 250) window.__openworkKdpEvalResponseBodies.shift();
      }).catch(() => {});
      return response;
    };
    return true;
  })()`);
  expect(installed).toBe(true);
}

async function browserSecuritySnapshot(surface: Surface): Promise<Record<string, unknown>> {
  const value = await evalIn(surface, `(() => ({
    dom: document.documentElement.outerHTML,
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
    responseBodies: Array.isArray(window.__openworkKdpEvalResponseBodies)
      ? window.__openworkKdpEvalResponseBodies
      : [],
  }))()`);
  return requireRecord(value, "browser security snapshot");
}

async function localJson(
  surface: Surface,
  workspaceId: string,
  path: string,
  capturedBodies: string[],
): Promise<unknown> {
  const raw = await evalIn(surface, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return JSON.stringify({ status: 0, text: "missing local server credentials" });
    const response = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspaceId)}) + ${JSON.stringify(path)},
      { headers: { Authorization: "Bearer " + token } },
    );
    return JSON.stringify({ status: response.status, text: await response.text() });
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  if (typeof raw !== "string") throw new Error("Local Portfolio API witness returned a non-string response.");
  const envelope = requireRecord(parseJson(raw, "Local Portfolio API envelope"), "Local Portfolio API envelope");
  const status = numberField(envelope, "status", "Local Portfolio API envelope");
  const text = typeof envelope.text === "string" ? envelope.text : "";
  capturedBodies.push(text);
  if (status < 200 || status >= 300) throw new Error(`Local Portfolio API returned HTTP ${status} for ${path}.`);
  return parseJson(text, `Local Portfolio API ${path}`);
}

async function readCloudMcpHealth(surface: Surface, workspaceId: string): Promise<Record<string, unknown>> {
  const raw = await evalIn(surface, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return JSON.stringify({ error: "missing local server credentials" });
    const response = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspaceId)}) + "/mcp/openwork-cloud/health?probe=1",
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!response.ok) return JSON.stringify({ error: "HTTP " + response.status });
    return response.text();
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  if (typeof raw !== "string") throw new Error("Cloud MCP health response was not text.");
  return requireRecord(parseJson(raw, "Cloud MCP health response"), "Cloud MCP health response");
}

function cloudMcpIsReady(health: Record<string, unknown>): boolean {
  const engine = isRecord(health.engine) ? health.engine : null;
  const tools = isRecord(health.tools) ? health.tools : null;
  const direct = tools && isRecord(tools.direct) ? tools.direct : null;
  return health.phase === "ready"
    && health.usable === true
    && engine?.status === "connected"
    && Array.isArray(tools?.present)
    && tools.present.includes("openwork-cloud_search_capabilities")
    && tools.present.includes("openwork-cloud_execute_capability")
    && Array.isArray(direct?.present)
    && direct.present.includes("search_capabilities")
    && direct.present.includes("execute_capability");
}

async function setInput(surface: Surface, label: string, value: string): Promise<boolean> {
  const result = await evalIn(surface, `(() => {
    const input = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  return result === true;
}

async function clickText(surface: Surface, text: string): Promise<boolean> {
  const result = await evalIn(surface, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => (candidate.textContent ?? "").trim() === ${JSON.stringify(text)});
    button?.click();
    return Boolean(button);
  })()`);
  return result === true;
}

async function initializePortfolioUi(surface: Surface, workspaceId: string): Promise<void> {
  await go(surface, `/workspace/${workspaceId}/portfolio`);
  await waitFor(surface, `document.body.innerText.includes("Create this workspace’s portfolio")
    || document.body.innerText.includes("KDP Live Research")`, {
    timeoutMs: 60_000,
    label: "Portfolio initialization state",
  });
  const uninitialized = await evalIn(surface, `document.body.innerText.includes("Create this workspace’s portfolio")`);
  if (uninitialized === true) {
    expect(await setInput(surface, "Portfolio name", "KDP Live Research")).toBe(true);
    expect(await clickText(surface, "Create portfolio")).toBe(true);
  }
  await waitFor(surface, `document.body.innerText.includes("KDP Live Research")`, {
    timeoutMs: 30_000,
    label: "initialized KDP Live Research Portfolio",
  });
}

async function openNewChat(surface: Surface, workspaceId: string): Promise<string> {
  await control(surface, "session.create_task");
  const listed = await control(surface, "session.list_sessions");
  const sessions = Array.isArray(listed) ? listed.filter(isRecord) : [];
  const selected = sessions.find((entry) => entry.workspace === workspaceId || entry.workspaceId === workspaceId) ?? sessions[0];
  const sessionId = selected && typeof selected.sessionId === "string" ? selected.sessionId : "";
  if (!sessionId) throw new Error("The new KDP chat did not expose a session ID.");
  await go(surface, `/workspace/${workspaceId}/session/${sessionId}`);
  await waitFor(surface, `window.__openworkControl?.listActions().some((action) =>
    action.id === "composer.set_text" && !action.disabled)`, {
    timeoutMs: 120_000,
    label: "KDP chat composer",
  });
  return sessionId;
}

async function selectKdpSkillAndSend(surface: Surface): Promise<void> {
  await control(surface, "composer.set_text", { text: exactPrompt }, { timeoutMs: 30_000 });
  await waitFor(surface, `(() => {
    const plug = document.querySelector('button[title="Commands, skills, and MCPs"]');
    if (!plug) return false;
    plug.click();
    return true;
  })()`, { timeoutMs: 30_000, label: "composer capability menu" });
  await waitFor(surface, `(() => {
    const skills = [...document.querySelectorAll("button")]
      .find((button) => (button.textContent ?? "").trim() === "Skills");
    if (!skills) return false;
    skills.click();
    return true;
  })()`, { timeoutMs: 30_000, label: "composer Skills section" });
  await waitFor(surface, `(() => {
    const row = [...document.querySelectorAll("button")]
      .find((button) => (button.textContent ?? "").includes("/kdp-niche-research"));
    if (!row) return false;
    row.click();
    return true;
  })()`, { timeoutMs: 60_000, label: "installed kdp-niche-research skill" });
  await waitFor(surface, `Boolean(document.querySelector('span[title="Skill: kdp-niche-research"]'))`, {
    timeoutMs: 15_000,
    label: "selected kdp-niche-research skill chip",
  });
  expect(await evalIn(surface, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    return Boolean(editor && (editor.innerText ?? "").includes(${JSON.stringify(exactPrompt)}));
  })()`)).toBe(true);
  await waitFor(surface, `window.__openworkControl?.listActions().some((action) =>
    action.id === "composer.send" && !action.disabled)`, {
    timeoutMs: 30_000,
    label: "enabled KDP research send action",
  });
  await control(surface, "composer.send", undefined, { timeoutMs: 30_000 });
  await waitFor(surface, `(() => {
    const messages = [...document.querySelectorAll('[data-message-role="user"]')];
    return messages.some((message) => (message.innerText ?? "").includes(${JSON.stringify(exactPrompt)}));
  })()`, { timeoutMs: 30_000, label: "exact KDP research request in chat" });
}

async function assistantTranscript(surface: Surface): Promise<string> {
  const value = await evalIn(surface, `(() => [...document.querySelectorAll('[data-message-role]')]
    .map((message) => (message.innerText ?? "").trim()).join("\n\n"))()`);
  return typeof value === "string" ? value : "";
}

async function waitForFinalAssistantReply(surface: Surface): Promise<string> {
  await waitFor(surface, `(() => {
    const stop = window.__openworkControl?.listActions().find((action) => action.id === "composer.stop");
    const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
    const latest = messages[messages.length - 1];
    return Boolean((!stop || stop.disabled) && (latest?.innerText ?? "").trim().length > 0);
  })()`, { timeoutMs: 90_000, label: "terminal KDP assistant reply" });
  const value = await evalIn(surface, `(() => {
    const messages = [...document.querySelectorAll('[data-message-role="assistant"]')];
    return (messages[messages.length - 1]?.innerText ?? "").trim();
  })()`);
  if (typeof value !== "string" || !value) throw new Error("The terminal assistant reply was empty.");
  return value;
}

async function captureVisual(surface: Surface, claims: string[], shots: Shot[]): Promise<void> {
  const shot = await screenshot(surface);
  shots.push(shot);
  await validate(shot, claims);
}

function reconstructPublicCollectionBody(operationKey: string, downstreamBody: unknown): Record<string, unknown> {
  const downstream = requireRecord(downstreamBody, "AMM downstream collection body");
  const queries = recordArrayField(downstream, "queries", "AMM downstream collection body");
  expect(queries).toHaveLength(1);
  const query = queries[0] ?? {};
  const context = recordField(query, "context", "AMM downstream query");
  const search = recordField(query, "search", "AMM downstream query");
  const enrichment = recordField(query, "enrichment", "AMM downstream query");
  const usageLimit = recordField(downstream, "usageLimit", "AMM downstream collection body");
  expect(numberField(enrichment, "topN", "AMM downstream enrichment")).toBe(
    numberField(usageLimit, "maxProducts", "AMM downstream usage limit"),
  );
  return {
    operationKey,
    evaluationTargetAsOf: stringField(downstream, "evaluationTargetAsOf", "AMM downstream collection body"),
    keyword: stringField(query, "normalizedKeyword", "AMM downstream query"),
    marketplace: stringField(context, "marketplace", "AMM downstream context"),
    language: stringField(context, "language", "AMM downstream context"),
    department: stringField(context, "department", "AMM downstream context"),
    targetFormat: stringField(context, "targetFormat", "AMM downstream context"),
    currency: stringField(context, "currency", "AMM downstream context"),
    collectionIntent: stringField(downstream, "collectionIntent", "AMM downstream collection body"),
    evidenceLevel: stringField(downstream, "evidenceLevel", "AMM downstream collection body"),
    limits: {
      maxUnits: numberField(usageLimit, "maxUnits", "AMM downstream usage limit"),
      maxProducts: numberField(usageLimit, "maxProducts", "AMM downstream usage limit"),
      maxPages: numberField(usageLimit, "maxPages", "AMM downstream usage limit"),
      searchDepth: numberField(search, "depth", "AMM downstream search"),
    },
  };
}

async function workspaceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) found.push(relative(root, absolute).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return found.sort();
}

async function scanTapeForSecret(directory: string, secret: string, fingerprint: string): Promise<void> {
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) assertSecretAbsent(`tape file ${entry.name}`, await readFile(absolute), secret, fingerprint);
    }
  }
  await visit(directory);
}

test("KDP research flows through Den and real AMM providers into the local Portfolio", async ({ evidence, place }) => {
  needs({
    model: "tool-capable",
    optIn: ["OPENWORK_EVAL_APP_SPECS", "OPENWORK_EVAL_KDP_LIVE"],
    env: [
      "DEN_TO_AMM_SERVICE_KEY",
      "DATAFORSEO_LOGIN",
      "DATAFORSEO_PASSWORD",
      "SERPAPI_API_KEY",
    ],
  });

  const serviceKey = requiredEnvironment("DEN_TO_AMM_SERVICE_KEY");
  const keyFingerprint = secretFingerprint(serviceKey);
  const model = requiredEnvironment("OPENWORK_EVAL_MODEL");
  const runMarker = `kdp-live-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const activeWorkspacePath = join("/tmp", `${runMarker}-active`);
  const alternateWorkspacePath = join("/tmp", `${runMarker}-alternate`);
  const upstreamAmmApi = process.env.AMM_API_BASE_URL?.trim() || defaultAmmApiBaseUrl;
  const ammDatabaseUrl = process.env.OPENWORK_EVAL_AMM_DATABASE_URL?.trim() || defaultAmmDatabaseUrl;
  const localApiBodies: string[] = [];
  const shots: Shot[] = [];

  await mkdir(join(activeWorkspacePath, ".opencode", "skills", "kdp-niche-research"), { recursive: true });
  await mkdir(alternateWorkspacePath, { recursive: true });
  await copyFile(skillSource, join(activeWorkspacePath, ".opencode", "skills", "kdp-niche-research", "SKILL.md"));

  await using ammWitness = await startAmmRequestWitness(upstreamAmmApi);
  await using den = await withTemporaryEnvironment("AMM_API_BASE_URL", ammWitness.baseUrl, () => server({
    place,
    org: { name: `AMM KDP Eval ${runMarker}` },
  }));
  const denDatabase = den.database;
  if (!denDatabase) throw new Error("The authoritative KDP live spec requires the local Den MySQL witness.");
  const orgId = await organizationId(den.admin);
  const seededBucket = await seedLiveAmmOrganization(denDatabase.url, orgId);
  const memberRows = await denQuery(
    denDatabase.url,
    "SELECT id AS memberId, user_id AS userId FROM member WHERE organization_id = ? AND removed_at IS NULL AND user_id IS NOT NULL ORDER BY created_at LIMIT 1",
    [orgId],
  );
  expect(memberRows).toHaveLength(1);
  const memberId = stringField(memberRows[0], "memberId", "seeded Den membership");
  const userId = stringField(memberRows[0], "userId", "seeded Den membership");
  const subscriptionRows = await denQuery(
    denDatabase.url,
    "SELECT stripe_customer_id AS customerId, stripe_subscription_id AS subscriptionId, stripe_subscription_item_id AS subscriptionItemId FROM org_subscriptions WHERE organization_id = ?",
    [orgId],
  );

  await using desktopApp = await app({ den, as: "admin", place, model });
  await installBrowserResponseWitness(desktopApp);
  const alternateWorkspace = await createAndSelectWorkspace(desktopApp, { path: alternateWorkspacePath });
  const activeWorkspace = await createAndSelectWorkspace(desktopApp, { path: activeWorkspacePath });
  const alternateBefore = await localJson(desktopApp, alternateWorkspace.workspaceId, "/portfolio", localApiBodies);
  expect(requireRecord(alternateBefore, "alternate Portfolio before research").state).toBe("uninitialized");

  const health = await eventually(() => readCloudMcpHealth(desktopApp, activeWorkspace.workspaceId), {
    within: 180_000,
    label: "openwork-cloud live KDP readiness",
    until: cloudMcpIsReady,
  });
  expect(cloudMcpIsReady(health)).toBe(true);
  evidence.fact(
    "The signed-in workspace has a healthy openwork-cloud connection",
    `The runtime health witness reported phase=${String(health.phase)}, usable=${String(health.usable)}, and connected search/execute tools for workspace ${activeWorkspace.workspaceId}.`,
    true,
  );
  await go(desktopApp, `/workspace/${activeWorkspace.workspaceId}/settings/advanced`);
  await waitFor(desktopApp, `document.body.innerText.includes("OpenWork Cloud MCP health")`, {
    timeoutMs: 30_000,
    label: "visible OpenWork Cloud MCP health",
  });
  await captureVisual(desktopApp, [
    "The OpenWork Cloud MCP health section is visible for the active workspace",
    "The cloud connection is ready and no connection failure is visible",
    "No credential, service key, or authorization token is visible",
  ], shots);

  const mcpToken = await mintMcpToken(den.admin, orgId);
  const searchResult = toolJson(await callTool(den.ref.apiUrl, mcpToken, "search_capabilities", {
    query: "kdp keyword research observations",
    limit: 20,
  }));
  const searchMatches = recordArrayField(searchResult, "matches", "Den capability search");
  const searchedNames = searchMatches.flatMap((match) => typeof match.name === "string" ? [match.name] : []);
  expect(searchedNames).toContain("startAmmKdpKeywordCollection");
  expect(searchedNames).toContain("getAmmResearchOperation");
  expect(searchedNames).toContain("getAmmKdpKeywordObservations");
  expect(searchedNames).toContain("scoreAmmKdpKeywords");
  evidence.fact(
    "Den discovery returns the native managed KDP operations",
    `The exact Den search returned start, poll, observation, and score operations, including startAmmKdpKeywordCollection.`,
    true,
  );

  await initializePortfolioUi(desktopApp, activeWorkspace.workspaceId);
  const initializedPortfolio = await localJson(desktopApp, activeWorkspace.workspaceId, "/portfolio", localApiBodies);
  expect(requireRecord(initializedPortfolio, "initialized Portfolio").state).toBe("ready");
  expect(recordField(initializedPortfolio, "snapshot", "initialized Portfolio").projects).toEqual([]);
  await openNewChat(desktopApp, activeWorkspace.workspaceId);
  await selectKdpSkillAndSend(desktopApp);
  expect(await assistantTranscript(desktopApp)).toContain(exactPrompt);
  await captureVisual(desktopApp, [
    "The exact fantasy romance managed KDP research request is visible in chat",
    "The request shows the kdp-niche-research skill and the limits of 20 units, 3 results, 3 products, and 1 page",
    "The request explicitly stops before decisions, books, manuscripts, and publication",
    "No credential, service key, or authorization token is visible",
  ], shots);

  const operationRows = await eventually(() => denQuery(
    denDatabase.url,
    `SELECT id, organization_id AS organizationId, org_membership_id AS memberId,
      operation_key AS operationKey, operation, request_digest AS requestDigest,
      amm_run_id AS ammRunId, state, reserved_units AS reservedUnits,
      actual_units AS actualUnits, provider_calls AS providerCalls,
      upstream_cost_usd AS upstreamCostUsd, completed_at AS completedAt
    FROM amm_operations WHERE organization_id = ? ORDER BY created_at`,
    [orgId],
  ), {
    within: 180_000,
    label: "one terminal Den KDP operation",
    until: (rows) => rows.some((row) => row.state === "completed"),
  });
  expect(operationRows).toHaveLength(1);
  const denOperation = operationRows[0] ?? {};
  expect(denOperation.organizationId).toBe(orgId);
  expect(denOperation.memberId).toBe(memberId);
  expect(denOperation.operation).toBe("kdp.keyword-collection");
  expect(denOperation.state).toBe("completed");
  expect(denOperation.completedAt).toBeTruthy();
  const operationId = stringField(denOperation, "id", "Den AMM operation");
  const operationKey = stringField(denOperation, "operationKey", "Den AMM operation");
  const ammRunId = stringField(denOperation, "ammRunId", "Den AMM operation");

  const ammRuns = await ammQuery(
    ammDatabaseUrl,
    `SELECT id::text, tenant_id AS "tenantId", operation, state,
      request_digest AS "requestDigest", request_body AS "requestBody",
      result_body AS "resultBody", execution_attempt AS "executionAttempt"
    FROM managed_runs WHERE id = $1`,
    [ammRunId],
  );
  expect(ammRuns).toHaveLength(1);
  const ammRun = ammRuns[0] ?? {};
  expect(ammRun.operation).toBe("kdp.keyword-collection");
  const ammState = stringField(ammRun, "state", "AMM managed run");
  expect(terminalAmmStates.has(ammState)).toBe(true);
  const ammResult = recordField(ammRun, "resultBody", "AMM managed run");
  expect(ammResult.schemaVersion).toBe("amm.kdp.managed-keyword-collection.result/v1");
  expect(ammResult.runId).toBe(ammRunId);
  if (ammState === "partially_succeeded") {
    expect(recordArrayField(ammResult, "warnings", "partial AMM KDP result").length).toBeGreaterThan(0);
  }
  const downstreamRequest = recordField(ammRun, "requestBody", "AMM managed run");
  const reconstructedRequest = reconstructPublicCollectionBody(operationKey, downstreamRequest);
  expect(reconstructedRequest).toMatchObject({
    operationKey,
    keyword: "fantasy romance",
    marketplace: "amazon.com",
    language: "en",
    department: "books",
    targetFormat: "paperback",
    currency: "USD",
    collectionIntent: "refresh",
    evidenceLevel: "standard",
    limits: {
      maxUnits: 20,
      maxProducts: 3,
      maxPages: 1,
      searchDepth: 3,
    },
  });

  const providerUsage = await ammQuery(
    ammDatabaseUrl,
    `SELECT provider, event, provider_call_status AS status, quantity,
      COALESCE(cost_usd, 0)::text AS "costUsd", settled_at AS "settledAt"
    FROM usage_events WHERE request_id = $1 AND event LIKE 'provider.call:%'
    ORDER BY created_at, id`,
    [ammRunId],
  );
  expect(providerUsage.length).toBeGreaterThanOrEqual(1);
  expect(providerUsage.some((event) => [
    "amm.provider.amazon-dataforseo",
    "amm.provider.amazon-serpapi",
  ].includes(String(event.provider)))).toBe(true);
  expect(providerUsage.every((event) => event.status !== "begun" && event.settledAt)).toBe(true);
  expect(numberField(denOperation, "providerCalls", "Den AMM operation")).toBeGreaterThanOrEqual(1);
  expect(numberField(denOperation, "upstreamCostUsd", "Den AMM operation")).toBeGreaterThanOrEqual(0);

  const ledgerRows = await denQuery(
    denDatabase.url,
    `SELECT id, operation_id AS operationId, event, quantity_units AS quantityUnits,
      provider_calls AS providerCalls, upstream_cost_usd AS upstreamCostUsd
    FROM amm_usage_ledger_entries WHERE organization_id = ? AND operation_id = ?`,
    [orgId, operationId],
  );
  expect(ledgerRows).toHaveLength(1);
  expect(ledgerRows[0]?.event).toBe("completed");
  expect(ledgerRows[0]?.operationId).toBe(operationId);
  expect(numberField(ledgerRows[0], "quantityUnits", "Den completion ledger")).toBe(numberField(denOperation, "actualUnits", "Den AMM operation"));
  const bucketRows = await denQuery(
    denDatabase.url,
    "SELECT id, reserved_units AS reservedUnits, used_units AS usedUnits FROM amm_usage_buckets WHERE organization_id = ?",
    [orgId],
  );
  expect(bucketRows).toHaveLength(1);
  expect(bucketRows[0]?.id).toBe(seededBucket.bucketId);
  expect(numberField(bucketRows[0], "reservedUnits", "Den AMM usage bucket")).toBe(0);
  expect(numberField(bucketRows[0], "usedUnits", "Den AMM usage bucket")).toBe(numberField(denOperation, "actualUnits", "Den AMM operation"));
  evidence.fact(
    "One Den operation maps to one real terminal AMM run and one reconciliation",
    `Den operation ${operationId} completed against AMM run ${redactId(ammRunId)} with state ${ammState}, ${String(denOperation.providerCalls)} provider calls, and one completion ledger event.`,
    true,
  );

  const assistantReply = await waitForFinalAssistantReply(desktopApp);
  const assistantReplyLower = assistantReply.toLowerCase();
  expect(assistantReplyLower).toContain("evidence");
  expect(assistantReplyLower).toContain("diagnostic");
  expect(assistantReplyLower).toContain("demand");
  expect(assistantReplyLower).toContain("competition");
  expect(assistantReplyLower).toMatch(/score|calculation/);
  expect(assistantReplyLower).toMatch(/human|review|approval|approve/);
  expect(assistantReply).toMatch(/20\d{2}-\d{2}-\d{2}|observed at|as of/i);
  const chatTranscript = await assistantTranscript(desktopApp);
  expect(chatTranscript).toContain(exactPrompt);
  await captureVisual(desktopApp, [
    "The terminal assistant reply visibly reports demand and competition evidence with source timing",
    "The reply visibly reports diagnostics and transparent score inputs or calculation",
    "The reply asks for an explicit human review or approval before any consequential next step",
    "No credential, service key, or authorization token is visible",
  ], shots);

  const portfolio = await eventually(() => localJson(desktopApp, activeWorkspace.workspaceId, "/portfolio", localApiBodies), {
    within: 60_000,
    label: "canonical KDP Portfolio project",
    until: (value) => {
      if (!isRecord(value) || value.state !== "ready" || !isRecord(value.snapshot) || !Array.isArray(value.snapshot.projects)) return false;
      return value.snapshot.projects.some((project) => isRecord(project) && project.kind === "research" && project.vertical === "amazon-kdp");
    },
  });
  const portfolioSnapshot = recordField(portfolio, "snapshot", "KDP Portfolio");
  const portfolioIdentity = recordField(portfolioSnapshot, "portfolio", "KDP Portfolio snapshot");
  const projects = recordArrayField(portfolioSnapshot, "projects", "KDP Portfolio snapshot");
  expect(projects).toHaveLength(1);
  const researchProjects = projects.filter((project) => project.kind === "research" && project.vertical === "amazon-kdp");
  expect(researchProjects).toHaveLength(1);
  const researchProject = researchProjects[0] ?? {};
  expect(researchProject.lifecycleStage).toBe("research");
  const projectId = stringField(researchProject, "id", "KDP research project");
  const portfolioId = stringField(portfolioIdentity, "id", "KDP Portfolio identity");

  const history = await eventually(
    () => localJson(
      desktopApp,
      activeWorkspace.workspaceId,
      `/portfolio/projects/${encodeURIComponent(projectId)}/research`,
      localApiBodies,
    ),
    {
      within: 60_000,
      label: "complete canonical KDP research history",
      until: (value) => isRecord(value)
        && Array.isArray(value.runs) && value.runs.length === 1
        && Array.isArray(value.snapshots) && value.snapshots.length === 1
        && Array.isArray(value.observations) && value.observations.length > 0
        && Array.isArray(value.evaluations) && value.evaluations.length === 1
        && Array.isArray(value.evidence) && value.evidence.length === 1,
    },
  );
  const researchRuns = recordArrayField(history, "runs", "KDP research history");
  const snapshots = recordArrayField(history, "snapshots", "KDP research history");
  const observations = recordArrayField(history, "observations", "KDP research history");
  const evaluations = recordArrayField(history, "evaluations", "KDP research history");
  const evidenceLinks = recordArrayField(history, "evidence", "KDP research history");
  const decisions = recordArrayField(history, "decisions", "KDP research history");
  expect(researchRuns).toHaveLength(1);
  const researchRun = researchRuns[0] ?? {};
  expect(researchRun.researchType).toBe("amazon-kdp.keyword-opportunity");
  expect(researchRun.status).toBe(terminalPortfolioStatusByAmmState[ammState]);
  expect(researchRun.completedAt).toBeTruthy();
  expect(snapshots).toHaveLength(1);
  const researchSnapshot = snapshots[0] ?? {};
  expect(researchSnapshot.runId).toBe(researchRun.id);
  expect(researchSnapshot.state).toBe(terminalSnapshotStateByAmmState[ammState]);
  expect(researchSnapshot.sequence).toBe(1);
  expect(researchSnapshot.sealedAt).toBeTruthy();
  expect(stringField(researchSnapshot, "canonicalPayloadDigest", "KDP research snapshot")).toMatch(/^[a-f0-9]{64}$/);
  const canonicalPayload = recordField(researchSnapshot, "canonicalPayload", "KDP research snapshot");
  expect(canonicalPayload.schemaVersion).toBe("amm.kdp.managed-keyword-collection.result/v1");
  expect(JSON.stringify(canonicalPayload).toLowerCase()).toContain("fantasy romance");
  expect(observations.length).toBeGreaterThan(0);
  for (const observation of observations) {
    expect(["string", "integer", "decimal", "boolean", "json"]).toContain(observation.valueType);
    expect(observation.canonicalValue).not.toBeUndefined();
    expect(stringField(observation, "provider", "KDP research observation")).toMatch(/^amm\.provider\./);
    expect(stringField(observation, "observedAt", "KDP research observation")).toMatch(/^20\d{2}-\d{2}-\d{2}T/);
    expect(Array.isArray(observation.evidenceRefs) && observation.evidenceRefs.length > 0).toBe(true);
    expect(stringField(observation, "observationDigest", "KDP research observation")).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(evaluations).toHaveLength(1);
  const evaluation = evaluations[0] ?? {};
  expect(evaluation.snapshotId).toBe(researchSnapshot.id);
  expect(stringField(evaluation, "policyRef", "KDP research evaluation").length).toBeGreaterThan(0);
  expect(stringField(evaluation, "engineRef", "KDP research evaluation").length).toBeGreaterThan(0);
  expect(stringField(evaluation, "requestDigest", "KDP research evaluation")).toMatch(/^[a-f0-9]{64}$/);
  expect(stringField(evaluation, "resultDigest", "KDP research evaluation")).toMatch(/^[a-f0-9]{64}$/);
  const evaluationPayloads = `${JSON.stringify(evaluation.requestPayload)} ${JSON.stringify(evaluation.resultPayload)}`.toLowerCase();
  expect(evaluationPayloads).toContain("demand");
  expect(evaluationPayloads).toContain("competition");
  expect(decisions).toEqual([]);

  const artifactsResponse = await localJson(desktopApp, activeWorkspace.workspaceId, "/portfolio/artifacts", localApiBodies);
  const artifacts = recordArrayField(artifactsResponse, "items", "KDP Portfolio artifacts");
  expect(artifacts).toHaveLength(1);
  const artifact = artifacts[0] ?? {};
  expect(artifact.projectId).toBe(projectId);
  expect(artifact.role).toBe("research-brief");
  const artifactPath = stringField(artifact, "path", "KDP research brief artifact");
  expect(isAbsolute(artifactPath)).toBe(false);
  expect(artifactPath.startsWith("../") || artifactPath.includes("/../")).toBe(false);
  const absoluteArtifactPath = resolve(activeWorkspacePath, artifactPath);
  expect(relative(activeWorkspacePath, absoluteArtifactPath).startsWith("..")).toBe(false);
  expect((await stat(absoluteArtifactPath)).isFile()).toBe(true);
  const artifactVersions = recordArrayField(artifact, "versions", "KDP research brief artifact");
  expect(artifactVersions.length).toBeGreaterThan(0);
  expect(evidenceLinks).toHaveLength(1);
  const evidenceLink = evidenceLinks[0] ?? {};
  expect(evidenceLink.snapshotId).toBe(researchSnapshot.id);
  expect(evidenceLink.artifactId).toBe(artifact.id);
  expect(artifactVersions.some((version) => version.id === evidenceLink.artifactVersionId)).toBe(true);
  const brief = await readFile(absoluteArtifactPath, "utf8");
  const briefLower = brief.toLowerCase();
  expect(briefLower).toContain("fantasy romance");
  expect(briefLower).toContain("evidence");
  expect(briefLower).toContain("demand");
  expect(briefLower).toContain("competition");
  expect(briefLower).toMatch(/score|calculation/);
  expect(briefLower).toContain("diagnostic");
  expect(briefLower).toMatch(/approval|approve|human review/);
  evidence.fact(
    "The local Portfolio preserves canonical KDP research and linked evidence",
    `Project ${projectId} owns one ${String(researchRun.status)} run, one immutable ${String(researchSnapshot.state)} snapshot, ${observations.length} typed observations, one immutable evaluation, and brief ${artifactPath} pinned to artifact version ${String(evidenceLink.artifactVersionId)}.`,
    true,
  );

  const managedStatsBefore = await ammQuery(
    ammDatabaseUrl,
    `SELECT COUNT(r.id)::int AS "managedRunCount"
    FROM idempotency_keys k LEFT JOIN managed_runs r ON r.id = k.run_id
    WHERE k.idempotency_key = $1`,
    [operationId],
  );
  const usageStatsBefore = await ammQuery(
    ammDatabaseUrl,
    `SELECT COUNT(*)::int AS "eventCount",
      COALESCE(SUM(quantity::numeric), 0)::text AS quantity,
      COALESCE(SUM(cost_usd), 0)::text AS cost
    FROM usage_events WHERE request_id = $1 AND event LIKE 'provider.call:%'`,
    [ammRunId],
  );
  const startPostsBefore = ammWitness.requests.filter((request) => request.method === "POST"
    && new URL(request.url, ammWitness.baseUrl).pathname === "/api/v1/kdp/keyword-collections").length;
  const retryResult = requireRecord(toolJson(await callTool(den.ref.apiUrl, mcpToken, "execute_capability", {
    name: "startAmmKdpKeywordCollection",
    body: reconstructedRequest,
  })), "idempotent retry result");
  expect(retryResult.operationId).toBe(operationId);
  expect(retryResult.state).toBe(ammState);
  const operationAfterRetry = await denQuery(
    denDatabase.url,
    "SELECT id, amm_run_id AS ammRunId, state FROM amm_operations WHERE organization_id = ? AND operation_key = ?",
    [orgId, operationKey],
  );
  expect(operationAfterRetry).toHaveLength(1);
  expect(operationAfterRetry[0]).toMatchObject({ id: operationId, ammRunId, state: "completed" });
  const managedStatsAfter = await ammQuery(
    ammDatabaseUrl,
    `SELECT COUNT(r.id)::int AS "managedRunCount"
    FROM idempotency_keys k LEFT JOIN managed_runs r ON r.id = k.run_id
    WHERE k.idempotency_key = $1`,
    [operationId],
  );
  const usageStatsAfter = await ammQuery(
    ammDatabaseUrl,
    `SELECT COUNT(*)::int AS "eventCount",
      COALESCE(SUM(quantity::numeric), 0)::text AS quantity,
      COALESCE(SUM(cost_usd), 0)::text AS cost
    FROM usage_events WHERE request_id = $1 AND event LIKE 'provider.call:%'`,
    [ammRunId],
  );
  expect(numberField(managedStatsBefore[0], "managedRunCount", "managed run stats before retry")).toBe(1);
  expect(managedStatsAfter).toEqual(managedStatsBefore);
  expect(usageStatsAfter).toEqual(usageStatsBefore);
  const startPostsAfter = ammWitness.requests.filter((request) => request.method === "POST"
    && new URL(request.url, ammWitness.baseUrl).pathname === "/api/v1/kdp/keyword-collections").length;
  expect(startPostsAfter).toBe(startPostsBefore);
  evidence.fact(
    "An identical execute_capability retry performs no new paid execution",
    `Retry returned Den operation ${operationId} and AMM run ${redactId(ammRunId)}; managed-run count, provider event quantity/cost, and collection POST count remained unchanged.`,
    true,
  );

  const startRequests = ammWitness.requests.filter((request) => request.method === "POST"
    && new URL(request.url, ammWitness.baseUrl).pathname === "/api/v1/kdp/keyword-collections");
  expect(startRequests).toHaveLength(1);
  const capturedStart = startRequests[0];
  if (!capturedStart) throw new Error("The AMM request witness did not capture the collection start.");
  if (capturedStart.headers.authorization !== `Bearer ${serviceKey}`) {
    throw new Error(`The AMM request bearer did not match service-key fingerprint sha256:${keyFingerprint}.`);
  }
  expect(capturedStart.headers["idempotency-key"]).toBe(operationId);
  expect(capturedStart.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  const forbiddenHeaderNames = Object.keys(capturedStart.headers).filter((name) => name !== "user-agent"
    && /(?:^|-)(?:tenant|org|organization|member|user|subscription|reservation|workspace|project|portfolio)(?:-|$)/i.test(name));
  expect(forbiddenHeaderNames).toEqual([]);
  const capturedBody = parseJson(capturedStart.body, "captured Den-to-AMM collection body");
  expect(forbiddenIdentityPaths(capturedBody)).toEqual([]);

  const corpusRows = await ammQuery(
    ammDatabaseUrl,
    `SELECT tenant_id AS "tenantId", keyword, marketplace, department, format,
      asin, metric, value, provider_id AS "providerId", evidence,
      run_id::text AS "runId", entity_type AS "entityType", entity_key AS "entityKey"
    FROM research_observations WHERE run_id = $1 ORDER BY created_at, id`,
    [ammRunId],
  );
  expect(corpusRows.length).toBeGreaterThan(0);
  const forbiddenIdentifiers = [
    { label: "Den organization identifier", value: orgId },
    { label: "Den membership identifier", value: memberId },
    { label: "Den user identifier", value: userId },
    { label: "Den usage bucket identifier", value: String(seededBucket.bucketId) },
    { label: "workspace identifier", value: activeWorkspace.workspaceId },
    { label: "alternate workspace identifier", value: alternateWorkspace.workspaceId },
    { label: "Portfolio identifier", value: portfolioId },
    { label: "Portfolio project identifier", value: projectId },
    { label: "Portfolio research-run identifier", value: String(researchRun.id) },
    { label: "Portfolio snapshot identifier", value: String(researchSnapshot.id) },
    { label: "Portfolio evaluation identifier", value: String(evaluation.id) },
    ...subscriptionRows.flatMap((row) => ["customerId", "subscriptionId", "subscriptionItemId"].flatMap((key) => (
      typeof row[key] === "string" && row[key] ? [{ label: `Den ${key}`, value: row[key] }] : []
    ))),
  ];
  assertIdentifiersAbsent("captured Den-to-AMM request headers", capturedStart.headers, forbiddenIdentifiers);
  assertIdentifiersAbsent("captured Den-to-AMM request body", capturedBody, forbiddenIdentifiers);
  assertIdentifiersAbsent("AMM global corpus rows", corpusRows, [
    ...forbiddenIdentifiers,
    { label: "Den operation identifier", value: operationId },
    { label: "Den operation key", value: operationKey },
  ]);
  expect(corpusRows.every((row) => row.tenantId === "tenant_local")).toBe(true);
  evidence.fact(
    "The real AMM boundary is service-authenticated and customer-identity-free",
    `The forwarding witness observed one authorized collection POST with Den operation idempotency and no customer identity headers/body; ${corpusRows.length} AMM corpus rows retained only the global tenant_local scope.`,
    true,
  );

  const alternateAfter = await localJson(desktopApp, alternateWorkspace.workspaceId, "/portfolio", localApiBodies);
  expect(alternateAfter).toEqual(alternateBefore);
  expect(projects.every((project) => project.kind === "research" && project.vertical === "amazon-kdp")).toBe(true);
  expect(projects.some((project) => ["publication", "promotion", "release"].includes(String(project.lifecycleStage)))).toBe(false);
  const files = await workspaceFiles(activeWorkspacePath);
  expect(files.some((file) => /(?:book|manuscript|publication|campaign)/i.test(file))).toBe(false);
  evidence.fact(
    "Research creates no decision, book, manuscript, publication, campaign, or alternate-workspace mutation",
    `The active Portfolio contains only its amazon-kdp research project with zero decisions; the alternate workspace remained ${String(requireRecord(alternateAfter, "alternate Portfolio after research").state)} and no consequential project/file appeared.`,
    true,
  );

  await go(desktopApp, `/workspace/${activeWorkspace.workspaceId}/portfolio`);
  await waitFor(desktopApp, `document.body.innerText.includes(${JSON.stringify(String(researchProject.title))})`, {
    timeoutMs: 30_000,
    label: "KDP research project in Portfolio",
  });
  expect(await clickText(desktopApp, "History")).toBe(true);
  await waitFor(desktopApp, `document.body.innerText.includes("Research history")`, {
    timeoutMs: 30_000,
    label: "KDP Research history UI",
  });
  const historyUi = await evalIn(desktopApp, `document.querySelector('[aria-label="Research history"]')?.textContent ?? ""`);
  const historyUiText = typeof historyUi === "string" ? historyUi : "";
  await captureVisual(desktopApp, [
    "Portfolio Research history visibly shows the terminal KDP run and immutable snapshot",
    "Research history visibly shows typed observations, the evaluation score, and linked brief evidence",
    "Research history visibly states that no decision has been recorded",
    "No credential, service key, or authorization token is visible",
  ], shots);

  const portfolioYaml = await readFile(join(activeWorkspacePath, "portfolio.yaml"), "utf8");
  const portfolioSqlite = await readFile(join(activeWorkspacePath, ".amm", "portfolio.sqlite"));
  const denLog = await den.apiLog();
  const appLogPath = desktopApp.handle.meta?.log;
  const appLog = appLogPath ? await readFile(appLogPath, "utf8").catch(() => "") : "";
  const browserSnapshot = await browserSecuritySnapshot(desktopApp);
  const secretSurfaces: Array<{ label: string; value: string | Buffer }> = [
    { label: "browser DOM and storage", value: JSON.stringify(browserSnapshot) },
    { label: "chat transcript", value: chatTranscript },
    { label: "Portfolio API response bodies", value: localApiBodies.join("\n") },
    { label: "Portfolio YAML", value: portfolioYaml },
    { label: "Portfolio SQLite", value: portfolioSqlite },
    { label: "canonical research history", value: JSON.stringify(history) },
    { label: "registered Markdown brief", value: brief },
    { label: "Den API log", value: denLog },
    { label: "AI Work Magic log", value: appLog },
    { label: "AMM response bodies", value: ammWitness.requests.map((request) => request.responseBody).join("\n") },
    ...shots.flatMap((shot, index) => [
      { label: `screenshot ${index + 1} visible text`, value: shot.visibleText },
      { label: `screenshot ${index + 1} PNG`, value: shot.png },
    ]),
  ];
  for (const surface of secretSurfaces) assertSecretAbsent(surface.label, surface.value, serviceKey, keyFingerprint);
  expect(denLog).toContain("/mcp/agent");
  evidence.fact(
    "The Den-to-AMM service key stays out of every user and evidence surface",
    `Browser DOM/storage/responses, chat, Portfolio YAML/SQLite/canonical history, the brief, logs, screenshots, and AMM responses were scanned with redacted fingerprint sha256:${keyFingerprint}; none contained the key.`,
    true,
  );

  expect(historyUiText).toContain(String(researchRun.status));
  expect(historyUiText).toContain(String(researchSnapshot.canonicalPayloadDigest));
  expect(historyUiText).toContain(String(evaluation.policyRef));
  expect(historyUiText).toContain(String(evaluation.resultDigest));
  expect(historyUiText).toContain(String(evidenceLink.artifactVersionId));
  expect(historyUiText).toContain("No decisions recorded yet");
  evidence.fact(
    "Portfolio Research history renders the canonical run, snapshot, observations, evaluation, and evidence link",
    `The UI rendered terminal state ${String(researchRun.status)}, snapshot digest, evaluation policy/result digest, ${observations.length} observations, pinned artifact version, and the empty decision log.`,
    true,
  );

  await evidence.close();
  await scanTapeForSecret(evidence.dir, serviceKey, keyFingerprint);
});
