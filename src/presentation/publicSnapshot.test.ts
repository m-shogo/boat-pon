import assert from "node:assert/strict";
import test from "node:test";
import fixture from "./fixtures/public-dashboard-snapshot-v1.json";
import {
  assertPublicDashboardSnapshot,
  validatePublicDashboardSnapshot,
} from "./publicSnapshot";

test("sanitized public dashboard fixture passes validation", () => {
  const result = validatePublicDashboardSnapshot(fixture);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.doesNotThrow(() => assertPublicDashboardSnapshot(fixture));
});

test("exact BUY fields are rejected even when deeply nested", () => {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.pipeline = [
    {
      taskId: "PUBLIC",
      label: "bad payload",
      status: "READY",
      dependencies: [],
      evidence: [{ selection: "1-2-3", recommendedAmount: 100 }],
    },
  ];
  const result = validatePublicDashboardSnapshot(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /selection/);
  assert.match(result.errors.join("\n"), /recommendedamount/i);
});

test("app settings, stake and live odds fields are rejected", () => {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.metrics = [
    {
      id: "unsafe",
      label: "unsafe",
      value: null,
      unit: null,
      sampleSize: null,
      period: null,
      basis: "not-available",
      app_settings: {},
      stake: 100,
      currentOdds: 25.4,
      requiredOdds: 21.0,
    },
  ];
  const result = validatePublicDashboardSnapshot(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /app_settings/);
  assert.match(result.errors.join("\n"), /stake/);
  assert.match(result.errors.join("\n"), /currentodds/i);
  assert.match(result.errors.join("\n"), /requiredodds/i);
});

test("absolute paths and secret-like values are rejected", () => {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.dataQuality = {
    coverageStatus: "NOT_AVAILABLE",
    pitStatus: "PASS",
    holdoutStatus: "PASS",
    commonCohortStatus: "NOT_AVAILABLE",
    notes: [
      "/Users/m-shogo/Developer/personal/boat-pon/data/boat-pon.sqlite",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    ],
  };
  const result = validatePublicDashboardSnapshot(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /absolute\/local path/);
  assert.match(result.errors.join("\n"), /secret-like/);
});

test("unknown top-level fields and owner payloads are rejected", () => {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.owner = { manualPurchase: true };
  const result = validatePublicDashboardSnapshot(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /\$\.owner: unknown key/);
  assert.match(result.errors.join("\n"), /manualpurchase/i);
});

test("invalid schema version is rejected", () => {
  const value = structuredClone(fixture) as Record<string, unknown>;
  value.schemaVersion = "public-dashboard-snapshot-v2";
  assert.throws(() => assertPublicDashboardSnapshot(value), /Invalid public dashboard snapshot/);
});
