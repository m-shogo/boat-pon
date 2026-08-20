import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("N2-011 final preflight uses canonical rollout authority", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/preflight-n2-011-final-audit.ts"), "utf8");

  assert.match(source, /readCanonicalRolloutState/);
  assert.match(source, /const rollout = readCanonicalRolloutState\(sidecarDbPath\)/);
  assert.match(source, /addCheck\("rolloutSafety", rollout\.shadowWriteEnabled === false/);
  assert.doesNotMatch(source, /addCheck\("rolloutSafety", readiness\.input\.rollout\.shadowWriteEnabled/);
});
