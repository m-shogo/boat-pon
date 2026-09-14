import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-bet-type-selector-summary.ts", "utf8");

test("bet-type selector binds required report JSON reads to verified descriptors", () => {
  assert.match(source, /BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID/u);
  assert.match(source, /JSON\.parse\(readGovernanceFileUtf8\(path, "reports"\)\)/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(verifiedPath, "utf8"\)\)/u);
});

test("bet-type selector binds isolated text outputs to descriptors under the isolated workspace", () => {
  assert.match(source, /BET_TYPE_SELECTOR_REPORT_IDENTITY_INVALID/u);
  assert.match(source, /BET_TYPE_SELECTOR_JSON_REPORT_IDENTITY_INVALID/u);
  assert.match(source, /readGovernanceFileUtf8\(workspaceMd, workspace\)/u);
  assert.match(source, /readGovernanceFileUtf8\(workspaceJson, workspace\)/u);
  assert.doesNotMatch(source, /readFileSync\(verifiedReportPath/u);
  assert.doesNotMatch(source, /readFileSync\(verifiedJsonPath/u);
});

test("bet-type selector leaves staging and database handoff boundaries explicit", () => {
  assert.match(source, /BET_TYPE_SELECTOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID/u);
  assert.match(source, /copyFileSync\(sourcePath, stagedPath\)/u);
  assert.match(source, /BET_TYPE_SELECTOR_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(source, /spawnSync\(/u);
});
