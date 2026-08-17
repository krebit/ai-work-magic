import { spawnSync } from "node:child_process"
import path from "node:path"
import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const denApiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("Den starts without AMM variables and exposes null AMM configuration", () => {
  const result = spawnSync(process.execPath, ["--conditions", "development", "--eval", `
    const { env } = await import("./src/env.ts")
    console.log(JSON.stringify(env.amm))
  `], {
    cwd: denApiRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/openwork_test",
      DB_MODE: "mysql",
      DEN_DB_ENCRYPTION_KEY: "x".repeat(32),
      BETTER_AUTH_SECRET: "y".repeat(32),
      BETTER_AUTH_URL: "https://den.openwork.test",
      OPENWORK_DEV_MODE: "0",
      PROVISIONER_MODE: "stub",
      AMM_API_BASE_URL: "",
      DEN_TO_AMM_SERVICE_KEY: "",
    },
  })

  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe("null")
})
