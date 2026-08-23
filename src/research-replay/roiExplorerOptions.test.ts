import assert from "node:assert/strict";
import test from "node:test";

import { parseRoiExplorerOptions } from "./roiExplorerOptions";

const TODAY = "2026-08-23";

test("ROI explorer accepts canonical window and filters", () => {
  assert.deepEqual(
    parseRoiExplorerOptions([
      "--", "--from", "2028-02-29", "--to", "2028-03-01",
      "--rule-id", "rule-a", "--condition", "venue=桐生",
      "--json", "--view-json", "--presentation-json",
    ], TODAY),
    {
      from: "2028-02-29",
      to: "2028-03-01",
      ruleId: "rule-a",
      condition: { key: "venue", value: "桐生" },
      json: true,
      viewJson: true,
      presentationJson: true,
    },
  );
});

test("ROI explorer preserves existing defaults", () => {
  assert.deepEqual(parseRoiExplorerOptions([], TODAY), {
    from: "1970-01-01",
    to: TODAY,
    ruleId: "explore-roi-adhoc",
    json: false,
    viewJson: false,
    presentationJson: false,
    condition: undefined,
  });
});

test("ROI explorer rejects impossible and non-canonical dates", () => {
  for (const [flag, value] of [
    ["--from", "2026-02-30"],
    ["--from", "2026-6-01"],
    ["--to", "2026-08-32"],
    ["--to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(() => parseRoiExplorerOptions([flag, value], TODAY), /ROI_EXPLORER_(FROM|TO)_INVALID/u);
  }
});

test("ROI explorer rejects reversed resolved ranges", () => {
  assert.throws(
    () => parseRoiExplorerOptions(["--from", "2026-08-24"], TODAY),
    /ROI_EXPLORER_DATE_RANGE_INVALID/u,
  );
  assert.throws(
    () => parseRoiExplorerOptions(["--from", "2026-08-24", "--to", "2026-08-23"], TODAY),
    /ROI_EXPLORER_DATE_RANGE_INVALID/u,
  );
});

test("ROI explorer rejects blank or padded rule identity", () => {
  for (const value of ["", " ", " rule-a", "rule-a "]) {
    assert.throws(() => parseRoiExplorerOptions(["--rule-id", value], TODAY), /ROI_EXPLORER_RULE_ID_INVALID/u);
  }
});

test("ROI explorer rejects missing, unknown, and duplicate arguments", () => {
  assert.throws(() => parseRoiExplorerOptions(["--from"], TODAY), /ARGUMENT_MISSING/u);
  assert.throws(() => parseRoiExplorerOptions(["--unknown", "x"], TODAY), /ARGUMENT_INVALID/u);
  assert.throws(
    () => parseRoiExplorerOptions(["--to", "2026-08-22", "--to", "2026-08-23"], TODAY),
    /ARGUMENT_DUPLICATE/u,
  );
  assert.throws(() => parseRoiExplorerOptions(["--json", "--json"], TODAY), /ARGUMENT_DUPLICATE/u);
});

test("ROI explorer keeps condition parser fail-closed", () => {
  assert.throws(() => parseRoiExplorerOptions(["--condition", "venue"], TODAY), /expected key=value/u);
});
