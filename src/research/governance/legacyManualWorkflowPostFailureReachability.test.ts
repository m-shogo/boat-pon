import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Static, synthetic governance regression only. Never dispatch a workflow or N2.
// The assertions intentionally fail on YAML drift so an operational owner can
// re-review the actual post-failure graph before interpreting a changed contract.
const root = resolve(process.cwd());
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const manualPath = ".github/workflows/boat-pon-local-research.yml";
const auditPath = ".github/workflows/research-retained-state-audit.yml";

test("legacy manual entry remains separate from the Draft CLI denial", () => {
  const source = read(manualPath);
  const task = source.split(/^  run-one-task:\s*$/mu)[1]?.split(/^  daily-retention-snapshot:\s*$/mu)[0];
  assert.ok(task, "run-one-task job missing or moved; re-review owner boundary");
  assert.match(source, /^\s*workflow_dispatch:\s*$/mu);
  assert.match(source, /^permissions:\s*\n\s*contents:\s*write\s*$/mu);
  assert.match(task, /^\s*runs-on:\s*\[self-hosted, macOS, boat-pon-local\]\s*$/mu);
  assert.match(task, /^\s*run:\s*pnpm automation:task -- --request=data\/tmp\/automation\/request\.json\s*$/mu);
  assert.match(task, /- name: Show status\s*\n\s*if: always\(\)/u);
  assert.match(task, /- name: Commit automation results \(allowlisted paths only\)\s*\n\s*if: always\(\)/u);
});

test("retention eligibility does not depend on task success in pinned YAML", () => {
  const source = read(manualPath);
  const retention = source.split(/^  daily-retention-snapshot:\s*$/mu)[1];
  assert.ok(retention, "retention job missing or moved; re-review owner boundary");
  assert.match(retention, /^\s*needs:\s*\[guard, run-one-task\]\s*$/mu);
  const predicate = retention.match(/^\s*if:\s*(.+)\s*$/mu)?.[1]?.trim();
  assert.equal(predicate, "always() && needs.guard.outputs.ok == 'true'");
  assert.match(retention, /if \[ "\$JST_HOUR" = "23" \]; then/u);
  assert.match(retention, /- name: Append retention snapshot with CAS\s*\n\s*if: steps\.gate\.outputs\.run == 'true' && steps\.persist\.outputs\.changed == 'true'/u);
  assert.match(retention, /if \[ "\$REMOTE_SHA" != "\$SOURCE_SHA" \]; then/u);
  assert.ok(retention.includes("git -C \"$STATE_DIR\" push origin HEAD:automation/boat-pon-research --quiet"));

  // Synthetic predicate truth table: source-verified guard-only job predicate,
  // followed by JST-hour, changed-output and CAS gates. This is not an Actions
  // interpreter or evidence that any write actually occurred.
  const cases = [
    { guardOk: true, hour: 23, changed: true, expected: true },
    { guardOk: true, hour: 23, changed: false, expected: false },
    { guardOk: true, hour: 22, changed: true, expected: false },
    { guardOk: false, hour: 23, changed: true, expected: false },
  ] as const;
  for (const taskConclusion of ["success", "failure", "cancelled", "skipped"]) {
    for (const row of cases) {
      const jobEligible = row.guardOk; // "always()" ignores taskConclusion.
      const appendStepEligible = jobEligible && row.hour === 23 && row.changed;
      assert.equal(appendStepEligible, row.expected,
        `${taskConclusion}/guard=${row.guardOk}/JST=${row.hour}/changed=${row.changed}`);
    }
  }
});

test("post-run audit is completion-triggered, conclusion-agnostic and read-only", () => {
  const audit = read(auditPath);
  assert.match(audit, /workflow_run:\s*\n\s*workflows:\s*\["boat-pon local research \(one-shot\)"\]\s*\n\s*types:\s*\[completed\]/u);
  assert.match(audit, /^permissions:\s*\n\s*contents:\s*read\s*$/mu);
  assert.doesNotMatch(audit, /workflow_run\.conclusion/u);
  assert.doesNotMatch(audit, /\bgit\s+push\b/u);
});


test("standalone retention remains a separate owner-guarded CAS writer", () => {
  const manual = read(manualPath);
  const standalone = read(".github/workflows/research-durable-retention-snapshot.yml");
  assert.match(standalone, /^on:\s*\n\s*workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(standalone, /^\s*schedule:\s*$/mu);
  assert.match(standalone, /^permissions:\s*\n\s*contents:\s*write\s*$/mu);
  assert.match(standalone, /^\s*group:\s*boat-pon-local-research\s*$/mu);
  assert.match(manual, /^\s*group:\s*boat-pon-local-research\s*$/mu);
  assert.match(standalone, /\[ "\$ACTOR" = "m-shogo" \]/u);
  assert.match(standalone, /\[ "\$REF" = "refs\/heads\/main" \]/u);
  assert.match(standalone, /^  snapshot:\s*$/mu);
  assert.match(standalone, /^    needs:\s*guard\s*$/mu);
  assert.match(standalone, /^    if:\s*needs\.guard\.outputs\.ok == 'true'\s*$/mu);
  assert.match(standalone, /if \[ "\$REMOTE_SHA" != "\$SOURCE_SHA" \]; then/u);
  assert.ok(standalone.includes("git -C /tmp/boat-pon-retention-state push origin HEAD:automation/boat-pon-research --quiet"));
  assert.match(standalone, /reports\/automation\/retention\/durable-knowledge\/\*/u);
  assert.doesNotMatch(standalone, /pnpm automation:task\b/u);
  assert.doesNotMatch(standalone, /self-hosted/u);
  // The separate dispatch is not proven enabled or runnable by these static checks.
});

test("canonical intent path stays distinct from deprecated manual task mode", () => {
  const intent = read(".github/workflows/boat-pon-intent-dispatch.yml");
  const manual = read(manualPath);
  assert.match(intent, /^on:\s*\n\s*push:\s*$/mu);
  assert.match(intent, /^\s*branches:\s*\[main\]\s*$/mu);
  assert.ok(intent.includes('"automation/requests/intents/*.json"'));
  assert.match(intent, /^permissions:\s*\n\s*contents:\s*read\s*$/mu);
  assert.match(intent, /^  run-one-task:\s*$/mu);
  assert.match(intent, /pnpm automation:intent-task -- --request=canonical-request\.json/u);
  assert.doesNotMatch(intent, /pnpm automation:task\b/u);
  assert.match(intent, /name: Materialize control state and dataset authority from automation branch/u);
  assert.match(intent, /name: Restore trusted automation commit helpers/u);
  assert.ok(intent.includes("EXPECTED_AUTOMATION_BRANCH_BASE: \${{ steps.materialize_authority.outputs.branch_base_sha }}"));
  assert.match(intent, /if: always\(\) && steps\.restore_commit_helper\.outcome == 'success'/u);
  assert.match(manual, /pnpm automation:task -- --request=/u);
  assert.doesNotMatch(manual, /pnpm automation:intent-task/u);
  // No intent is created or dispatched; no production or protected N2 authority.
});
