import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
  scripts?: Record<string, string>;
};
const runner = readFileSync("scripts/run-payout-rebase-safe.ts", "utf-8");

test("payout rebase npm entrypoint cannot bypass settlement completeness preflight", () => {
  assert.equal(
    pkg.scripts?.["analyze:payout-rebase"],
    "tsx scripts/run-payout-rebase-safe.ts",
    "the normal payout-rebase command must enter through the fail-closed runner",
  );
});

test("payout rebase safe runner executes completeness preflight before the analyzer", () => {
  const preflight = runner.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const analyzer = runner.indexOf('run("scripts/analyze-payout-rebase.ts")');
  const failClosed = runner.indexOf("FAIL CLOSED: settlement completeness preflight did not pass");

  assert.ok(preflight >= 0, "settlement completeness preflight must remain present");
  assert.ok(failClosed > preflight, "preflight failure must have an explicit fail-closed path");
  assert.ok(analyzer > failClosed, "payout rebase analysis must stay downstream of successful preflight handling");
});
