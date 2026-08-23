import assert from "node:assert/strict";
import test from "node:test";

import {
  parseResearchRuleFlags,
  parseResearchRuleStatus,
  requireCanonicalRuleId,
  requireNonBlankText,
} from "./researchRuleCliOptions";

test("research rule CLI flags preserve explicit values", () => {
  assert.deepEqual(
    parseResearchRuleFlags(
      ["--rule-id", "rule-a", "--reason", "candidate evidence"],
      ["--rule-id", "--reason"],
    ),
    { "--rule-id": "rule-a", "--reason": "candidate evidence" },
  );
});

test("research rule CLI flags reject missing and duplicate values", () => {
  assert.throws(
    () => parseResearchRuleFlags(["--rule-id"], ["--rule-id"]),
    /--rule-id requires a value/u,
  );
  assert.throws(
    () => parseResearchRuleFlags(["--rule-id", "--reason", "x"], ["--rule-id", "--reason"]),
    /--rule-id requires a value/u,
  );
  assert.throws(
    () => parseResearchRuleFlags(
      ["--rule-id", "rule-a", "--rule-id", "rule-b"],
      ["--rule-id"],
    ),
    /duplicate option: --rule-id/u,
  );
});

test("research rule CLI flags reject unknown options", () => {
  assert.throws(
    () => parseResearchRuleFlags(["--unknown", "x"], ["--rule-id"]),
    /unknown option: --unknown/u,
  );
});

test("research rule identities must be non-blank and canonical", () => {
  assert.equal(requireCanonicalRuleId("rule-a"), "rule-a");
  for (const value of [undefined, "", " ", " rule-a", "rule-a "]) {
    assert.throws(() => requireCanonicalRuleId(value), /--rule-id requires a non-blank, trimmed value/u);
  }
});

test("research rule reasons must contain non-whitespace text", () => {
  assert.equal(requireNonBlankText("candidate evidence", "--reason"), "candidate evidence");
  for (const value of [undefined, "", "   "]) {
    assert.throws(() => requireNonBlankText(value, "--reason"), /--reason requires a non-blank value/u);
  }
});

test("research rule statuses are explicit canonical enum values", () => {
  assert.equal(parseResearchRuleStatus("forward", "--to"), "forward");
  for (const value of [undefined, "", " forward", "forward ", "active"]) {
    assert.throws(() => parseResearchRuleStatus(value, "--to"), /--to has an invalid status/u);
  }
});
