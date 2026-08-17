import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ErrorCode, McpError, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import {
  catalogOperationChangesRemoteMcpAppDiscovery,
  executeCapability,
  type CapabilityRegistryContext,
  type ExecuteCapabilityToolResult,
} from "./capability-registry.js"
import type { getCatalog } from "./catalog.js"
import { EXECUTE_CAPABILITY_TOOL_NAME } from "./search.js"

export type { ExecuteCapabilityToolResult }
export const EXECUTE_CAPABILITY_TIMEOUT_MS = 180_000
export const EXECUTE_CAPABILITY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
}

const EXECUTE_CAPABILITY_TIMEOUT_MESSAGE = `The capability call exceeded ${EXECUTE_CAPABILITY_TIMEOUT_MS / 1_000}s. Retry once; if it times out again, narrow the request (fewer results, tighter query) and tell the user the service is slow — do NOT tell them to reconfigure or reconnect.`

function textContent(text: string): { text: string; type: "text" }[] {
  return [{ type: "text", text }]
}

function capabilityTimeoutResult(capability: string): ExecuteCapabilityToolResult {
  return {
    isError: true,
    content: textContent(JSON.stringify({
      error: "capability_timeout",
      capability,
      message: EXECUTE_CAPABILITY_TIMEOUT_MESSAGE,
    })),
  }
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return true
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return true
  }
  return error instanceof Error && /\b(time(?:d)? out|timeout)\b/i.test(error.message)
}

export async function executeCapabilityWithBudget<T extends ExecuteCapabilityToolResult>(input: {
  capability: string
  timeoutMs?: number
  invoke: () => Promise<T>
}): Promise<T | ExecuteCapabilityToolResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutResult = new Promise<ExecuteCapabilityToolResult>((resolve) => {
    timeout = setTimeout(() => resolve(capabilityTimeoutResult(input.capability)), input.timeoutMs ?? EXECUTE_CAPABILITY_TIMEOUT_MS)
  })
  try {
    const invocation = input.invoke()
    void invocation.catch(() => undefined)
    return await Promise.race([invocation, timeoutResult])
  } catch (error) {
    if (isTimeoutError(error)) {
      return capabilityTimeoutResult(input.capability)
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function registerAgentExecuteCapabilityTool(input: {
  server: McpServer
  catalog: Awaited<ReturnType<typeof getCatalog>>
  capabilityContext: CapabilityRegistryContext
}) {
  input.server.registerTool(
    EXECUTE_CAPABILITY_TOOL_NAME,
    {
      title: "Execute capability",
      description: [
        "Call a capability found via search_capabilities, by its exact name.",
        "Pass path/query/body only as described by that match's pathParams/queryParams/hasBody.",
        "For external MCP capabilities, provider-advertised schema mismatches are returned as advisory schemaGuidance alongside the provider result; they do not block the downstream call.",
        "For skill capabilities listed in the remote skill catalog, this returns their authorized SKILL.md content.",
        "Returns unknown_capability if name doesn't match a current capability — call search_capabilities again.",
      ].join(" "),
      annotations: EXECUTE_CAPABILITY_ANNOTATIONS,
      _meta: { ui: { visibility: ["model", "app"] } },
      inputSchema: z.object({
        name: z.string().min(1).describe("The exact tool name returned by search_capabilities."),
        schemaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional().describe("For an external MCP match, copy the exact schemaDigest returned by search_capabilities so schema drift can be reported as advisory guidance without blocking the provider call."),
        path: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("Path parameters, only if the match's pathParams is non-empty."),
        query: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("Query parameters, only if the match's queryParams is non-empty."),
        body: z.unknown().optional().describe("For native API capabilities, the JSON body. For external MCP capabilities, the arguments object matching argumentsSchema."),
      }),
    },
    async ({ name, schemaDigest, path, query, body }, extra) => {
      const result = await executeCapabilityWithBudget({
        capability: name,
        invoke: () => executeCapability(input.capabilityContext, { name, schemaDigest, path, query, body }),
      })
      const catalogOperation = input.catalog.find((operation) => operation.name === name)
      if (!result.isError && catalogOperation && catalogOperationChangesRemoteMcpAppDiscovery(catalogOperation)) {
        await extra.sendNotification({ method: "notifications/tools/list_changed" })
        await extra.sendNotification({ method: "notifications/resources/list_changed" })
      }
      return result
    },
  )
}
