import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";

function withEvidence(path: string): unknown {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.pipeline = [{
    taskId: "TASK-PLANNER-NEXT",
    label: "queue planner",
    status: "READY",
    dependencies: [],
    evidence: [path],
  }];
  return value;
}

test("public snapshot validator rejects private automation authority paths", () => {
  for (const path of [
    "automation/control/planner-candidates.json",
    "automation/requests/intents/INTENT-private.json",
  ]) {
    const result = validatePublicDashboardSnapshot(withEvidence(path));
    assert.equal(result.ok, false, path);
    assert.match(result.errors.join("\n"), /private relative path/);
  }
});

test("public snapshot validator rejects relative traversal and raw data paths", () => {
  for (const path of [
    "../private.json",
    "reports/n2/../../private.json",
    "data/private/raw.json",
    "data/raw/t5-odds.json",
  ]) {
    const result = validatePublicDashboardSnapshot(withEvidence(path));
    assert.equal(result.ok, false, path);
    assert.match(result.errors.join("\n"), /private relative path/);
  }
});

test("public snapshot validator preserves public report evidence", () => {
  const result = validatePublicDashboardSnapshot(withEvidence("reports/automation/history/123-TASK-N2-001.json"));
  assert.equal(result.ok, true, result.errors.join("\n"));
});
