import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/research-retained-state-audit.yml"),
  "utf8",
);

test("post-run retained audit is event-driven and consumes no scheduler slot", () => {
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /boat-pon local research \(one-shot\)/u);
  assert.match(workflow, /types:\s*\[completed\]/u);
  assert.doesNotMatch(workflow, /\bschedule:/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});

test("post-run retained audit accepts only owner main one-shot dispatches", () => {
  assert.match(workflow, /workflow_run\.event == 'workflow_dispatch'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/u);
  assert.match(workflow, /workflow_run\.actor\.login == 'm-shogo'/u);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
  assert.match(workflow, /persist-credentials:\s*false/u);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
});

test("post-run retained audit reads automation state with main audit code", () => {
  assert.match(workflow, /ref:\s*main/u);
  assert.match(workflow, /git fetch origin automation\/boat-pon-research/u);
  assert.match(workflow, /git worktree add --detach/u);
  assert.match(workflow, /audit-research-durable-knowledge-completeness\.ts/u);
  assert.match(workflow, /--repo-root="\$STATE_DIR"/u);
  assert.match(workflow, /retainedOutputFileCount/u);
  assert.match(workflow, /orphanRetainedOutputCount/u);
  assert.match(workflow, /invalidRetainedOutputCount/u);
});

test("post-run retained audit is read-only and fail-closed", () => {
  assert.match(workflow, /if \[ "\$AUDIT_RC" -eq 3 \]/u);
  assert.match(workflow, /automation retained-state audit is BLOCKED/u);
  assert.doesNotMatch(workflow, /git push|git commit|git add/u);
  assert.doesNotMatch(workflow, /curl\s|gh api|child_process|DatabaseSync|openDb/u);
  assert.doesNotMatch(workflow, /data\/raw|data\/private|boat\.sqlite|sidecar/u);
  assert.doesNotMatch(workflow, /send-line|notify:line|auto_purchase|auto_vote/u);
});
