import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-payout-rebase-internal.ts", "utf-8");

test("direct payout-rebase invocation runs settlement integrity preflight before internal analysis", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analysis = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts")');
  const guard = entrypointSource.indexOf("if (preflight !== 0)");

  assert.ok(preflight >= 0, "direct entrypoint must invoke settlement integrity preflight");
  assert.ok(guard > preflight, "preflight result must be checked before internal analysis");
  assert.ok(analysis > guard, "internal payout analysis must remain downstream of the fail-closed preflight guard");
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
});

test("internal payout-rebase analysis keeps canonical read-only database boundaries", () => {
  const verify = internalSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = internalSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
  assert.match(internalSource, /PRAGMA query_only = ON/);
});

test("internal payout-rebase still consumes official payout values only after the guarded entrypoint", () => {
  assert.match(internalSource, /race_payouts\.payout_yen/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /本番 decision ロジック変更/);
});
