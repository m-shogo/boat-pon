import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/owner-buy-learning-refresh.yml"), "utf8");
const mergeScript = readFileSync(resolve(process.cwd(), "scripts/merge-buy-pattern-replication-readiness.ts"), "utf8");

test("replication readiness enriches learning before the final private tail-enriched retention", () => {
  const summaryStart = workflow.indexOf("- name: Build read-only BUY outcome learning summary");
  const readinessStart = workflow.indexOf("- name: Merge BUY pattern replication readiness into learning");
  const tailStart = workflow.indexOf("- name: Merge supported tail stability and retain final BUY learning");
  assert.ok(summaryStart >= 0 && readinessStart > summaryStart && tailStart > readinessStart);
  const readinessStep = workflow.slice(readinessStart, tailStart);
  assert.match(readinessStep, /merge-buy-pattern-replication-readiness\.ts/u);
  assert.match(readinessStep, /--summary data\/tmp\/owner-buy-learning-latest\.json/u);
  assert.match(readinessStep, /--replication data\/tmp\/owner-buy-pattern-replication-public\.json/u);
  assert.doesNotMatch(readinessStep, /--retain-private-dir/u);

  const tailEnd = workflow.indexOf("- name: Report BUY hit-rate uncertainty", tailStart);
  const tailStep = workflow.slice(tailStart, tailEnd);
  assert.match(tailStep, /--retain-private-dir data\/private\/outcome-learning-ledger/u);
});

test("replication readiness is aggregate-only and cannot change production", () => {
  assert.match(mergeScript, /PATTERN_REPLICATION_PENDING/u);
  assert.match(mergeScript, /PATTERN_REPLICATION_NONE/u);
  assert.match(mergeScript, /PATTERN_REPLICATION_CONFIRMED/u);
  assert.match(mergeScript, /productionChangeAllowed:\s*false/u);
  assert.match(mergeScript, /settled count mismatch/u);
  assert.doesNotMatch(mergeScript, /from "\.\.\/server\/db"|DatabaseSync|UPDATE\s+decision_history|INSERT\s+INTO\s+decision_history|DELETE\s+FROM\s+decision_history/u);
});
