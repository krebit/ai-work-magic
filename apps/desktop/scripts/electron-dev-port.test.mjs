import assert from "node:assert/strict";
import test from "node:test";
import { resolveElectronDevPort } from "./electron-dev-port.mjs";

test("uses an isolated port by default instead of reusing port 5173", async () => {
  let calls = 0;
  const port = await resolveElectronDevPort("", async () => {
    calls += 1;
    return 43127;
  });
  assert.equal(port, 43127);
  assert.equal(calls, 1);
});

test("honors an explicitly configured positive port", async () => {
  const port = await resolveElectronDevPort("5188", async () => {
    throw new Error("free-port lookup should not run");
  });
  assert.equal(port, 5188);
});
