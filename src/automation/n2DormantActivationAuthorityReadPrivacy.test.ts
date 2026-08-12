import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const tsxImport = require.resolve("tsx");
const plannerScript = resolve(process.cwd(), "scripts/report-n2-dormant-activation-plan.ts");

function runPlanner(cwd: string) {
  return spawnSync(
    process.execPath,
    ["--import", tsxImport, plannerScript],
    { cwd, encoding: "utf8" },
  );
}

test("N2 activation planner redacts policy read paths before readiness access", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = runPlanner(root);

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout) as { blockers?: unknown };
  assert.deepEqual(report.blockers, ["POLICY_READ_FAILED"]);
  assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal(result.stderr, "");
});

test("N2 activation planner redacts catalog read paths before readiness access", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policyPath = join(root, "config/research-automation-policy.json");
  mkdirSync(dirname(policyPath), { recursive: true });
  writeFileSync(policyPath, "{}\n", "utf8");

  const result = runPlanner(root);

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout) as { blockers?: unknown };
  assert.deepEqual(report.blockers, ["CATALOG_READ_FAILED"]);
  assert.doesNotMatch(result.stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.equal(result.stderr, "");
});
