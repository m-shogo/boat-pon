import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/boat-pon-local-research.yml"),
  "utf8",
);

test("existing one-shot research dispatch remains the only scheduler", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\bschedule:/u);
  assert.match(workflow, /1 dispatch = 1 task/u);
  assert.doesNotMatch(workflow, /gh\s+workflow\s+run|workflow_dispatch.*curl|repository_dispatch/u);
});

test("daily retention hook runs only in the JST 23 hour", () => {
  assert.match(workflow, /daily-retention-snapshot:/u);
  assert.match(workflow, /TZ=Asia\/Tokyo date \+%H/u);
  assert.match(workflow, /\[ "\$JST_HOUR" = "23" \]/u);
  assert.match(workflow, /steps\.gate\.outputs\.run == 'true'/u);
});

test("daily retention hook is hosted and never reads Mac private data", () => {
  const start = workflow.indexOf("  daily-retention-snapshot:");
  assert.ok(start >= 0);
  const hook = workflow.slice(start);
  assert.match(hook, /runs-on:\s*ubuntu-latest/u);
  assert.doesNotMatch(hook, /self-hosted|data\/raw|data\/private|boat\.sqlite|sidecar/u);
  assert.doesNotMatch(hook, /send-line|notify|auto_purchase|auto_vote|production_writer|live_odds_writer/u);
});

test("daily retention hook writes exactly one sanitized retention path with CAS", () => {
  const start = workflow.indexOf("  daily-retention-snapshot:");
  const hook = workflow.slice(start);
  assert.match(hook, /persist-research-durable-retention-snapshot\.ts/u);
  assert.match(hook, /reports\/automation\/retention\/durable-knowledge/u);
  assert.match(hook, /CHANGED_PATHS/u);
  assert.match(hook, /REMOTE_SHA.*SOURCE_SHA/u);
  assert.match(hook, /refusing to retry or overwrite/u);
  assert.match(hook, /push origin HEAD:automation\/boat-pon-research/u);
  assert.doesNotMatch(hook, /--force|force-with-lease/u);
});

test("BLOCKED retention evidence is persisted before the hook fails visibly", () => {
  const append = workflow.indexOf("      - name: Append retention snapshot with CAS");
  const blocked = workflow.indexOf("      - name: Fail visibly after retaining BLOCKED audit evidence");
  assert.ok(append >= 0 && blocked > append);
  assert.match(workflow.slice(blocked), /audit_rc == '3'/u);
});
