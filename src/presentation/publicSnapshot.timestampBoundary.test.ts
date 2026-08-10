import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import { validatePublicDashboardSnapshot } from "./publicSnapshot";

function withTimestamp(field: "generatedAt" | "dataAsOf", value: string): unknown {
  const snapshot = structuredClone(fixture) as Record<string, unknown>;
  snapshot[field] = value;
  return snapshot;
}

test("public snapshot validator requires RFC3339 generatedAt and dataAsOf", () => {
  for (const field of ["generatedAt", "dataAsOf"] as const) {
    assert.equal(validatePublicDashboardSnapshot(withTimestamp(field, "2026-08-11")).ok, false, `${field} date-only`);
    assert.equal(validatePublicDashboardSnapshot(withTimestamp(field, "2026-08-11T04:00:00")).ok, false, `${field} timezone-less`);
    assert.equal(validatePublicDashboardSnapshot(withTimestamp(field, "2026-08-11T04:00:00Z")).ok, true, `${field} UTC`);
    assert.equal(validatePublicDashboardSnapshot(withTimestamp(field, "2026-08-11T13:00:00+09:00")).ok, true, `${field} offset`);
  }
});

test("public snapshot validator requires RFC3339 lastRunAt when present", () => {
  const snapshot = structuredClone(fixture) as Record<string, unknown>;
  const status = snapshot.status as Record<string, unknown>;
  status.lastRunAt = "2026-08-11";
  assert.equal(validatePublicDashboardSnapshot(snapshot).ok, false);

  status.lastRunAt = "2026-08-11T04:00:00Z";
  assert.equal(validatePublicDashboardSnapshot(snapshot).ok, true);
});
