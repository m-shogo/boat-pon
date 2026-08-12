import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/automation/researchDurableKnowledgeCompleteness.ts"),
  "utf8",
);
const legacySource = readFileSync(
  resolve(process.cwd(), "src/automation/researchDurableKnowledgeLegacyCompatibility.ts"),
  "utf8",
);
const cli = readFileSync(
  resolve(process.cwd(), "scripts/audit-research-durable-knowledge-completeness.ts"),
  "utf8",
);

test("completeness audit is read-only and isolated from production behavior", () => {
  assert.match(source, /RESEARCH_KNOWLEDGE_RETENTION_AUDIT_ONLY/u);
  assert.match(source, /automaticPromotionAuthorized:\s*false/u);
  assert.match(source, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(source, /lineConnectionAuthorized:\s*false/u);
  assert.match(source, /publicPublishAuthorized:\s*false/u);
  assert.match(source, /databaseWriteAuthorized:\s*false/u);
  assert.match(source, /automatedBettingAuthorized:\s*false/u);
  assert.match(source, /productionApplyAuthorized:\s*false/u);
  assert.doesNotMatch(source, /DatabaseSync|openDb|\bfetch\s*\(|child_process|execSync|spawnSync/u);
  assert.doesNotMatch(source, /app_settings|send-line|notify|auto_purchase|auto_vote/u);
});

test("completeness audit reads only automation history and approved durable output roots", () => {
  assert.match(source, /reports\/automation\/history/u);
  assert.match(source, /reports\/n2\//u);
  assert.match(source, /research\/registries\//u);
  assert.match(source, /automation\/control\//u);
  assert.match(source, /DURABLE_KNOWLEDGE_PATH_ESCAPES_ROOT/u);
  assert.match(source, /HISTORY_OUTPUT_PATH_NOT_APPROVED/u);
  assert.doesNotMatch(source, /data\/raw|data\/private|boat\.sqlite|sidecar/u);
});

test("durable history and output content use repo-root-anchored bounded descriptor reads", () => {
  assert.match(source, /const MAX_OUTPUT_BYTES = 32_000_000/u);
  assert.match(source, /const MAX_RETAINED_OUTPUT_BYTES = 2_097_152/u);
  assert.match(source, /const maxOutputBytes = rootClass === "RETAINED" \? MAX_RETAINED_OUTPUT_BYTES : MAX_OUTPUT_BYTES/u);
  assert.match(source, /readGovernanceFileUtf8Bounded\(absolutePath, maxOutputBytes, input\.repoRoot\)/u);
  assert.match(source, /readGovernanceFileUtf8Bounded\(absolutePath, MAX_HISTORY_BYTES, input\.repoRoot\)/u);
  assert.doesNotMatch(source, /readFileSync\(absolutePath/u);
});

test("audit distinguishes mutable supersession from append-only registry corruption", () => {
  assert.match(source, /CURRENT_OUTPUT_DIGEST_SUPERSEDED/u);
  assert.match(source, /DURABLE_MUTABLE_OUTPUT_SUPERSEDED/u);
  assert.match(source, /REGISTRY_SELF_DIGEST_VERIFIED/u);
  assert.match(source, /DURABLE_REGISTRY_SELF_DIGEST_INVALID/u);
  assert.match(source, /contractDigest/u);
});

test("persisted dry-run and unmarked PASS without outputs cannot be counted as durable", () => {
  assert.match(source, /INVALID_PERSISTED_DRY_RUN/u);
  assert.match(source, /PERSISTED_DRY_RUN_NOT_ALLOWED/u);
  assert.match(source, /INCOMPLETE_PASS_NO_OUTPUT/u);
  assert.match(source, /PASS_HAS_NO_DURABLE_OUTPUT/u);
  assert.match(source, /PASS_NO_CHANGE_HISTORY/u);
});

test("legacy compatibility is read-only, exact-scope, descriptor-bound, and never grants production authority", () => {
  assert.match(legacySource, /30878594429-TASK-N2-003\.json/u);
  assert.match(legacySource, /REQ-20260804-46393c12ed/u);
  assert.match(legacySource, /3d2d31d/u);
  assert.match(legacySource, /bd4bed76312255dd5434dc9668346ecb139934b05df2c48d86e8bece781987aa/u);
  assert.match(legacySource, /LEGACY_HISTORY_V0_ATTESTED_NO_INTENT_IDEMPOTENCY_FULL_SHA/u);
  assert.match(legacySource, /strongDurableComplete:\s*false/u);
  assert.match(legacySource, /readGovernanceFileUtf8/u);
  assert.doesNotMatch(legacySource, /readFileSync\(path/u);
  assert.doesNotMatch(legacySource, /writeFile|appendFile|mkdir|rename|DatabaseSync|\bfetch\s*\(|child_process|execSync|spawnSync/u);
  assert.doesNotMatch(legacySource, /data\/raw|data\/private|boat\.sqlite|sidecar|app_settings|send-line|notify|auto_purchase|auto_vote/u);
});

test("CLI emits audit metadata only and performs no writes", () => {
  assert.match(cli, /buildResearchDurableKnowledgeCompletenessReportWithLegacyCompatibility/u);
  assert.match(cli, /countAttestedLegacyDurableRuns/u);
  assert.match(cli, /argument\("repo-root"\)/u);
  assert.match(cli, /classificationCounts/u);
  assert.match(cli, /historyContentDigest/u);
  assert.match(cli, /legacyCompatibilityCount/u);
  assert.match(cli, /automaticPromotionAuthorized/u);
  assert.doesNotMatch(cli, /writeFile|appendFile|mkdir|rename|DatabaseSync|\bfetch\s*\(|send-line|notify/u);
});
