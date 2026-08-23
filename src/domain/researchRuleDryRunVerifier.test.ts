import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("dependency-free research rule dry-run verifier remains executable", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/verify-research-rules-dry-run.mjs")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stderr, result.stdout].filter(Boolean).join("\n"),
  );
});
