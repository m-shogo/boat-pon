import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");
const raw = readFileSync("scripts/analyze-miss-to-bet-type-recovery-raw.ts", "utf8");

test("miss recovery entrypoint revalidates DB identity after settlement preflight before isolated analysis", () => {
  const close = entrypoint.indexOf("db.close()");
  const handoff = entrypoint.indexOf("MISS_RECOVERY_DB_HANDOFF_IDENTITY_INVALID");
  const launch = entrypoint.indexOf("MISS_RECOVERY_CHILD_LAUNCH_DB_IDENTITY_INVALID");
  const child = entrypoint.indexOf("cwd: workspace", launch);

  assert.ok(close >= 0);
  assert.ok(handoff > close, "DB identity must be revalidated after the settlement preflight DB closes");
  assert.ok(launch > handoff, "DB identity must be revalidated immediately before isolated child launch");
  assert.ok(child > launch, "internal analyzer must launch only after child-launch DB revalidation");
  assert.match(entrypoint, /BOAT_PON_DB_PATH: launchDbPath/u);
  assert.doesNotMatch(entrypoint, /analyze-miss-to-bet-type-recovery-raw/u);
});

test("miss recovery guarded raw compatibility module routes through canonical DB and settlement preflight", () => {
  const canonical = raw.indexOf('await import("./analyze-miss-to-bet-type-recovery")');

  assert.ok(canonical >= 0);
  assert.match(raw, /MISS_RECOVERY_RAW_DIRECT_EXECUTION_FORBIDDEN/u);
  assert.doesNotMatch(raw, /MISS_RECOVERY_DB_IDENTITY_INVALID/u);
  assert.doesNotMatch(raw, /MISS_RECOVERY_DB_MISSING/u);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/u);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/u);
  assert.doesNotMatch(raw, /analyze-miss-to-bet-type-recovery-internal/u);
});
