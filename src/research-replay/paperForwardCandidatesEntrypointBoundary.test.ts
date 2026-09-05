import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-paper-forward-candidates.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("paper-forward candidate command cannot bypass official settlement completeness", () => {
  assert.equal(pkg.scripts?.["report:paper-forward-candidates"], "tsx scripts/report-paper-forward-candidates.ts");

  const preflight = entrypoint.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const core = entrypoint.indexOf('run("scripts/report-paper-forward-candidates-core.ts")');
  assert.ok(preflight >= 0, "candidate ledger entrypoint must invoke the settlement completeness preflight");
  assert.ok(core > preflight, "candidate ledger core must run only after completeness is checked");
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
});

test("paper-forward candidate core is not exposed as a package command", () => {
  const scripts = Object.values(pkg.scripts ?? {});
  assert.equal(scripts.some((command) => command.includes("report-paper-forward-candidates-core.ts")), false);
});
