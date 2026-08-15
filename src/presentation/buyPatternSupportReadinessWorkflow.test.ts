import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/owner-buy-learning-refresh.yml", "utf8");

test("Owner refresh reports contrast readiness immediately after pattern mining", () => {
  const mining = workflow.indexOf("- name: Mine repeatable BUY success and failure patterns");
  const readiness = workflow.indexOf("- name: Report BUY contrast support readiness");
  const tail = workflow.indexOf("- name: Analyze BUY max-hit dependence across independent windows");
  assert.ok(mining >= 0 && readiness > mining && tail > readiness);
  const step = workflow.slice(readiness, tail);
  assert.match(step, /report-buy-pattern-support-readiness\.ts/u);
  assert.match(step, /--patterns data\/tmp\/owner-buy-patterns-public\.json/u);
  assert.doesNotMatch(step, /BOAT_PON_DB_PATH|boat\.sqlite|segmentKey|selection|raceId|decisionId/u);
});
