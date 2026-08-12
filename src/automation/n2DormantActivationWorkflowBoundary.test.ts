import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("post-run N2 readiness workflow reads automation state without adding a scheduler or write authority", () => {
  const workflow = readFileSync(
    resolve(process.cwd(), ".github/workflows/n2-market-baseline-readiness.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /workflows: \["boat-pon local research \(one-shot\)"\]/u);
  assert.doesNotMatch(workflow, /\bschedule\s*:/u);
  assert.doesNotMatch(workflow, /\bworkflow_dispatch\s*:/u);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u);
  assert.match(workflow, /ref: automation\/boat-pon-research/u);
  assert.match(workflow, /path: \.automation-state-snapshot/u);
  assert.match(workflow, /automation\/control\/task-queue-state\.json/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /scripts\/report-n2-dormant-activation-plan\.ts/u);
  assert.match(workflow, /activationPlanningAttemptDelta !== 0/u);
  assert.match(workflow, /automaticMutationAuthorized/u);
  assert.match(workflow, /rawOddsValuesReadByPlanner/u);

  for (const forbidden of [
    /git\s+push/u,
    /git\s+commit/u,
    /gh\s+api/u,
    /secrets\./u,
    /contents:\s*write/u,
    /actions\/checkout@v4[\s\S]*persist-credentials:\s*true/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("activation report CLI is read-only and uses descriptor-bound governance reads for authority inputs", () => {
  const script = readFileSync(
    resolve(process.cwd(), "scripts/report-n2-dormant-activation-plan.ts"),
    "utf8",
  );
  assert.match(script, /validateCatalog/u);
  assert.match(script, /validateQueueState/u);
  assert.match(script, /findN2DormantTaskDefinitionDrift/u);
  assert.match(script, /readN2MarketBaselineReadiness/u);
  assert.match(script, /buildN2MarketBaselineReadinessReport/u);
  assert.match(script, /isExecutorImplemented/u);
  assert.match(script, /buildN2DormantActivationReport/u);
  assert.match(script, /readGovernanceFileUtf8Bounded/u);
  assert.match(script, /MAX_N2_ACTIVATION_AUTHORITY_BYTES/u);
  assert.doesNotMatch(script, /readFileSync/u);
  assert.doesNotMatch(script, /writeFileSync|renameSync|rmSync|appendFileSync/u);
  assert.doesNotMatch(script, /fetch\(|https?:\/\//u);
  assert.doesNotMatch(script, /rawOddsValues(?:\s*:|\s*=)/u);
});
