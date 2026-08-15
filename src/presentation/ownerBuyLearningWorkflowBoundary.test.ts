import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/owner-buy-learning-refresh.yml"),
  "utf8",
);

test("owner BUY learning refresh only follows main workflow completions", () => {
  assert.match(workflow, /workflow_run:[\s\S]*branches:\s*\[main\]/u);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.head_branch == 'main'[\s\S]*github\.event\.workflow_run\.conclusion == 'success'/u,
  );
});

test("owner BUY learning refresh serializes instead of cancelling in-flight private learning", () => {
  assert.match(workflow, /group:\s*owner-buy-learning-refresh/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/u);
});

test("automatic outcome learning remains scoped to Current BUY paper-live", () => {
  const runKindMatches = workflow.match(/--run-kind paper-live/gu) ?? [];
  assert.equal(runKindMatches.length, 2);
  assert.doesNotMatch(workflow, /\bschedule:/u);
});

test("owner BUY learning reads the canonical private local DB instead of checkout-local data", () => {
  assert.match(
    workflow,
    /BOAT_PON_DB_PATH:\s*\/Users\/m-shogo\/Developer\/personal\/boat-pon\/data\/boat\.sqlite/u,
  );
  assert.match(workflow, /name:\s*Verify private BUY source DB[\s\S]*test -f "\$BOAT_PON_DB_PATH"/u);
  assert.doesNotMatch(workflow, /cp\s+[^\n]*boat\.sqlite/u);
});
