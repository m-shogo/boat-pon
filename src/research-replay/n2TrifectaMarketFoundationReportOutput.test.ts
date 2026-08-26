import assert from "node:assert/strict";
import test from "node:test";
import { assertN2TrifectaMarketFoundationReportOutputSafe } from "./n2TrifectaMarketFoundationReportOutput";

const root = "/repo/boat-pon";

test("foundation report output allows canonical reports and external scratch paths", () => {
  assert.doesNotThrow(() => assertN2TrifectaMarketFoundationReportOutputSafe({
    root,
    dataRoot: root,
    outputPath: "/repo/boat-pon/reports/n2/foundation.json",
  }));
  assert.doesNotThrow(() => assertN2TrifectaMarketFoundationReportOutputSafe({
    root,
    dataRoot: root,
    outputPath: "/tmp/foundation.json",
  }));
});

test("foundation report output rejects repository source and config paths", () => {
  for (const outputPath of [
    "/repo/boat-pon/scripts/report-n2-trifecta-market-foundation.ts",
    "/repo/boat-pon/config/research-automation-policy.json",
    "/repo/boat-pon/reports/n2-other/foundation.json",
  ]) {
    assert.throws(() => assertN2TrifectaMarketFoundationReportOutputSafe({
      root,
      dataRoot: root,
      outputPath,
    }), /N2_TRIFECTA_FOUNDATION_REPORT_OUTPUT_REPO_PATH_FORBIDDEN/);
  }
});

test("foundation report output rejects primary and sidecar data directories", () => {
  for (const input of [
    { dataRoot: root, outputPath: "/repo/boat-pon/data/boat.sqlite" },
    { dataRoot: "/srv/boat-data", outputPath: "/srv/boat-data/data/research-replay.sqlite" },
  ]) {
    assert.throws(() => assertN2TrifectaMarketFoundationReportOutputSafe({
      root,
      ...input,
    }), /N2_TRIFECTA_FOUNDATION_REPORT_OUTPUT_DATA_PATH_FORBIDDEN/);
  }
});
