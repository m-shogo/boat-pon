import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchDurableRetentionSnapshot.ts"),
  "utf8",
);
const cli = readFileSync(
  resolve(process.cwd(), "scripts/persist-research-durable-retention-snapshot.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/research-durable-retention-snapshot.yml"),
  "utf8",
);

test("retention snapshot writes only sanitized retention artifacts", () => {
  assert.match(source, /reports\/automation\/retention\/durable-knowledge/u);
  assert.match(source, /RESEARCH_KNOWLEDGE_RETENTION_SNAPSHOT_ONLY/u);
  assert.match(source, /computeResearchDurableRetentionEvidenceDigest/u);
  assert.match(source, /DURABLE_RETENTION_SNAPSHOT_SELF_DIGEST_INVALID/u);
  assert.match(source, /DURABLE_RETENTION_PROTECTED_AUTHORITY_NOT_FALSE/u);
  assert.doesNotMatch(source, /data\/raw|data\/private|boat\.sqlite|sidecar/u);
  assert.doesNotMatch(source, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync/u);
  assert.doesNotMatch(source, /app_settings|send-line|notify|auto_purchase|auto_vote/u);
});

test("snapshot identity is semantic and does not use state SHA or observation timestamp", () => {
  const functionStart = source.indexOf("export function computeResearchDurableRetentionEvidenceDigest");
  const functionEnd = source.indexOf("function assertProtectedAuthority", functionStart);
  const helperStart = source.indexOf("function semanticRun");
  const helperEnd = source.indexOf("export function computeResearchDurableRetentionEvidenceDigest", helperStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const digestFunction = source.slice(functionStart, functionEnd);
  const semanticRunHelper = source.slice(helperStart, helperEnd);
  assert.doesNotMatch(digestFunction, /sourceStateSha|mainAuthoritySha|firstObservedAt|generatedAt|outputDigest:\s*report\.outputDigest/u);
  assert.match(digestFunction, /runs:\s*report\.runs\.map\(semanticRun\)/u);
  assert.match(digestFunction, /classificationCounts/u);
  assert.match(semanticRunHelper, /historyContentDigest/u);
  assert.match(semanticRunHelper, /contentDigest/u);
});

test("existing retention evidence is fail-closed and never overwritten", () => {
  assert.match(source, /const existingStat = lstatIfPresent\(absolutePath\)/u);
  assert.match(source, /if \(existingStat\)/u);
  assert.match(source, /existingStat\.isSymbolicLink\(\)/u);
  assert.match(source, /validateResearchDurableRetentionSnapshot/u);
  assert.match(source, /return \{ changed: false/u);
  assert.match(source, /DURABLE_RETENTION_EXISTING_EVIDENCE_DIGEST_MISMATCH/u);
});

test("retention CLI exposes metadata only and cannot invoke product behavior", () => {
  assert.match(cli, /buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility/u);
  assert.match(cli, /persistResearchDurableRetentionSnapshot/u);
  assert.match(cli, /legacyCompatibilityCount/u);
  assert.match(cli, /nonStrongRuns/u);
  assert.doesNotMatch(cli, /summary:\s*run|data\/raw|data\/private|market|odds/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync|send-line|notify|auto_purchase|auto_vote/u);
});

test("retention workflow binds lineage to the checked-out main authority", () => {
  assert.match(workflow, /MAIN_SHA="\$\(git rev-parse HEAD\)"/u);
  assert.match(workflow, /--main-authority-sha="\$MAIN_SHA"/u);
  assert.doesNotMatch(workflow, /MAIN_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/u);
});

test("retention workflow is one-shot, serialized, CAS guarded and stages one retention path", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\bschedule:/u);
  assert.match(workflow, /group:\s*boat-pon-local-research/u);
  assert.match(workflow, /cancel-in-progress:\s*false/u);
  assert.match(workflow, /automation\/boat-pon-research/u);
  assert.match(workflow, /REMOTE_SHA.*SOURCE_SHA/u);
  assert.match(workflow, /refusing to retry or overwrite/u);
  assert.match(workflow, /push origin HEAD:automation\/boat-pon-research/u);
  assert.doesNotMatch(workflow, /--force|force-with-lease|workflow_dispatch.*curl|rerun/u);
  assert.match(workflow, /reports\/automation\/retention\/durable-knowledge/u);
  assert.match(workflow, /unexpected staged path/u);
  assert.doesNotMatch(workflow, /reports\/automation\/history.*git add|research\/registries.*git add|reports\/n2.*git add/u);
});

test("retention workflow preserves protected product boundaries", () => {
  assert.doesNotMatch(workflow, /data\/raw|data\/private|boat\.sqlite|sidecar|app_settings/u);
  assert.doesNotMatch(workflow, /send-line|notify|auto_purchase|auto_vote|production_writer|live_odds_writer/u);
});
