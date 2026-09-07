import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync("scripts/report-paper-forward-candidates-core.ts", "utf-8");
const raw = readFileSync("scripts/report-paper-forward-candidates-raw.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("paper-forward core cannot bypass official settlement completeness when invoked directly", () => {
  const preflight = core.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const rawRun = core.indexOf('run("scripts/report-paper-forward-candidates-raw.ts")');

  assert.ok(preflight >= 0, "core must invoke the canonical settlement-integrity preflight");
  assert.ok(rawRun > preflight, "raw aggregation must run only after the preflight");
  assert.match(core, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
});

test("paper-forward raw implementation stays internal and read-only", () => {
  const scripts = Object.values(pkg.scripts ?? {});
  assert.equal(scripts.some((command) => command.includes("report-paper-forward-candidates-raw.ts")), false);
  assert.match(raw, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.doesNotMatch(raw, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});
