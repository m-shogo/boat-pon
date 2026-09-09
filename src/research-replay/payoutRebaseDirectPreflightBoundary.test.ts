import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-payout-rebase-internal.ts", "utf-8");

test("direct payout-rebase invocation runs settlement integrity preflight before verified internal analysis", () => {
  const preflight = entrypointSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const guard = entrypointSource.indexOf("if (preflight !== 0)");
  const verify = entrypointSource.indexOf("assertCanonicalSingleLinkRegularFile(");
  const analysis = entrypointSource.indexOf('run("scripts/analyze-payout-rebase-internal.ts"');

  assert.ok(preflight >= 0, "direct entrypoint must invoke settlement integrity preflight");
  assert.ok(guard > preflight, "preflight result must be checked before DB identity verification");
  assert.ok(verify > guard, "DB identity must be re-verified only after settlement integrity passes");
  assert.ok(analysis > verify, "internal payout analysis must remain downstream of DB identity verification");
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
});

test("canonical payout-rebase entrypoint passes only a verified opaque DB identity to internal analysis", () => {
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_MISSING/);
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(entrypointSource, /DB not found:/);
  assert.match(entrypointSource, /BOAT_PON_DB_PATH: verifiedDbPath/);
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
