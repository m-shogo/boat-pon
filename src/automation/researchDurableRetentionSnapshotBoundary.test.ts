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
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const digestFunction = source.slice(functionStart, functionEnd);
  assert.doesNotMatch(digestFunction, /sourceStateSha|mainAuthoritySha|firstObservedAt|generatedAt|outputDigest:\s*report\.outputDigest/u);
  assert.match(digestFunction, /historyContentDigest/u);
  assert.match(digestFunction, /contentDigest/u);
  assert.match(digestFunction, /classificationCounts/u);
});

test("existing retention evidence is fail-closed and never overwritten", () => {
  assert.match(source, /if \(existsSync\(absolutePath\)\)/u);
  assert.match(source, /validateResearchDurableRetentionSnapshot/u);
  assert.match(source, /return \{ changed: false/u);
  assert.match(source, /DURABLE_RETENTION_EXISTING_EVIDENCE_DIGEST_MISMATCH/u);
});

test("retention CLI exposes metadata only and cannot invoke product behavior", () => {
  assert.match(cli, /buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility/u);
  assert.match(cli, /persistResearchDurableRetentionSnapshot/u);
  assert.match(cli, /legacyCompatibilityCount/u);
  assert.match(cli, /nonStrongRuns/u);
  assert.doesNotMatch(cli, /summary:\s*run|raw|market|odds/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync|send-line|notify|auto_purchase|auto_vote/u);
});
