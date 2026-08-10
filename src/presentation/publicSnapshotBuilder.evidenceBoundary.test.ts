import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicDashboardSnapshot } from "./publicSnapshotBuilder";

const catalog = {
  tasks: [{ taskId: "TASK-PLANNER-NEXT", title: "queue planner", dependencies: [] }],
};

function build(evidenceLinks: string[]) {
  return buildPublicDashboardSnapshot({
    catalog,
    queueState: {
      updatedAt: "2026-08-10T00:00:00Z",
      tasks: {
        "TASK-PLANNER-NEXT": {
          status: "READY",
          updatedAt: "2026-08-10T00:00:00Z",
          evidenceLinks,
        },
      },
    },
    currentRun: { updatedAt: "2026-08-10T00:00:00Z", lastResult: "PASS" },
    readiness: { evaluatedAt: "2026-08-10T00:00:00Z", verdict: "PASS", checks: [] },
    generatedAt: "2026-08-10T00:01:00Z",
    modelVersion: "boat-pon-main:test",
  });
}

test("public snapshot keeps public evidence and drops private control paths", () => {
  const snapshot = build([
    "reports/automation/history/30912235903-TASK-PLANNER-NEXT.json",
    "reports/n2/n2-dataset-inventory.json",
    "research/registries/experiments/EXP-safe.json",
    "automation/control/planner-candidates.json",
  ]);

  assert.deepEqual(snapshot.pipeline[0].evidence, [
    "reports/automation/history/30912235903-TASK-PLANNER-NEXT.json",
    "reports/n2/n2-dataset-inventory.json",
    "research/registries/experiments/EXP-safe.json",
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /automation\/control\/planner-candidates/);
});

test("public snapshot drops absolute and traversal evidence paths", () => {
  const snapshot = build([
    "/private/raw/t5-odds.json",
    "../private.json",
    "reports/n2/../../private.json",
    "data/private/raw.json",
    "https://example.invalid/private",
  ]);

  assert.deepEqual(snapshot.pipeline[0].evidence, []);
});

test("public snapshot drops percent-encoded path control evidence", () => {
  const snapshot = build([
    "reports/n2/%2e%2e/private.json",
    "reports/n2/%2E%2E%2Fprivate.json",
    "reports/n2/safe%2f..%2fprivate.json",
    "reports/n2/safe%5c..%5cprivate.json",
    "reports/n2/safe%00private.json",
  ]);

  assert.deepEqual(snapshot.pipeline[0].evidence, []);
});

test("public snapshot drops double-encoded path controls", () => {
  const snapshot = build([
    "reports/n2/%252e%252e/private.json",
    "reports/n2/safe%252f..%252fprivate.json",
  ]);

  assert.deepEqual(snapshot.pipeline[0].evidence, []);
});