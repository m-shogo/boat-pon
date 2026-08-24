import assert from "node:assert/strict";
import test from "node:test";

import { parseRuleCandidateAppendOptions } from "./ruleCandidateAppendOptions";

test("rule candidate append options preserve safe defaults", () => {
  assert.deepEqual(parseRuleCandidateAppendOptions([]), {
    input: null,
    output: "docs/rule-candidates.md",
    status: "watch",
    evidence: "report:quality",
    action: "追加観察",
    nextCheck: "next weekly",
  });
});

test("rule candidate append options accept documented overrides", () => {
  assert.deepEqual(
    parseRuleCandidateAppendOptions([
      "--",
      "--input", "/tmp/boat-quality.json",
      "--output", "docs/research/rule-candidates.md",
      "--status", "candidate",
      "--evidence", "report:monthly",
      "--action", "追加観察",
      "--next-check", "next monthly",
    ]),
    {
      input: "/tmp/boat-quality.json",
      output: "docs/research/rule-candidates.md",
      status: "candidate",
      evidence: "report:monthly",
      action: "追加観察",
      nextCheck: "next monthly",
    },
  );
});

test("rule candidate append options reject missing and duplicate flags", () => {
  assert.throws(() => parseRuleCandidateAppendOptions(["--status"]), /--status requires a value/u);
  assert.throws(
    () => parseRuleCandidateAppendOptions(["--status", "watch", "--status", "candidate"]),
    /duplicate option: --status/u,
  );
  assert.throws(
    () => parseRuleCandidateAppendOptions(["--output", "--status", "watch"]),
    /--output requires a value/u,
  );
});

test("rule candidate append options reject unknown or non-canonical statuses", () => {
  for (const value of ["", " watch", "watch ", "production", "WATCH"]) {
    assert.throws(() => parseRuleCandidateAppendOptions(["--status", value]), /invalid --status|requires a value/u);
  }
  assert.throws(() => parseRuleCandidateAppendOptions(["--unknown", "x"]), /unknown option: --unknown/u);
});

test("rule candidate append options confine writes to canonical docs markdown paths", () => {
  for (const output of [
    "automation/control/task-queue-state.json",
    "src/research-replay/settlement.ts",
    "../docs/rule-candidates.md",
    "docs/../automation/control/task-queue-state.md",
    "/tmp/rule-candidates.md",
    "docs\\rule-candidates.md",
    "docs//rule-candidates.md",
    " docs/rule-candidates.md",
    "docs/rule-candidates.md ",
    "docs/rule-candidates.json",
  ]) {
    assert.throws(
      () => parseRuleCandidateAppendOptions(["--output", output]),
      /invalid --output/u,
    );
  }
});
