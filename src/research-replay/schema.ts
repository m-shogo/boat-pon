import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SIDECAR_SCHEMA_VERSION = "f0.1.0";
export const SIDECAR_USER_VERSION = 100;
export const SIDECAR_READER_VERSION = "f0-reader-v1";
export const SIDECAR_WRITER_VERSION = "f0-writer-v1";
export const ROLLOUT_SCHEMA_VERSION = "f0r.2.0";
export const ROLLOUT_USER_VERSION = SIDECAR_USER_VERSION;
export const ROLLOUT_READER_VERSION = "f0r-reader-v1";
export const ROLLOUT_WRITER_VERSION = "f0r-writer-v1";

const EVIDENCE_TABLES = [
  "capture_attempts",
  "capture_attempt_events",
  "raw_documents",
  "capture_raw_links",
  "parse_runs",
  "domain_observations",
  "typed_observation_payloads",
  "asof_resolution_policies",
  "race_asof_manifests",
  "race_asof_manifest_expectations",
  "race_asof_manifest_items",
  "evidence_pins",
  "evidence_tombstones",
  "race_identity_aliases",
] as const;

const CORE_SCHEMA = `
CREATE TABLE research_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  migration_version TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'partial', 'failed'))
) STRICT;

CREATE TABLE capture_attempts (
  capture_attempt_id TEXT PRIMARY KEY,
  logical_request_group_id TEXT NOT NULL,
  canonical_race_key TEXT,
  source_url_redacted TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'LOCAL_FIXTURE', 'EXISTING_CACHE')),
  request_started_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE capture_attempt_events (
  event_id TEXT PRIMARY KEY,
  capture_attempt_id TEXT NOT NULL REFERENCES capture_attempts(capture_attempt_id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'capture_started', 'response_headers_received', 'body_completed', 'capture_failed', 'capture_cancelled'
  )),
  occurred_at TEXT NOT NULL,
  http_status INTEGER,
  failure_reason TEXT CHECK (failure_reason IS NULL OR failure_reason IN (
    'network_not_reached', 'timeout', 'partial_body', 'hash_mismatch',
    'process_crash_detected', 'cancelled', 'unsupported_content_type',
    'body_too_large', 'decompression_limit', 'unknown_charset'
  )),
  response_header_metadata TEXT,
  byte_count INTEGER CHECK (byte_count IS NULL OR byte_count >= 0),
  detail_json TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER capture_event_no_after_terminal
BEFORE INSERT ON capture_attempt_events
WHEN EXISTS (
  SELECT 1 FROM capture_attempt_events
  WHERE capture_attempt_id = NEW.capture_attempt_id
    AND event_kind IN ('body_completed', 'capture_failed', 'capture_cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'capture attempt already terminal');
END;

CREATE TABLE raw_documents (
  raw_document_id TEXT PRIMARY KEY,
  raw_sha256 TEXT NOT NULL UNIQUE CHECK (length(raw_sha256) = 64),
  entity_body_byte_length INTEGER NOT NULL CHECK (entity_body_byte_length >= 0),
  content_type TEXT NOT NULL,
  charset TEXT,
  content_encoding TEXT,
  compressed_byte_length INTEGER,
  decompression_ratio REAL,
  integrity_status TEXT NOT NULL CHECK (integrity_status IN ('verified', 'quarantined')),
  storage_type TEXT NOT NULL CHECK (storage_type = 'content_addressed_filesystem'),
  storage_path TEXT NOT NULL UNIQUE,
  first_recorded_at TEXT NOT NULL,
  retention_class TEXT NOT NULL,
  parser_replay_eligible INTEGER NOT NULL CHECK (parser_replay_eligible IN (0, 1)),
  security_scan_status TEXT NOT NULL CHECK (security_scan_status IN ('passed', 'quarantined')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE capture_raw_links (
  capture_attempt_id TEXT PRIMARY KEY REFERENCES capture_attempts(capture_attempt_id) ON DELETE RESTRICT,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  body_completed_event_id TEXT NOT NULL UNIQUE REFERENCES capture_attempt_events(event_id) ON DELETE RESTRICT,
  linked_at TEXT NOT NULL
) STRICT;

CREATE TABLE parse_runs (
  parse_run_id TEXT PRIMARY KEY,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  canonicalization_version TEXT NOT NULL,
  payload_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'error', 'unknown_schema')),
  warning_codes TEXT NOT NULL,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  semantic_payload_hash TEXT,
  supersedes_id TEXT REFERENCES parse_runs(parse_run_id) ON DELETE RESTRICT,
  correction_kind TEXT,
  correction_reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE domain_observations (
  observation_id TEXT PRIMARY KEY,
  canonical_race_key TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  payload_type TEXT NOT NULL,
  payload_schema_version TEXT NOT NULL,
  parse_run_id TEXT NOT NULL REFERENCES parse_runs(parse_run_id) ON DELETE RESTRICT,
  raw_document_id TEXT NOT NULL REFERENCES raw_documents(raw_document_id) ON DELETE RESTRICT,
  source_published_at TEXT,
  source_observed_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  timing_quality TEXT NOT NULL CHECK (timing_quality IN ('source_exact', 'observed_only', 'ambiguous', 'unknown')),
  source_quality TEXT NOT NULL CHECK (source_quality IN ('official_public', 'derived_existing_row', 'sanitized_fixture')),
  measurement_quality TEXT NOT NULL,
  semantic_payload_hash TEXT NOT NULL,
  supersedes_id TEXT REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  correction_kind TEXT,
  correction_reason TEXT,
  recorded_at TEXT NOT NULL,
  effective_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE typed_observation_payloads (
  observation_id TEXT PRIMARY KEY REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  payload_type TEXT NOT NULL,
  payload_schema_version TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE asof_resolution_policies (
  policy_version TEXT PRIMARY KEY,
  purpose TEXT NOT NULL UNIQUE,
  required_observation_types TEXT NOT NULL,
  optional_observation_types TEXT NOT NULL,
  source_priority TEXT NOT NULL,
  max_staleness_seconds INTEGER NOT NULL,
  timestamp_unknown_policy TEXT NOT NULL,
  tie_break_policy TEXT NOT NULL,
  fallback_policy TEXT NOT NULL,
  forbidden_observation_types TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE race_asof_manifests (
  manifest_id TEXT PRIMARY KEY,
  canonical_race_key TEXT NOT NULL,
  as_of_at TEXT NOT NULL,
  purpose TEXT NOT NULL,
  strict_mode INTEGER NOT NULL CHECK (strict_mode IN (0, 1)),
  manifest_version TEXT NOT NULL,
  resolver_policy_version TEXT NOT NULL REFERENCES asof_resolution_policies(policy_version) ON DELETE RESTRICT,
  canonicalization_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  git_commit_sha TEXT NOT NULL,
  timezone_policy_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE,
  max_source_published_at TEXT,
  max_source_observed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'incomplete', 'blocked')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE race_asof_manifest_expectations (
  expectation_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES race_asof_manifests(manifest_id) ON DELETE RESTRICT,
  expected_observation_type TEXT NOT NULL,
  requirement TEXT NOT NULL CHECK (requirement IN ('required', 'optional')),
  completeness_state TEXT NOT NULL CHECK (completeness_state IN (
    'found', 'missing', 'stale', 'rejected', 'not_published', 'not_observed',
    'not_offered', 'parse_error', 'timing_ambiguous', 'point_in_time_ineligible'
  )),
  selected_observation_id TEXT REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  searched_sources TEXT NOT NULL,
  searched_from TEXT NOT NULL,
  searched_to TEXT NOT NULL,
  rejection_code TEXT,
  missing_reason TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (manifest_id, expected_observation_type)
) STRICT;

CREATE TABLE race_asof_manifest_items (
  manifest_item_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES race_asof_manifests(manifest_id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL REFERENCES domain_observations(observation_id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  inclusion_reason TEXT NOT NULL,
  quality_flags TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (manifest_id, observation_id)
) STRICT;

CREATE TABLE evidence_pins (
  pin_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL REFERENCES race_asof_manifests(manifest_id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('raw_document', 'parse_run', 'domain_observation')),
  evidence_id TEXT NOT NULL,
  pin_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (manifest_id, evidence_type, evidence_id)
) STRICT;

CREATE TABLE evidence_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  evidence_type TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE race_identity_aliases (
  alias_id TEXT PRIMARY KEY,
  canonical_race_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_race_id TEXT NOT NULL,
  source_url_redacted TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (source_type, source_race_id)
) STRICT;

CREATE INDEX domain_observations_race_type_time
ON domain_observations(canonical_race_key, observation_type, source_observed_at);
CREATE INDEX parse_runs_raw ON parse_runs(raw_document_id);
CREATE INDEX capture_events_attempt ON capture_attempt_events(capture_attempt_id, occurred_at);
`;

function appendOnlyTriggers(): string {
  return EVIDENCE_TABLES.map((table) => `
CREATE TRIGGER ${table}_append_only_update
BEFORE UPDATE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is append-only');
END;
CREATE TRIGGER ${table}_append_only_delete
BEFORE DELETE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is append-only');
END;
`).join("\n");
}

export const F0_MIGRATION_SQL = `${CORE_SCHEMA}\n${appendOnlyTriggers()}\nPRAGMA user_version = ${SIDECAR_USER_VERSION};`;
export const F0_MIGRATION_CHECKSUM = createHash("sha256").update(F0_MIGRATION_SQL, "utf8").digest("hex");

const ROLLOUT_EVENT_TABLES = [
  "rollout_approval_events",
  "rollout_config_events",
  "shadow_outbox_messages",
  "shadow_delivery_attempts",
  "operational_audit_events",
] as const;

export const F0R_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS rollout_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  migration_version TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'partial', 'failed'))
) STRICT;
`;

const ROLLOUT_SCHEMA = `
CREATE TABLE IF NOT EXISTS rollout_schema_contract (
  schema_version TEXT PRIMARY KEY,
  minimum_reader_version TEXT NOT NULL,
  minimum_writer_version TEXT NOT NULL,
  base_schema_version TEXT NOT NULL,
  migration_checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rollout_approval_events (
  approval_event_id TEXT PRIMARY KEY,
  approval_scope TEXT NOT NULL,
  approval_source TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  detail_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS rollout_config_events (
  config_event_id TEXT PRIMARY KEY,
  shadow_write_enabled INTEGER NOT NULL CHECK (shadow_write_enabled IN (0, 1)),
  operational_gc_enabled INTEGER NOT NULL CHECK (operational_gc_enabled IN (0, 1)),
  kill_switch_engaged INTEGER NOT NULL CHECK (kill_switch_engaged IN (0, 1)),
  queue_capacity INTEGER NOT NULL CHECK (queue_capacity BETWEEN 1 AND 10000),
  max_retries INTEGER NOT NULL CHECK (max_retries BETWEEN 0 AND 20),
  storage_quota_bytes INTEGER NOT NULL CHECK (storage_quota_bytes > 0),
  disk_low_water_bytes INTEGER NOT NULL CHECK (disk_low_water_bytes >= 0),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS shadow_outbox_messages (
  outbox_message_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  enqueued_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS shadow_delivery_attempts (
  delivery_attempt_id TEXT PRIMARY KEY,
  outbox_message_id TEXT NOT NULL REFERENCES shadow_outbox_messages(outbox_message_id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'retryable_failure', 'permanent_failure', 'cancelled')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  next_available_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (outbox_message_id, attempt_no)
) STRICT;

CREATE TABLE IF NOT EXISTS operational_audit_events (
  audit_event_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'gc_intent', 'gc_deleted', 'gc_recovered', 'gc_rejected',
    'backup_started', 'backup_completed', 'restore_verified',
    'rollback_started', 'rollback_completed',
    'health_snapshot'
  )),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS shadow_delivery_message_attempt
ON shadow_delivery_attempts(outbox_message_id, attempt_no);
CREATE INDEX IF NOT EXISTS operational_audit_operation
ON operational_audit_events(operation_id, occurred_at);
`;

function rolloutAppendOnlyTriggers(): string {
  return ROLLOUT_EVENT_TABLES.map((table) => `
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_update
BEFORE UPDATE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is append-only');
END;
CREATE TRIGGER IF NOT EXISTS ${table}_append_only_delete
BEFORE DELETE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} is append-only');
END;
`).join("\n");
}

export const F0R_MIGRATION_SQL = `${F0R_LEDGER_SQL}\n${ROLLOUT_SCHEMA}\n${rolloutAppendOnlyTriggers()}\nPRAGMA user_version = ${ROLLOUT_USER_VERSION};`;
export const F0R_MIGRATION_CHECKSUM = createHash("sha256").update(F0R_MIGRATION_SQL, "utf8").digest("hex");

export type SchemaVerification = {
  schemaVersion: string | null;
  migrationChecksum: string | null;
  expectedChecksum: string;
  userVersion: number;
  partialMigration: boolean;
  unknownSchema: boolean;
  readerContract: string;
  writerContract: string;
  ok: boolean;
};

export function openSidecarDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
  return db;
}

export function openRolloutDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 1000;
  `);
  return db;
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

export function initializeSidecarSchema(db: DatabaseSync, now = new Date().toISOString()): void {
  const userVersion = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const hasLedger = hasTable(db, "research_schema_migrations");
  if (userVersion !== 0 || hasLedger) {
    const verification = verifySidecarSchema(db);
    if (!verification.ok) throw new Error(`sidecar schema refused: ${JSON.stringify(verification)}`);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(F0_MIGRATION_SQL);
    db.prepare(`
      INSERT INTO research_schema_migrations
      (migration_id, migration_version, checksum, applied_at, runtime_version, status)
      VALUES (?, ?, ?, ?, ?, 'applied')
    `).run("rr-f0-001", SIDECAR_SCHEMA_VERSION, F0_MIGRATION_CHECKSUM, now, process.version);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifySidecarSchema(db: DatabaseSync): SchemaVerification {
  const userVersion = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (!hasTable(db, "research_schema_migrations")) {
    return {
      schemaVersion: null,
      migrationChecksum: null,
      expectedChecksum: F0_MIGRATION_CHECKSUM,
      userVersion,
      partialMigration: userVersion !== 0,
      unknownSchema: userVersion !== 0,
      readerContract: SIDECAR_READER_VERSION,
      writerContract: SIDECAR_WRITER_VERSION,
      ok: false,
    };
  }
  const row = db.prepare(`
    SELECT migration_version, checksum, status
    FROM research_schema_migrations
    WHERE migration_version = ?
    LIMIT 1
  `).get(SIDECAR_SCHEMA_VERSION) as { migration_version: string; checksum: string; status: string } | undefined;
  const partialMigration = !row || row.status !== "applied";
  const unknownSchema = userVersion !== SIDECAR_USER_VERSION
    || row?.migration_version !== SIDECAR_SCHEMA_VERSION;
  const checksumMatches = row?.checksum === F0_MIGRATION_CHECKSUM;
  return {
    schemaVersion: row?.migration_version ?? null,
    migrationChecksum: row?.checksum ?? null,
    expectedChecksum: F0_MIGRATION_CHECKSUM,
    userVersion,
    partialMigration,
    unknownSchema,
    readerContract: SIDECAR_READER_VERSION,
    writerContract: SIDECAR_WRITER_VERSION,
    ok: !partialMigration && !unknownSchema && checksumMatches,
  };
}

export type RolloutSchemaVerification = {
  base: SchemaVerification;
  schemaVersion: string | null;
  migrationChecksum: string | null;
  expectedChecksum: string;
  userVersion: number;
  minimumReaderVersion: string | null;
  minimumWriterVersion: string | null;
  partialMigration: boolean;
  unknownSchema: boolean;
  oldReaderCompatible: boolean;
  shadowDefaultOff: boolean;
  ok: boolean;
};

export function initializeRolloutSchema(db: DatabaseSync, now = new Date().toISOString()): void {
  db.exec(F0R_LEDGER_SQL);
  initializeSidecarSchema(db, now);
  const existing = db.prepare(`
    SELECT checksum, status FROM rollout_schema_migrations WHERE migration_version = ?
  `).get(ROLLOUT_SCHEMA_VERSION) as { checksum: string; status: string } | undefined;
  if (existing?.status === "applied") {
    const verification = verifyRolloutSchema(db);
    if (!verification.ok) throw new Error(`rollout schema refused: ${JSON.stringify(verification)}`);
    return;
  }
  if (existing && existing.checksum !== F0R_MIGRATION_CHECKSUM) {
    throw new Error("rollout partial migration checksum mismatch");
  }
  if (!existing) {
    db.prepare(`
      INSERT INTO rollout_schema_migrations
      (migration_id, migration_version, checksum, applied_at, runtime_version, status)
      VALUES (?, ?, ?, ?, ?, 'partial')
    `).run("rr-f0r-002", ROLLOUT_SCHEMA_VERSION, F0R_MIGRATION_CHECKSUM, now, process.version);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(F0R_MIGRATION_SQL);
    db.prepare(`
      INSERT INTO rollout_schema_contract
      (schema_version, minimum_reader_version, minimum_writer_version,
       base_schema_version, migration_checksum, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(schema_version) DO UPDATE SET
        minimum_reader_version=excluded.minimum_reader_version,
        minimum_writer_version=excluded.minimum_writer_version,
        base_schema_version=excluded.base_schema_version,
        migration_checksum=excluded.migration_checksum
    `).run(
      ROLLOUT_SCHEMA_VERSION,
      SIDECAR_READER_VERSION,
      SIDECAR_WRITER_VERSION,
      SIDECAR_SCHEMA_VERSION,
      F0R_MIGRATION_CHECKSUM,
      now,
    );
    db.prepare(`
      UPDATE rollout_schema_migrations
      SET status='applied', applied_at=?, runtime_version=?
      WHERE migration_version=? AND checksum=?
    `).run(now, process.version, ROLLOUT_SCHEMA_VERSION, F0R_MIGRATION_CHECKSUM);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const verification = verifyRolloutSchema(db);
  if (!verification.ok) throw new Error(`rollout schema verification failed: ${JSON.stringify(verification)}`);
}

export function verifyRolloutSchema(db: DatabaseSync): RolloutSchemaVerification {
  const base = verifySidecarSchema(db);
  const userVersion = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const migration = hasTable(db, "research_schema_migrations")
    && hasTable(db, "rollout_schema_migrations")
    ? db.prepare(`
        SELECT migration_version, checksum, status
        FROM rollout_schema_migrations WHERE migration_version=?
      `).get(ROLLOUT_SCHEMA_VERSION) as {
        migration_version: string;
        checksum: string;
        status: string;
      } | undefined
    : undefined;
  const contract = hasTable(db, "rollout_schema_contract")
    ? db.prepare(`
        SELECT minimum_reader_version, minimum_writer_version
        FROM rollout_schema_contract WHERE schema_version=?
      `).get(ROLLOUT_SCHEMA_VERSION) as {
        minimum_reader_version: string;
        minimum_writer_version: string;
      } | undefined
    : undefined;
  const partialMigration = !migration || migration.status !== "applied";
  const unknownSchema = userVersion !== ROLLOUT_USER_VERSION
    || migration?.migration_version !== ROLLOUT_SCHEMA_VERSION;
  const oldReaderCompatible = base.ok
    && contract?.minimum_reader_version === SIDECAR_READER_VERSION
    && contract?.minimum_writer_version === SIDECAR_WRITER_VERSION;
  const shadowDefaultOff = !hasTable(db, "rollout_config_events")
    || !(db.prepare(`
      SELECT shadow_write_enabled value FROM rollout_config_events
      ORDER BY occurred_at DESC, rowid DESC LIMIT 1
    `).get() as { value: number } | undefined)?.value;
  return {
    base,
    schemaVersion: migration?.migration_version ?? null,
    migrationChecksum: migration?.checksum ?? null,
    expectedChecksum: F0R_MIGRATION_CHECKSUM,
    userVersion,
    minimumReaderVersion: contract?.minimum_reader_version ?? null,
    minimumWriterVersion: contract?.minimum_writer_version ?? null,
    partialMigration,
    unknownSchema,
    oldReaderCompatible,
    shadowDefaultOff,
    ok: base.ok
      && !partialMigration
      && !unknownSchema
      && migration?.checksum === F0R_MIGRATION_CHECKSUM
      && oldReaderCompatible,
  };
}

export function evidenceTables(): readonly string[] {
  return EVIDENCE_TABLES;
}
