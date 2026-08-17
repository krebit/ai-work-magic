import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPreflightReport,
  runPreflight,
} from "./amm-kdp-live-preflight.mjs";

test("classifies required secrets by presence without printing their values", async () => {
  const secretEnv = {
    DEN_TO_AMM_SERVICE_KEY: "12345678901234567890123456789012",
    DATAFORSEO_LOGIN: "dfs-login",
    DATAFORSEO_PASSWORD: "",
    SERPAPI_API_KEY: "serp-secret",
  };

  const result = await runPreflight({
    environment: secretEnv,
    fetchImpl: async () => new Response(null, { status: 200 }),
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.secrets, [
    { name: "DEN_TO_AMM_SERVICE_KEY", status: "present" },
    { name: "DATAFORSEO_LOGIN", status: "present" },
    { name: "DATAFORSEO_PASSWORD", status: "missing" },
    { name: "SERPAPI_API_KEY", status: "present" },
  ]);

  const rendered = formatPreflightReport(result);
  assert.match(rendered, /"status": "incomplete"/);
  assert.doesNotMatch(rendered, /12345678901234567890123456789012/);
  assert.doesNotMatch(rendered, /dfs-login/);
  assert.doesNotMatch(rendered, /serp-secret/);
});

test("reports ready only when every endpoint returns 200 and every secret is present", async () => {
  const result = await runPreflight({
    environment: {
      DEN_TO_AMM_SERVICE_KEY: "12345678901234567890123456789012",
      DATAFORSEO_LOGIN: "dfs-login",
      DATAFORSEO_PASSWORD: "dfs-password",
      SERPAPI_API_KEY: "serp-secret",
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith("/ready")) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.endpoints, [
    { endpoint: "http://127.0.0.1:3000/api/v1/health", statusCode: 200 },
    { endpoint: "http://127.0.0.1:3000/api/v1/ready", statusCode: 200 },
    { endpoint: "http://127.0.0.1:8790/health", statusCode: 200 },
    { endpoint: "http://127.0.0.1:8790/ready", statusCode: 200 },
  ]);
});

test("marks unavailable dependencies incomplete instead of pretending they are healthy", async () => {
  const calls = [];
  const result = await runPreflight({
    environment: {
      DEN_TO_AMM_SERVICE_KEY: "12345678901234567890123456789012",
      DATAFORSEO_LOGIN: "dfs-login",
      DATAFORSEO_PASSWORD: "dfs-password",
      SERPAPI_API_KEY: "serp-secret",
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/health")) {
        throw new Error("connection refused");
      }
      return new Response(null, { status: 503 });
    },
  });

  assert.deepEqual(calls, [
    "http://127.0.0.1:3000/api/v1/health",
    "http://127.0.0.1:3000/api/v1/ready",
    "http://127.0.0.1:8790/health",
    "http://127.0.0.1:8790/ready",
  ]);
  assert.equal(result.status, "incomplete");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.endpoints, [
    { endpoint: "http://127.0.0.1:3000/api/v1/health", statusCode: null },
    { endpoint: "http://127.0.0.1:3000/api/v1/ready", statusCode: 503 },
    { endpoint: "http://127.0.0.1:8790/health", statusCode: null },
    { endpoint: "http://127.0.0.1:8790/ready", statusCode: 503 },
  ]);
});
