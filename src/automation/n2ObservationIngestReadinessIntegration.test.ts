import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXECUTOR_REGISTRY_VERSION,
  isExecutorImplemented,
  KNOWN_TASK_TYPES,
  resolveExecutor,
} from "./taskExecutors";
import { runN2ObservationIngestReadinessExecutor } from "./n2ObservationIngestReadinessExecutor";

test("TASK-N2-012 catalog, registry and phase mapping are aligned", () => {
  const catalog = JSON.parse(readFileSync("automation/task-catalog.json", "utf8")) as {
    catalogVersion: string;
    tasks: Array<Record<string, unknown>>;
  };
  const task = catalog.tasks.find((candidate) => candidate.taskId === "TASK-N2-012");
  assert.ok(task);
  assert.equal(catalog.catalogVersion, "2026-08-06-n2-governance-v7");
  assert.equal(task.taskDefinitionVersion, 1);
  assert.equal(task.defaultStatus, "READY");
  assert.equal(task.taskType, "observation-ingest-readiness");
  assert.equal(task.executor, "observation-ingest-readiness");
  assert.equal(task.safetyLevel, "L0");
  assert.deepEqual(task.dependencies, ["TASK-N2-010"]);
  assert.deepEqual(task.expectedOutputs, ["reports/n2/n2-observation-ingest-readiness.json"]);

  assert.equal(EXECUTOR_REGISTRY_VERSION, "n2-task-executor-registry-v5");
  assert.equal(KNOWN_TASK_TYPES.includes("observation-ingest-readiness"), true);
  assert.equal(isExecutorImplemented("observation-ingest-readiness"), true);
  assert.equal(resolveExecutor("observation-ingest-readiness").executor, runN2ObservationIngestReadinessExecutor);

  const mapping = JSON.parse(readFileSync("automation/phase-mapping.json", "utf8")) as {
    phaseMappingVersion: string;
    legacyTaskAliases: Array<Record<string, unknown>>;
  };
  assert.equal(mapping.phaseMappingVersion, "research-phase-mapping-v5");
  const alias = mapping.legacyTaskAliases.find((candidate) => candidate.legacy === "TASK-N2-012");
  assert.equal(alias?.phase, "N4");
  assert.equal(alias?.status, "implemented_ready");
});

test("readiness evidence path is exact and broad N2 output access remains absent", () => {
  const script = readFileSync("scripts/automation-commit.sh", "utf8");
  assert.match(script, /reports\/n2\/n2-observation-ingest-readiness\./);
  assert.doesNotMatch(script, /"reports\/n2\/"/);
  assert.match(script, /\.sqlite\|\*\.sqlite-/);
});

test("readiness documentation forbids automatic write activation and preserves N2-011 final attempt", () => {
  const doc = readFileSync("docs/architecture/n2-observation-ingest-readiness.md", "utf8");
  assert.match(doc, /writeAuthorized: false/);
  assert.match(doc, /autoEnableShadowWrite: false/);
  assert.match(doc, /at most 20 races/);
  assert.match(doc, /Only then use the final N2-011 attempt/);
  assert.match(doc, /do not enable global writes automatically/i);
});
