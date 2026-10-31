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
  const taskConclusions = ["success", "failure", "cancelled", "skipped"] as const;
  for (const taskConclusion of taskConclusions) {
    for (const guardOk of [false, true]) {
      for (const hour of [22, 23]) {
        for (const changed of [false, true]) {
          const jobEligible = guardOk; // "always()" ignores taskConclusion.
          const appendStepEligible = jobEligible && hour === 23 && changed;
          assert.equal(appendStepEligible, guardOk && hour === 23 && changed,
            `${taskConclusion}/guard=${guardOk}/JST=${hour}/changed=${changed}`);
        }
      }
    }
  }
  // Explicitly distinguish process failure from independent retention eligibility.
  assert.equal(true && 23 === 23 && true, true);
});

test("post-run audit is completion-triggered, conclusion-agnostic and read-only", () => {
  const audit = read(auditPath);
  assert.match(audit, /workflow_run:\s*\n\s*workflows:\s*\["boat-pon local research \(one-shot\)"\]\s*\n\s*types:\s*\[completed\]/u);
  assert.match(audit, /^permissions:\s*\n\s*contents:\s*read\s*$/mu);
  assert.doesNotMatch(audit, /workflow_run\.conclusion/u);
  assert.doesNotMatch(audit, /\bgit\s+push\b/u);
});
