import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

const root = process.cwd();
const catalog = JSON.parse(readFileSync(join(root, "automation/task-catalog.json"), "utf8"));
const phaseMapping = JSON.parse(readFileSync(join(root, "automation/phase-mapping.json"), "utf8"));
const commitScript = readFileSync(join(root, "scripts/automation-commit.sh"), "utf8");
const bundleSource = readFileSync(
  join(root, "src/research-replay/n2OfficialProgramCanaryReviewBundle.ts"),
  "utf8",
);
const executorSource = readFileSync(
  join(root, "src/automation/n2OfficialProgramCanaryReviewBundleExecutor.ts"),
  "utf8",
);

test("TASK-N2-013 catalog, registry and phase mapping are aligned", () => {
  assert.equal(catalog.catalogVersion, "2026-08-05-n2-governance-v6");
  const task = catalog.tasks.find((entry: { taskId: string }) => entry.taskId === "TASK-N2-013");
  assert.ok(task);
  assert.equal(task.taskDefinitionVersion, 1);
  assert.deepEqual(task.dependencies, ["TASK-N2-012"]);
  assert.equal(task.taskType, "official-program-canary-review-bundle");
  assert.equal(task.executor, "official-program-canary-review-bundle");
  assert.equal(task.safetyLevel, "L0");
  assert.equal(task.defaultStatus, "READY");
  assert.deepEqual(task.expectedOutputs, [
    "reports/n2/n2-official-program-canary-review-bundle.json",
  ]);
  assert.equal(isExecutorImplemented(task.taskType), true);
  assert.equal(resolveExecutor(task.taskType).code, "OK");

  assert.equal(phaseMapping.phaseMappingVersion, "research-phase-mapping-v5");
  const phase = phaseMapping.legacyTaskAliases.find(
    (entry: { legacy: string }) => entry.legacy === "TASK-N2-013",
  );
  assert.deepEqual(phase, {
    legacy: "TASK-N2-013",
    phase: "N4",
    role: "official-program canary review bundle",
    status: "implemented_ready",
    retainHistory: true,
  });
});

test("automation evidence allowlist is exact and does not authorize DB or approval artifacts", () => {
  assert.match(
    commitScript,
    /reports\/n2\/n2-official-program-canary-review-bundle\./,
  );
  assert.equal(commitScript.includes('"reports/n2/"'), false);
  assert.equal(commitScript.includes('"data/"'), false);
  assert.equal(commitScript.includes('"*.sqlite"'), false);
});

test("review bundle and executor remain read-only and never claim production apply", () => {
  for (const required of [
    "writeAuthorized: false",
    "productionApplyExecuted: false",
    "humanApprovalCreated: false",
    "productionApplyAuthorized: false",
    "automaticDeleteAllowed: false",
    "exactProductionApprovalRequired: true",
  ]) {
    assert.ok(bundleSource.includes(required), `missing safety contract: ${required}`);
  }
  assert.ok(executorSource.includes("openImmutable"));
  assert.ok(executorSource.includes("PRAGMA query_only=ON"));
  assert.ok(executorSource.includes("primaryDatabaseWriteCount: 0"));
  assert.ok(executorSource.includes("sidecarDatabaseWriteCount: 0"));
  assert.ok(executorSource.includes("approvalWriteCount: 0"));
  assert.ok(executorSource.includes("productionApplyExecuted: false"));
  assert.equal(executorSource.includes("recordApprovalGrant"), false);
  assert.equal(executorSource.includes("applyOfficialProgramCanary"), false);
});
