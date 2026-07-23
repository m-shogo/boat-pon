import assert from "node:assert/strict";
import test from "node:test";
import {
  ERROR_ATLAS_CLASSES,
  FIRST_MARK_DATA_BOUNDARY,
  FRAGILITY_INPUTS,
  INFORMATION_TIMING_EVENTS,
  RESEARCH_AXIS_FEASIBILITY,
} from "./researchAxisFeasibility";

test("独自研究軸監査は7軸を一意に定義する", () => {
  assert.equal(RESEARCH_AXIS_FEASIBILITY.length, 7);
  assert.equal(new Set(RESEARCH_AXIS_FEASIBILITY.map((row) => row.id)).size, 7);
  assert.ok(RESEARCH_AXIS_FEASIBILITY.every((row) => row.requiredSchema.length > 0));
  assert.ok(RESEARCH_AXIS_FEASIBILITY.every((row) => row.additionalRequestCost.length > 0));
});

test("公式情報11イベントはfetched_atを公開時刻として扱わない", () => {
  assert.equal(INFORMATION_TIMING_EVENTS.length, 11);
  assert.ok(INFORMATION_TIMING_EVENTS.every((row) => row.sourceTimestampAvailable === false));
  assert.ok(INFORMATION_TIMING_EVENTS.every((row) => row.requiredFields.includes("source_observed_at")));
  assert.ok(INFORMATION_TIMING_EVENTS.every((row) => row.requiredFields.includes("source_published_at")));
});

test("1マーク境界、摂動metadata、Error Atlas分類を固定する", () => {
  assert.ok(FIRST_MARK_DATA_BOUNDARY.some((row) => row.role === "undetermined"));
  assert.ok(FIRST_MARK_DATA_BOUNDARY.some((row) => row.role === "pre_race_feature"));
  assert.ok(FIRST_MARK_DATA_BOUNDARY.some((row) => row.role === "post_race_label"));
  assert.ok(FRAGILITY_INPUTS.every((row) => row.requiredFields.includes("measurement_quality")));
  assert.ok(ERROR_ATLAS_CLASSES.includes("point_in_time_ineligible"));
  assert.ok(ERROR_ATLAS_CLASSES.includes("market_right_model_wrong"));
});
