import process from "node:process";
import { pathToFileURL } from "node:url";

export const REQUIRED_ENDPOINTS = [
  "http://127.0.0.1:3000/api/v1/health",
  "http://127.0.0.1:3000/api/v1/ready",
  "http://127.0.0.1:8790/health",
  "http://127.0.0.1:8790/ready",
];

export const REQUIRED_SECRETS = [
  {
    name: "DEN_TO_AMM_SERVICE_KEY",
    isPresent: (value) => typeof value === "string" && value.length >= 32,
  },
  {
    name: "DATAFORSEO_LOGIN",
    isPresent: (value) => typeof value === "string" && value.length > 0,
  },
  {
    name: "DATAFORSEO_PASSWORD",
    isPresent: (value) => typeof value === "string" && value.length > 0,
  },
  {
    name: "SERPAPI_API_KEY",
    isPresent: (value) => typeof value === "string" && value.length > 0,
  },
];

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

function secretStatus(name, environment) {
  const requirement = REQUIRED_SECRETS.find((candidate) => candidate.name === name);
  if (!requirement) {
    throw new Error(`Unknown secret requirement: ${name}`);
  }

  return {
    name,
    status: requirement.isPresent(environment[name]) ? "present" : "missing",
  };
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeoutId.unref === "function") {
    timeoutId.unref();
  }

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeoutId),
  };
}

export async function probeEndpoint(
  endpoint,
  fetchImpl = globalThis.fetch,
  { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {},
) {
  const { signal, dispose } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal,
    });
    return {
      endpoint,
      statusCode: response.status,
    };
  } catch {
    return {
      endpoint,
      statusCode: null,
    };
  } finally {
    dispose();
  }
}

export async function runPreflight({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
} = {}) {
  const endpoints = [];
  for (const endpoint of REQUIRED_ENDPOINTS) {
    endpoints.push(await probeEndpoint(endpoint, fetchImpl, { timeoutMs: probeTimeoutMs }));
  }

  const secrets = REQUIRED_SECRETS.map(({ name }) => secretStatus(name, environment));
  const endpointsHealthy = endpoints.every((check) => check.statusCode === 200);
  const secretsPresent = secrets.every((check) => check.status === "present");
  const status = endpointsHealthy && secretsPresent ? "ready" : "incomplete";

  return {
    status,
    exitCode: status === "ready" ? 0 : 1,
    endpoints,
    secrets,
  };
}

export function formatPreflightReport(result) {
  return JSON.stringify(
    {
      status: result.status,
      endpoints: result.endpoints.map(({ endpoint, statusCode }) => ({
        endpoint,
        statusCode,
      })),
      secrets: result.secrets.map(({ name, status }) => ({
        name,
        status,
      })),
    },
    null,
    2,
  );
}

export async function main({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  stdout = console.log,
} = {}) {
  const result = await runPreflight({ environment, fetchImpl, probeTimeoutMs });
  stdout(formatPreflightReport(result));
  return result;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint && import.meta.url === entrypoint) {
  const result = await main();
  process.exitCode = result.exitCode;
}
