import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalN2HistoricalRaceKey } from "./n2HistoricalOnlyBaselineSource";

test("historical race key calendar validation", () => {
  assert.equal(isCanonicalN2HistoricalRaceKey("2026-02-30:05:R1"), false);
  assert.equal(isCanonicalN2HistoricalRaceKey("2028-02-29:05:R1"), true);
});
