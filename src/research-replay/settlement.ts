import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { verifySidecarSchema } from "./schema";

export const N1_SETTLEMENT_SCHEMA_VERSION = "n1-settlement.0.1";
// v2: archive「特払い」をrace-wide返還と分離し、券種別special_payoutとして保持する。
export const N1_SETTLEMENT_PARSER_VERSION = "n1-settlement-parser-v2";

export const BET_TYPES = ["win", "place", "exacta", "quinella", "trifecta", "trio", "wide"] as const;
export type SettlementBetType = typeof BET_TYPES[number];
export type SettlementStatus = "pending" | "settled" | "refunded" | "partially_refunded" | "cancelled" | "no_sale";
export type ResultKind = "normal" | "dead_heat" | "special_payout" | "source_defined" | "unknown";
export type RevisionKind = "initial" | "official_correction" | "parser_reparse" | "source_revision";
export type ResolutionStatus = "resolved" | "source_conflict" | "unresolved" | "quarantined";
export type N1ParseStatus = "success" | "warning" | "error" | "unsupported_schema";

export type SelectionParse = {
  raw: string;
  normalized: string;
  canonical: string | null;
  valid: boolean;
  reason: string | null;
};

const WIDTH: Record<SettlementBetType, number> = {
  win: 1, place: 1, exacta: 2, quinella: 2, wide: 2, trifecta: 3, trio: 3,
};
const UNORDERED = new Set<SettlementBetType>(["quinella", "wide", "trio"]);

export function parseSettlementSelection(betType: SettlementBetType, raw: string): SelectionParse {
  const normalized = raw.normalize("NFKC").trim()
    .replace(/[→＞>]/g, "-")
    .replace(/[＝=・,，／/\\\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length !== WIDTH[betType]) {
    return { raw, normalized, canonical: null, valid: false, reason: "WRONG_SELECTION_ARITY" };
  }
  if (parts.some((part) => !/^[1-6]$/.test(part))) {
    return { raw, normalized, canonical: null, valid: false, reason: "BOAT_OUT_OF_RANGE" };
  }
  if (new Set(parts).size !== parts.length) {
    return { raw, normalized, canonical: null, valid: false, reason: "DUPLICATE_BOAT" };
  }
  const canonicalParts = UNORDERED.has(betType) ? [...parts].sort() : parts;
  return { raw, normalized, canonical: canonicalParts.join("-"), valid: true, reason: null };
}

const TABLES = [
  "settlement_candidates_v2", "race_payout_lines_v2", "race_refund_lines_v2",
  "settlement_evidence_pins_v2", "settlement_conflict_groups_v2",
  "settlement_conflict_members_v2", "settlement_resolution_events_v2",
] as const;

const N1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS n1_schema_migrations (
  migration_id TEXT PRIMARY KEY, migration_version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL, runtime_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applied','partial','failed'))
) STRICT;
CREATE TABLE IF NOT EXISTS settlement_candidates_v2 (
  candidate_id TEXT PRIMARY KEY,
  canonical_race_key TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK(bet_type IN ('win','place','exacta','quinella','trifecta','trio','wide')),
  settlement_status TEXT NOT NULL CHECK(settlement_status IN ('pending','settled','refunded','partially_refunded','cancelled','no_sale')),
  result_kind TEXT NOT NULL CHECK(result_kind IN ('normal','dead_heat','special_payout','source_defined','unknown')),
  revision_kind TEXT NOT NULL CHECK(revision_kind IN ('initial','official_correction','parser_reparse','source_revision')),
  resolution_status TEXT NOT NULL CHECK(resolution_status IN ('resolved','source_conflict','unresolved','quarantined')),
  source_kind TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  observation_id TEXT NOT NULL REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  parse_run_id TEXT NOT NULL REFERENCES parse_runs(parse_run_id) ON DELETE RESTRICT,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  semantic_hash TEXT NOT NULL CHECK(length(semantic_hash)=64),
  supersedes_candidate_id TEXT REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  correction_reason TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(observation_id, bet_type, semantic_hash)
) STRICT;
CREATE TABLE IF NOT EXISTS race_payout_lines_v2 (
  payout_line_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK(line_no>=1),
  bet_type TEXT NOT NULL CHECK(bet_type IN ('win','place','exacta','quinella','trifecta','trio','wide')),
  selection_raw TEXT NOT NULL, selection_normalized TEXT NOT NULL, selection_canonical TEXT,
  payout_yen INTEGER NOT NULL CHECK(payout_yen>=0), popularity INTEGER CHECK(popularity IS NULL OR popularity>=1),
  line_kind TEXT NOT NULL CHECK(line_kind IN ('payout','special_payout')),
  created_at TEXT NOT NULL, UNIQUE(candidate_id,line_no)
) STRICT;
CREATE TABLE IF NOT EXISTS race_refund_lines_v2 (
  refund_line_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  line_no INTEGER NOT NULL CHECK(line_no>=1),
  bet_type TEXT NOT NULL CHECK(bet_type IN ('win','place','exacta','quinella','trifecta','trio','wide')),
  selection_raw TEXT, selection_normalized TEXT, selection_canonical TEXT,
  refund_scope TEXT NOT NULL CHECK(refund_scope IN ('selection','bet_type','race')),
  refund_yen_per_100 INTEGER CHECK(refund_yen_per_100 IS NULL OR refund_yen_per_100>=0),
  reason_code TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(candidate_id,line_no)
) STRICT;
CREATE TABLE IF NOT EXISTS settlement_evidence_pins_v2 (
  pin_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN ('raw_document','parse_run','domain_observation')),
  evidence_id TEXT NOT NULL, evidence_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(candidate_id,evidence_type,evidence_id)
) STRICT;
CREATE TABLE IF NOT EXISTS settlement_conflict_groups_v2 (
  conflict_group_id TEXT PRIMARY KEY, canonical_race_key TEXT NOT NULL, bet_type TEXT NOT NULL,
  conflict_reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved','quarantined')),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS settlement_conflict_members_v2 (
  conflict_member_id TEXT PRIMARY KEY,
  conflict_group_id TEXT NOT NULL REFERENCES settlement_conflict_groups_v2(conflict_group_id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL, semantic_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(conflict_group_id,candidate_id)
) STRICT;
CREATE TABLE IF NOT EXISTS settlement_resolution_events_v2 (
  resolution_event_id TEXT PRIMARY KEY,
  conflict_group_id TEXT NOT NULL REFERENCES settlement_conflict_groups_v2(conflict_group_id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK(event_kind IN ('manual_resolution','quarantine','reopen')),
  selected_candidate_id TEXT REFERENCES settlement_candidates_v2(candidate_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL, actor TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
`;

function appendOnlySql(): string {
  return TABLES.flatMap((table) => [
    `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'append-only table'); END;`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'append-only table'); END;`,
  ]).join("\n");
}

export const N1_SETTLEMENT_MIGRATION_SQL = `${N1_SCHEMA_SQL}\n${appendOnlySql()}`;
export const N1_SETTLEMENT_MIGRATION_CHECKSUM = createHash("sha256").update(N1_SETTLEMENT_MIGRATION_SQL).digest("hex");

export function initializeN1SettlementSchema(db: DatabaseSync, now = new Date().toISOString()): void {
  if (!verifySidecarSchema(db).ok) throw new Error("F0 schema verification failed");
  db.exec(`CREATE TABLE IF NOT EXISTS n1_schema_migrations (
    migration_id TEXT PRIMARY KEY, migration_version TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL, runtime_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('applied','partial','failed'))
  ) STRICT`);
  const row = db.prepare("SELECT checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_SETTLEMENT_SCHEMA_VERSION) as { checksum: string; status: string } | undefined;
  if (row?.checksum !== undefined && row.checksum !== N1_SETTLEMENT_MIGRATION_CHECKSUM) {
    throw new Error("N1 migration checksum mismatch");
  }
  if (row?.status === "applied") return;
  if (!row) db.prepare(`INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')`)
    .run("rr-n1-settlement-001", N1_SETTLEMENT_SCHEMA_VERSION, N1_SETTLEMENT_MIGRATION_CHECKSUM, now, process.version);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(N1_SETTLEMENT_MIGRATION_SQL);
    db.prepare("UPDATE n1_schema_migrations SET status='applied',applied_at=?,runtime_version=? WHERE migration_version=?")
      .run(now, process.version, N1_SETTLEMENT_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifyN1SettlementSchema(db: DatabaseSync): {
  ok: boolean; version: string | null; checksumMatches: boolean; appendOnlyTriggerCount: number;
} {
  const hasLedger = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='n1_schema_migrations'",
  ).get());
  if (!hasLedger) {
    return { ok: false, version: null, checksumMatches: false, appendOnlyTriggerCount: 0 };
  }
  const row = db.prepare("SELECT migration_version,checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_SETTLEMENT_SCHEMA_VERSION) as { migration_version: string; checksum: string; status: string } | undefined;
  // N1 settlement tableに限定してtriggerを数える。F0-Rのrollout_approval_*_v2_append_only_*等を混入させない。
  const expectedTriggers = TABLES.flatMap((table) => [
    `${table}_append_only_update`,
    `${table}_append_only_delete`,
  ]);
  const placeholders = expectedTriggers.map(() => "?").join(",");
  const triggerCount = Number((db.prepare(
    `SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name IN (${placeholders})`,
  ).get(...expectedTriggers) as { count: number }).count);
  return {
    ok: verifySidecarSchema(db).ok && row?.status === "applied"
      && row.checksum === N1_SETTLEMENT_MIGRATION_CHECKSUM && triggerCount === TABLES.length * 2,
    version: row?.migration_version ?? null,
    checksumMatches: row?.checksum === N1_SETTLEMENT_MIGRATION_CHECKSUM,
    appendOnlyTriggerCount: triggerCount,
  };
}

// n1-settlement.0.2: expand-onlyでbackfill checkpoint tableを追加する（N1-Cで使用）。
// 0.1のtable/triggerは変更しない。checkpointはevent-sourced append-only（1 chunk試行=1 row、
// 最新rowが有効）。
export const N1_BACKFILL_SCHEMA_VERSION = "n1-settlement.0.2";

const N1_BACKFILL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS n1_settlement_backfill_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  archive_file TEXT NOT NULL,
  source_archive_sha256 TEXT NOT NULL CHECK(length(source_archive_sha256)=64),
  parser_version TEXT NOT NULL,
  source_schema_family TEXT NOT NULL,
  first_race_key TEXT,
  last_race_key TEXT,
  expected_race_count INTEGER NOT NULL CHECK(expected_race_count>=0),
  parsed_race_count INTEGER NOT NULL CHECK(parsed_race_count>=0),
  candidate_count INTEGER NOT NULL CHECK(candidate_count>=0),
  payout_line_count INTEGER NOT NULL CHECK(payout_line_count>=0),
  refund_line_count INTEGER NOT NULL CHECK(refund_line_count>=0),
  transaction_batch_size INTEGER NOT NULL CHECK(transaction_batch_size>=1),
  resume_token TEXT,
  state TEXT NOT NULL CHECK(state IN ('completed','failed','quarantined')),
  retry_count INTEGER NOT NULL CHECK(retry_count>=0),
  failure_reason TEXT,
  migration_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS n1_backfill_checkpoints_file ON n1_settlement_backfill_checkpoints(archive_file, created_at);
CREATE TRIGGER IF NOT EXISTS n1_settlement_backfill_checkpoints_append_only_update BEFORE UPDATE ON n1_settlement_backfill_checkpoints BEGIN SELECT RAISE(ABORT,'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS n1_settlement_backfill_checkpoints_append_only_delete BEFORE DELETE ON n1_settlement_backfill_checkpoints BEGIN SELECT RAISE(ABORT,'append-only table'); END;
`;

export const N1_BACKFILL_MIGRATION_CHECKSUM = createHash("sha256").update(N1_BACKFILL_SCHEMA_SQL).digest("hex");

// 0.1適用済みの上にexpand-onlyで0.2を積む。0.1未適用なら先に0.1を適用する。
export function initializeN1BackfillSchema(db: DatabaseSync, now = new Date().toISOString()): void {
  if (!verifyN1SettlementSchema(db).ok) initializeN1SettlementSchema(db, now);
  const row = db.prepare("SELECT checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_BACKFILL_SCHEMA_VERSION) as { checksum: string; status: string } | undefined;
  if (row?.checksum !== undefined && row.checksum !== N1_BACKFILL_MIGRATION_CHECKSUM) {
    throw new Error("N1 backfill migration checksum mismatch");
  }
  if (row?.status === "applied") return;
  if (!row) db.prepare(`INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')`)
    .run("rr-n1-settlement-002", N1_BACKFILL_SCHEMA_VERSION, N1_BACKFILL_MIGRATION_CHECKSUM, now, process.version);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(N1_BACKFILL_SCHEMA_SQL);
    db.prepare("UPDATE n1_schema_migrations SET status='applied',applied_at=?,runtime_version=? WHERE migration_version=?")
      .run(now, process.version, N1_BACKFILL_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifyN1BackfillSchema(db: DatabaseSync): {
  ok: boolean; version: string | null; checksumMatches: boolean; appendOnlyTriggerCount: number;
} {
  const hasTable = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='n1_settlement_backfill_checkpoints'",
  ).get());
  const hasLedger = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='n1_schema_migrations'",
  ).get());
  if (!hasLedger || !hasTable) return { ok: false, version: null, checksumMatches: false, appendOnlyTriggerCount: 0 };
  const row = db.prepare("SELECT migration_version,checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_BACKFILL_SCHEMA_VERSION) as { migration_version: string; checksum: string; status: string } | undefined;
  const triggerCount = Number((db.prepare(
    `SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name IN
     ('n1_settlement_backfill_checkpoints_append_only_update','n1_settlement_backfill_checkpoints_append_only_delete')`,
  ).get() as { count: number }).count);
  return {
    ok: verifyN1SettlementSchema(db).ok && row?.status === "applied"
      && row.checksum === N1_BACKFILL_MIGRATION_CHECKSUM && triggerCount === 2,
    version: row?.migration_version ?? null,
    checksumMatches: row?.checksum === N1_BACKFILL_MIGRATION_CHECKSUM,
    appendOnlyTriggerCount: triggerCount,
  };
}

export type BackfillCheckpointInput = {
  archiveFile: string;
  sourceArchiveSha256: string;
  parserVersion: string;
  sourceSchemaFamily: string;
  firstRaceKey: string | null;
  lastRaceKey: string | null;
  expectedRaceCount: number;
  parsedRaceCount: number;
  candidateCount: number;
  payoutLineCount: number;
  refundLineCount: number;
  transactionBatchSize: number;
  resumeToken: string | null;
  state: "completed" | "failed" | "quarantined";
  retryCount: number;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export class BackfillCheckpointRepository {
  constructor(private readonly db: DatabaseSync, private readonly idFactory: () => string = randomUUID) {}

  record(input: BackfillCheckpointInput): string {
    const id = this.idFactory();
    this.db.prepare(`
      INSERT INTO n1_settlement_backfill_checkpoints
      (checkpoint_id, archive_file, source_archive_sha256, parser_version, source_schema_family,
       first_race_key, last_race_key, expected_race_count, parsed_race_count, candidate_count,
       payout_line_count, refund_line_count, transaction_batch_size, resume_token, state,
       retry_count, failure_reason, migration_version, created_at, completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.archiveFile, input.sourceArchiveSha256, input.parserVersion, input.sourceSchemaFamily,
      input.firstRaceKey, input.lastRaceKey, input.expectedRaceCount, input.parsedRaceCount, input.candidateCount,
      input.payoutLineCount, input.refundLineCount, input.transactionBatchSize, input.resumeToken, input.state,
      input.retryCount, input.failureReason, N1_BACKFILL_SCHEMA_VERSION, canonicalUtcTimestamp(input.createdAt),
      input.completedAt ? canonicalUtcTimestamp(input.completedAt) : null,
    );
    return id;
  }

  latest(archiveFile: string): { state: string; retryCount: number } | null {
    const row = this.db.prepare(`
      SELECT state, retry_count FROM n1_settlement_backfill_checkpoints
      WHERE archive_file=? ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(archiveFile) as { state: string; retry_count: number } | undefined;
    return row ? { state: row.state, retryCount: row.retry_count } : null;
  }

  isCompleted(archiveFile: string): boolean {
    return this.latest(archiveFile)?.state === "completed";
  }

  completedCount(): number {
    return Number((this.db.prepare(`
      SELECT COUNT(*) c FROM (
        SELECT archive_file, state,
               ROW_NUMBER() OVER (PARTITION BY archive_file ORDER BY created_at DESC, rowid DESC) rn
        FROM n1_settlement_backfill_checkpoints
      ) WHERE rn=1 AND state='completed'
    `).get() as { c: number }).c);
  }
}

// n1-settlement.0.3: expand-onlyでsource-duplicate canonical resolution tableを追加する。
// 0.1/0.2のtable/trigger/checksumは変更しない。raw provenance（重複observation/candidate）は
// 削除せず保持し、canonical evaluationで重複copyを1回だけ有効化するためのappend-only mappingを持つ。
export const N1_CANONICAL_RESOLUTION_SCHEMA_VERSION = "n1-settlement.0.3";

const N1_CANONICAL_RESOLUTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settlement_source_duplicate_resolutions_v2 (
  resolution_id TEXT PRIMARY KEY,
  duplicate_observation_id TEXT NOT NULL REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  canonical_observation_id TEXT NOT NULL REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  canonical_race_key TEXT NOT NULL,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  source_archive_file TEXT NOT NULL,
  resolution_kind TEXT NOT NULL CHECK(resolution_kind IN ('source_duplicate')),
  detection_reason TEXT NOT NULL,
  duplicate_semantic_digest TEXT NOT NULL CHECK(length(duplicate_semantic_digest)=64),
  resolver_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(duplicate_observation_id <> canonical_observation_id),
  UNIQUE(duplicate_observation_id)
) STRICT;
CREATE INDEX IF NOT EXISTS ssdr_canonical_race ON settlement_source_duplicate_resolutions_v2(canonical_race_key);
CREATE INDEX IF NOT EXISTS ssdr_canonical_obs ON settlement_source_duplicate_resolutions_v2(canonical_observation_id);
CREATE TRIGGER IF NOT EXISTS settlement_source_duplicate_resolutions_v2_append_only_update BEFORE UPDATE ON settlement_source_duplicate_resolutions_v2 BEGIN SELECT RAISE(ABORT,'append-only table'); END;
CREATE TRIGGER IF NOT EXISTS settlement_source_duplicate_resolutions_v2_append_only_delete BEFORE DELETE ON settlement_source_duplicate_resolutions_v2 BEGIN SELECT RAISE(ABORT,'append-only table'); END;
`;

export const N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM = createHash("sha256").update(N1_CANONICAL_RESOLUTION_SCHEMA_SQL).digest("hex");

export function initializeN1CanonicalResolutionSchema(db: DatabaseSync, now = new Date().toISOString()): void {
  if (!verifyN1SettlementSchema(db).ok) initializeN1SettlementSchema(db, now);
  const row = db.prepare("SELECT checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_CANONICAL_RESOLUTION_SCHEMA_VERSION) as { checksum: string; status: string } | undefined;
  if (row?.checksum !== undefined && row.checksum !== N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM) {
    throw new Error("N1 canonical resolution migration checksum mismatch");
  }
  if (row?.status === "applied") return;
  if (!row) db.prepare(`INSERT INTO n1_schema_migrations VALUES (?,?,?,?,?,'partial')`)
    .run("rr-n1-settlement-003", N1_CANONICAL_RESOLUTION_SCHEMA_VERSION, N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM, now, process.version);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(N1_CANONICAL_RESOLUTION_SCHEMA_SQL);
    db.prepare("UPDATE n1_schema_migrations SET status='applied',applied_at=?,runtime_version=? WHERE migration_version=?")
      .run(now, process.version, N1_CANONICAL_RESOLUTION_SCHEMA_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifyN1CanonicalResolutionSchema(db: DatabaseSync): {
  ok: boolean; version: string | null; checksumMatches: boolean; appendOnlyTriggerCount: number;
} {
  const hasTable = Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='settlement_source_duplicate_resolutions_v2'",
  ).get());
  const hasLedger = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='n1_schema_migrations'").get());
  if (!hasLedger || !hasTable) return { ok: false, version: null, checksumMatches: false, appendOnlyTriggerCount: 0 };
  const row = db.prepare("SELECT migration_version,checksum,status FROM n1_schema_migrations WHERE migration_version=?")
    .get(N1_CANONICAL_RESOLUTION_SCHEMA_VERSION) as { migration_version: string; checksum: string; status: string } | undefined;
  const triggerCount = Number((db.prepare(
    `SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name IN
     ('settlement_source_duplicate_resolutions_v2_append_only_update','settlement_source_duplicate_resolutions_v2_append_only_delete')`,
  ).get() as { count: number }).count);
  return {
    ok: verifyN1SettlementSchema(db).ok && row?.status === "applied"
      && row.checksum === N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM && triggerCount === 2,
    version: row?.migration_version ?? null,
    checksumMatches: row?.checksum === N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM,
    appendOnlyTriggerCount: triggerCount,
  };
}

export type SourceDuplicateResolutionInput = {
  duplicateObservationId: string;
  canonicalObservationId: string;
  canonicalRaceKey: string;
  rawDocumentId: string;
  sourceArchiveFile: string;
  detectionReason: string;
  duplicateSemanticDigest: string;
  resolverVersion: string;
  policyVersion: string;
  detectedAt: string;
};

export class SourceDuplicateResolutionRepository {
  constructor(private readonly db: DatabaseSync, private readonly idFactory: () => string = randomUUID) {}

  // append-only。既に同一 duplicate_observation_id が解決済みなら no-op（冪等）。
  record(input: SourceDuplicateResolutionInput): { resolutionId: string; inserted: boolean } {
    const existing = this.db.prepare(
      "SELECT resolution_id FROM settlement_source_duplicate_resolutions_v2 WHERE duplicate_observation_id=?",
    ).get(input.duplicateObservationId) as { resolution_id: string } | undefined;
    if (existing) return { resolutionId: existing.resolution_id, inserted: false };
    const id = this.idFactory();
    const now = canonicalUtcTimestamp(input.detectedAt);
    this.db.prepare(`
      INSERT INTO settlement_source_duplicate_resolutions_v2
      (resolution_id, duplicate_observation_id, canonical_observation_id, canonical_race_key,
       raw_document_id, source_archive_file, resolution_kind, detection_reason,
       duplicate_semantic_digest, resolver_version, policy_version, schema_version, detected_at, created_at)
      VALUES (?,?,?,?,?,?, 'source_duplicate', ?,?,?,?,?,?,?)
    `).run(
      id, input.duplicateObservationId, input.canonicalObservationId, input.canonicalRaceKey,
      input.rawDocumentId, input.sourceArchiveFile, input.detectionReason, input.duplicateSemanticDigest,
      input.resolverVersion, input.policyVersion, N1_CANONICAL_RESOLUTION_SCHEMA_VERSION, now, now,
    );
    return { resolutionId: id, inserted: true };
  }

  resolvedCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) c FROM settlement_source_duplicate_resolutions_v2").get() as { c: number }).c);
  }
}

export type CandidateInput = {
  canonicalRaceKey: string;
  betType: SettlementBetType;
  settlementStatus: SettlementStatus;
  resultKind: ResultKind;
  revisionKind: RevisionKind;
  resolutionStatus: ResolutionStatus;
  sourceKind: string;
  sourceSchemaVersion: string;
  observationId: string;
  parseRunId: string;
  rawDocumentId: string;
  observedAt: string;
  supersedesCandidateId?: string | null;
  correctionReason?: string | null;
  payouts: Array<{ selection: string; payoutYen: number; popularity?: number | null; lineKind?: "payout" | "special_payout" }>;
  refunds?: Array<{ selection?: string | null; scope: "selection" | "bet_type" | "race"; refundYenPer100?: number | null; reasonCode: string }>;
  // Option B: falseにするとexplicit evidence pinを保存しない。candidateの
  // raw_document_id/parse_run_id/observation_id へのON DELETE RESTRICT FKを暗黙GC pinとして扱う。
  // 既定trueでN1-A挙動を維持。full backfill(N1-C)はfalseで約3行/candidateの重複を削減する。
  emitEvidencePins?: boolean;
  // trueにするとappendCandidate内でBEGIN/COMMIT/ROLLBACKを発行せず、呼び出し側transactionへ委ねる。
  // backfillのper-file atomic batch用。既定falseでcandidate毎に自己完結transaction（N1-A挙動不変）。
  withinTransaction?: boolean;
};

export class SettlementRepository {
  constructor(private readonly db: DatabaseSync, private readonly idFactory: () => string = randomUUID) {}

  appendCandidate(input: CandidateInput): { candidateId: string; inserted: boolean; semanticHash: string } {
    const parse = this.db.prepare("SELECT status,raw_document_id FROM parse_runs WHERE parse_run_id=?")
      .get(input.parseRunId) as { status: string; raw_document_id: string } | undefined;
    if (!parse || !["success", "warning"].includes(parse.status)) throw new Error("PARSE_STATUS_FORBIDS_CANDIDATE");
    if (parse.raw_document_id !== input.rawDocumentId) throw new Error("RAW_PARSE_LINEAGE_MISMATCH");
    const parsedPayoutLines = input.payouts.map((line) => {
      const selection = parseSettlementSelection(input.betType, line.selection);
      const special = (line.lineKind ?? "payout") === "special_payout";
      if (!special && (!selection.valid || !selection.canonical)) throw new Error(selection.reason ?? "INVALID_SELECTION");
      if (!Number.isInteger(line.payoutYen) || line.payoutYen < 0) throw new Error("INVALID_PAYOUT");
      return { ...line, selection: special && !selection.valid ? { ...selection, canonical: null } : selection };
    });
    const payoutSeen = new Set<string>();
    const payoutLines = parsedPayoutLines.filter((line) => {
      const key = canonicalHash([line.selection.canonical, line.payoutYen, line.popularity ?? null, line.lineKind ?? "payout"]);
      if (payoutSeen.has(key)) return false;
      payoutSeen.add(key);
      return true;
    });
    const parsedRefundLines = (input.refunds ?? []).map((line) => {
      const selection = line.selection == null ? null : parseSettlementSelection(input.betType, line.selection);
      if (selection && (!selection.valid || !selection.canonical)) throw new Error(selection.reason ?? "INVALID_REFUND_SELECTION");
      return { ...line, selection };
    });
    const refundSeen = new Set<string>();
    const refundLines = parsedRefundLines.filter((line) => {
      const key = canonicalHash([line.selection?.canonical ?? null, line.scope, line.refundYenPer100 ?? null, line.reasonCode]);
      if (refundSeen.has(key)) return false;
      refundSeen.add(key);
      return true;
    });
    if (["pending", "no_sale"].includes(input.settlementStatus) && (payoutLines.length || refundLines.length)) {
      throw new Error("STATE_FORBIDS_SETTLEMENT_LINES");
    }
    if (input.settlementStatus === "partially_refunded" && (!payoutLines.length || !refundLines.length)) {
      throw new Error("PARTIAL_REFUND_REQUIRES_PAYOUT_AND_REFUND");
    }
    if (input.settlementStatus === "refunded" && (payoutLines.length || !refundLines.length)) {
      throw new Error("REFUNDED_REQUIRES_REFUND_ONLY");
    }
    if (input.revisionKind !== "initial" && (!input.supersedesCandidateId || !input.correctionReason)) {
      throw new Error("REVISION_REQUIRES_SUPERSESSION_AND_REASON");
    }
    const semanticHash = canonicalHash({
      betType: input.betType, settlementStatus: input.settlementStatus, resultKind: input.resultKind,
      payouts: payoutLines.map((line) => [line.selection.canonical, line.payoutYen, line.popularity ?? null, line.lineKind ?? "payout"]),
      refunds: refundLines.map((line) => [line.selection?.canonical ?? null, line.scope, line.refundYenPer100 ?? null, line.reasonCode]),
    });
    const existing = this.db.prepare(`
      SELECT candidate_id AS candidateId,
             canonical_race_key AS canonicalRaceKey,
             settlement_status AS settlementStatus,
             result_kind AS resultKind,
             revision_kind AS revisionKind,
             resolution_status AS resolutionStatus,
             source_kind AS sourceKind,
             source_schema_version AS sourceSchemaVersion,
             parse_run_id AS parseRunId,
             raw_document_id AS rawDocumentId,
             supersedes_candidate_id AS supersedesCandidateId,
             correction_reason AS correctionReason
      FROM settlement_candidates_v2
      WHERE observation_id=? AND bet_type=? AND semantic_hash=?
    `).get(input.observationId, input.betType, semanticHash) as {
      candidateId: string;
      canonicalRaceKey: string;
      settlementStatus: string;
      resultKind: string;
      revisionKind: string;
      resolutionStatus: string;
      sourceKind: string;
      sourceSchemaVersion: string;
      parseRunId: string;
      rawDocumentId: string;
      supersedesCandidateId: string | null;
      correctionReason: string | null;
    } | undefined;
    if (existing) {
      if (existing.canonicalRaceKey !== input.canonicalRaceKey
        || existing.settlementStatus !== input.settlementStatus
        || existing.resultKind !== input.resultKind
        || existing.revisionKind !== input.revisionKind
        || existing.resolutionStatus !== input.resolutionStatus
        || existing.sourceKind !== input.sourceKind
        || existing.sourceSchemaVersion !== input.sourceSchemaVersion
        || existing.parseRunId !== input.parseRunId
        || existing.rawDocumentId !== input.rawDocumentId
        || existing.supersedesCandidateId !== (input.supersedesCandidateId ?? null)
        || existing.correctionReason !== (input.correctionReason ?? null)) {
        throw new Error(`SETTLEMENT_CANDIDATE_REUSE_CONFLICT:${existing.candidateId}`);
      }
      return { candidateId: existing.candidateId, inserted: false, semanticHash };
    }
    const candidateId = this.idFactory();
    const now = canonicalUtcTimestamp(input.observedAt);
    // withinTransaction=trueなら呼び出し側がtransactionを管理する（backfillのper-file atomic batch）。
    // 既定はfalseでcandidate毎にBEGIN/COMMITする（N1-A挙動不変）。
    const manageTransaction = !(input.withinTransaction ?? false);
    if (manageTransaction) this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO settlement_candidates_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        candidateId, input.canonicalRaceKey, input.betType, input.settlementStatus, input.resultKind,
        input.revisionKind, input.resolutionStatus, input.sourceKind, input.sourceSchemaVersion,
        input.observationId, input.parseRunId, input.rawDocumentId, semanticHash,
        input.supersedesCandidateId ?? null, input.correctionReason ?? null, now, now,
      );
      const payout = this.db.prepare(`INSERT INTO race_payout_lines_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      payoutLines.forEach((line, index) => payout.run(
        this.idFactory(), candidateId, index + 1, input.betType, line.selection.raw,
        line.selection.normalized, line.selection.canonical, line.payoutYen, line.popularity ?? null,
        line.lineKind ?? "payout", now,
      ));
      const refund = this.db.prepare(`INSERT INTO race_refund_lines_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      refundLines.forEach((line, index) => refund.run(
        this.idFactory(), candidateId, index + 1, input.betType, line.selection?.raw ?? null,
        line.selection?.normalized ?? null, line.selection?.canonical ?? null, line.scope,
        line.refundYenPer100 ?? null, line.reasonCode, now,
      ));
      if (input.emitEvidencePins ?? true) {
        const evidenceHash = canonicalHash({ rawDocumentId: input.rawDocumentId, parseRunId: input.parseRunId, observationId: input.observationId });
        const pin = this.db.prepare(`INSERT INTO settlement_evidence_pins_v2 VALUES (?,?,?,?,?,?)`);
        pin.run(this.idFactory(), candidateId, "raw_document", input.rawDocumentId, evidenceHash, now);
        pin.run(this.idFactory(), candidateId, "parse_run", input.parseRunId, evidenceHash, now);
        pin.run(this.idFactory(), candidateId, "domain_observation", input.observationId, evidenceHash, now);
      }
      if (manageTransaction) this.db.exec("COMMIT");
    } catch (error) {
      if (manageTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
    return { candidateId, inserted: true, semanticHash };
  }

  createConflict(input: {
    canonicalRaceKey: string; betType: SettlementBetType; candidateIds: string[];
    reason: string; createdAt: string;
  }): string | null {
    const rows = input.candidateIds.map((id) => this.db.prepare(
      "SELECT candidate_id,source_kind,semantic_hash FROM settlement_candidates_v2 WHERE candidate_id=?",
    ).get(id) as { candidate_id: string; source_kind: string; semantic_hash: string } | undefined);
    if (rows.some((row) => !row)) throw new Error("CONFLICT_CANDIDATE_MISSING");
    if (new Set(rows.map((row) => row!.semantic_hash)).size < 2) return null;
    const groupId = this.idFactory();
    const now = canonicalUtcTimestamp(input.createdAt);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO settlement_conflict_groups_v2 VALUES (?,?,?,?,?,?)")
        .run(groupId, input.canonicalRaceKey, input.betType, input.reason, "open", now);
      const statement = this.db.prepare("INSERT INTO settlement_conflict_members_v2 VALUES (?,?,?,?,?,?)");
      rows.forEach((row) => statement.run(this.idFactory(), groupId, row!.candidate_id, row!.source_kind, row!.semantic_hash, now));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return groupId;
  }

  appendResolutionEvent(input: {
    conflictGroupId: string;
    eventKind: "manual_resolution" | "quarantine" | "reopen";
    selectedCandidateId?: string | null;
    reason: string;
    actor: string;
    occurredAt: string;
  }): string {
    if (input.eventKind === "manual_resolution" && !input.selectedCandidateId) {
      throw new Error("MANUAL_RESOLUTION_REQUIRES_CANDIDATE");
    }
    if (input.selectedCandidateId) {
      const member = this.db.prepare(`
        SELECT 1 found FROM settlement_conflict_members_v2
        WHERE conflict_group_id=? AND candidate_id=?
      `).get(input.conflictGroupId, input.selectedCandidateId);
      if (!member) throw new Error("RESOLUTION_CANDIDATE_NOT_IN_CONFLICT");
    }
    const id = this.idFactory();
    const now = canonicalUtcTimestamp(input.occurredAt);
    this.db.prepare("INSERT INTO settlement_resolution_events_v2 VALUES (?,?,?,?,?,?,?,?)").run(
      id, input.conflictGroupId, input.eventKind, input.selectedCandidateId ?? null,
      input.reason, input.actor, now, now,
    );
    return id;
  }
}
