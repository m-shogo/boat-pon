import assert from "node:assert/strict";
import test from "node:test";
import { assertN2TrifectaRealPlanPreflightReportOutputSafe } from "./n2TrifectaRealPlanPreflightReportOutput";

const root = "/repo/boat-pon";
const primaryDbPath = "/srv/boat-data/data/boat.sqlite";

test("private plan preflight output allows canonical validation and external scratch paths", () => {
  assert.doesNotThrow(() => assertN2TrifectaRealPlanPreflightReportOutputSafe({
    root,
    primaryDbPath,
    outputPath: "/repo/boat-pon/reports/automation/validation/preflight.json",
  }));
  assert.doesNotThrow(() => assertN2TrifectaRealPlanPreflightReportOutputSafe({
    root,
    primaryDbPath,
    outputPath: "/tmp/preflight.json",
  }));
});

test("private plan preflight output rejects repository source and config paths", () => {
  for (const outputPath of [
    "/repo/boat-pon/scripts/preflight-n2-trifecta-private-plan.ts",
    "/repo/boat-pon/config/research-automation-policy.json",
    "/repo/boat-pon/reports/automation/validation-other/preflight.json",
  ]) {
    assert.throws(() => assertN2TrifectaRealPlanPreflightReportOutputSafe({
      root,
      primaryDbPath,
      outputPath,
    }), /N2_TRIFECTA_REAL_PLAN_PREFLIGHT_OUTPUT_REPO_PATH_FORBIDDEN/);
  }
});

test("private plan preflight output rejects primary sqlite database files", () => {
  for (const outputPath of [primaryDbPath, `${primaryDbPath}-wal`, `${primaryDbPath}-shm`]) {
    assert.throws(() => assertN2TrifectaRealPlanPreflightReportOutputSafe({
      root,
      primaryDbPath,
      outputPath,
    }), /N2_TRIFECTA_REAL_PLAN_PREFLIGHT_OUTPUT_DATABASE_PATH_FORBIDDEN/);
  }
});
