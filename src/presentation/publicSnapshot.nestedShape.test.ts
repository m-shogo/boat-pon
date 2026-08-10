import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";

function snapshot(): Record<string, any> {
  return structuredClone(fixture) as Record<string, any>;
}

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

test("canonical sanitized public fixture remains valid under strict nested validation", () => {
  const result = validatePublicDashboardSnapshot(snapshot());
  assert.equal(result.ok, true, result.errors.join("\n"));
});
