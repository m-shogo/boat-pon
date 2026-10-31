import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Static contract only: never dispatch the legacy workflow or self-hosted N2.
// The legacy helper provenance gap is already recorded as LEARN; this regression
// locks the current fail-closed boundary until an operations owner reviews it.
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

test("legacy always-run commit step lacks trusted helper inputs; canonical intent supplies them", () => {
  const manual = read(".github/workflows/boat-pon-local-research.yml");
  const intent = read(".github/workflows/boat-pon-intent-dispatch.yml");
  const helper = read("scripts/automation-commit.sh");

  const task = manual.split(/^  run-one-task:\s*$/mu)[1]?.split(/^  daily-retention-snapshot:\s*$/mu)[0];
  assert.ok(task, "legacy task job moved: operational owner must re-review");
  const commitStep = task.split(/^      - name: Commit automation results \(allowlisted paths only\)\s*$/mu)[1];
  assert.ok(commitStep, "legacy post-task commit step moved: operational owner must re-review");
  assert.match(commitStep, /^\s*if: always\(\)\s*$/mu);
  assert.match(commitStep, /^\s*RUN_ID: \$\{\{ github\.run_id \}\}\s*$/mu);
  assert.match(commitStep, /bash scripts\/automation-commit\.sh/u);
  assert.doesNotMatch(
    commitStep,
    /^\s*(TRUSTED_GIT_BIN|TRUSTED_NODE_BIN|EXPECTED_AUTOMATION_BRANCH_BASE|BOAT_PON_AUTOMATION_PUSH_TOKEN):/mu,
    "legacy post-task step gained an authority input; require explicit operations review",
  );

  assert.ok(helper.includes('case "$TRUSTED_GIT_BIN" in /*)'));
  assert.ok(helper.includes('case "$TRUSTED_NODE_BIN" in /*)'));
  assert.ok(helper.includes('if ! [[ "$EXPECTED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then'));
  assert.ok(helper.includes('EXPECTED_BASE_SHA="${EXPECTED_AUTOMATION_BRANCH_BASE:-}"'));
  assert.ok(helper.includes('exit 1'), "missing fail-closed helper exit");

  assert.ok(intent.includes('capture_helper "commit_script"'));
  assert.ok(intent.includes("name: Restore trusted automation commit helpers"));
  assert.ok(intent.includes('EXPECTED_AUTOMATION_BRANCH_BASE: ${{ steps.materialize_authority.outputs.branch_base_sha }}'));
  assert.match(intent, /if: always\(\) && steps\.restore_commit_helper\.outcome == 'success'/u);
  assert.doesNotMatch(intent, /pnpm automation:task\b/u);
  // This proves source-level separation only, not live runner state or persistence.
});
