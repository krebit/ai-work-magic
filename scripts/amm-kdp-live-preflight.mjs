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

export async function probeEndpoint(endpoint, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
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
  }
}

export async function runPreflight({
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const endpoints = [];
  for (const endpoint of REQUIRED_ENDPOINTS) {
    endpoints.push(await probeEndpoint(endpoint, fetchImpl));
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
  stdout = console.log,
} = {}) {
  const result = await runPreflight({ environment, fetchImpl });
  stdout(formatPreflightReport(result));
  return result;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint && import.meta.url === entrypoint) {
  const result = await main();
  process.exitCode = result.exitCode;
}
