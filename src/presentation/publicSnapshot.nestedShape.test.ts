import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";

function snapshot(): Record<string, any> {
  return structuredClone(fixture) as Record<string, any>;
}

const canonicalMetric = {
  id: "metric-1",
  label: "metric",
  value: null,
  unit: null,
  sampleSize: null,
  period: null,
  basis: "not-available",
};

const canonicalPipelineItem = {
  taskId: "TASK-N2-001",
  label: "task",
  status: "PASS",
  dependencies: [],
  evidence: [],
};

test("public snapshot rejects unknown nested fields even when their names are not sensitive", () => {
  const value = snapshot();
  value.pipeline[0].internalMemo = "opaque payload";
  const result = validatePublicDashboardSnapshot(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /pipeline\[0\]\.internalMemo: unknown key/);
});

test("public snapshot rejects malformed nested records instead of accepting array/object shells", () => {
  const cases: Array<[string, (value: Record<string, any>) => void, RegExp]> = [
    ["metric", (value) => { value.metrics = [{ id: "m1" }]; }, /metrics\[0\].label: required/],
    ["pipeline", (value) => { value.pipeline = ["TASK-N2-001"]; }, /pipeline\[0\]: object required/],
    ["registries", (value) => { value.registries.experiments = -1; }, /registries\.experiments: non-negative integer or null required/],
    ["data quality", (value) => { value.dataQuality.notes = ["ok", 7]; }, /dataQuality\.notes: string array required/],
    ["methodology", (value) => { value.methodologyReferences = [{ label: "x" }]; }, /methodologyReferences\[0\].path: required/],
  ];

  for (const [label, mutate, expected] of cases) {
    const value = snapshot();
    mutate(value);
    const result = validatePublicDashboardSnapshot(value);
    assert.equal(result.ok, false, label);
    assert.match(result.errors.join("\n"), expected, label);
  }
});

test("public snapshot enforces schema cardinality and identifier bounds at runtime", () => {
  const cases: Array<[string, (value: Record<string, any>) => void, RegExp]> = [
    ["model version", (value) => { value.modelVersion = "x".repeat(121); }, /modelVersion: string with length 1\.\.120 required/],
    ["metric id", (value) => { value.metrics = [{ ...canonicalMetric, id: "Bad_ID" }]; }, /metrics\[0\]\.id: invalid metric id/],
    ["metrics count", (value) => { value.metrics = Array.from({ length: 101 }, (_, index) => ({ ...canonicalMetric, id: `metric-${index}` })); }, /metrics: max 100 items/],
    ["pipeline count", (value) => { value.pipeline = Array.from({ length: 201 }, () => ({ ...canonicalPipelineItem })); }, /pipeline: max 200 items/],
    ["dependency count", (value) => { value.pipeline = [{ ...canonicalPipelineItem, dependencies: Array.from({ length: 51 }, (_, index) => `TASK-${index}`) }]; }, /dependencies: max 50 items/],
    ["evidence count", (value) => { value.pipeline = [{ ...canonicalPipelineItem, evidence: Array.from({ length: 21 }, (_, index) => `/evidence/${index}`) }]; }, /evidence: max 20 items/],
    ["notes count", (value) => { value.dataQuality.notes = Array.from({ length: 51 }, () => "note"); }, /dataQuality\.notes: max 50 items/],
    ["methodology count", (value) => { value.methodologyReferences = Array.from({ length: 51 }, () => ({ label: "doc", path: "/docs/research.md" })); }, /methodologyReferences: max 50 items/],
    ["methodology path", (value) => { value.methodologyReferences[0].path = "docs/research.md"; }, /methodologyReferences\[0\]\.path: root-relative path required/],
  ];

  for (const [label, mutate, expected] of cases) {
    const value = snapshot();
    mutate(value);
    const result = validatePublicDashboardSnapshot(value);
    assert.equal(result.ok, false, label);
    assert.match(result.errors.join("\n"), expected, label);
  }
});

test("canonical sanitized public fixture remains valid under strict nested validation", () => {
  const result = validatePublicDashboardSnapshot(snapshot());
  assert.equal(result.ok, true, result.errors.join("\n"));
});
