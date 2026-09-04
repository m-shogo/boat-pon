import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readCurrentlyValidSourceDuplicateObservationIds } from "../research-replay/n1SourceDuplicateResolutionValidation";
import { sourceDuplicateCandidateLineSemanticsValid } from "../research-replay/n1SourceDuplicateLineSemantics";
import { settlementCandidateSemanticHashValid } from "../research-replay/n1SettlementCandidateSemanticHash";
import { CANARY_COHORT } from "./taskExecutorsCore";

const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);
const CURRENT_CANDIDATE_AUTHORITY_COLUMNS = [
  "candidate_id", "canonical_race_key", "bet_type", "settlement_status", "result_kind",
  "revision_kind", "resolution_status", "source_kind", "source_schema_version", "observation_id",
  "parse_run_id", "raw_document_id", "semantic_hash", "supersedes_candidate_id", "correction_reason",
  "observed_at", "created_at",
] as const;
const CURRENT_PAYOUT_AUTHORITY_COLUMNS = [
  "payout_line_id", "candidate_id", "line_no", "bet_type", "selection_raw", "selection_normalized",
  "selection_canonical", "payout_yen", "popularity", "line_kind", "created_at",
] as const;
const CURRENT_REFUND_AUTHORITY_COLUMNS = [
  "refund_line_id", "candidate_id", "line_no", "bet_type", "selection_raw", "selection_normalized",
  "selection_canonical", "refund_scope", "refund_yen_per_100", "reason_code", "created_at",
] as const;
const CURRENT_SOURCE_DUPLICATE_RESOLUTION_AUTHORITY_COLUMNS = [
  "resolution_id", "duplicate_observation_id", "canonical_observation_id", "canonical_race_key",
  "raw_document_id", "source_archive_file", "resolution_kind", "detection_reason",
  "duplicate_semantic_digest", "resolver_version", "policy_version", "schema_version",
  "detected_at", "created_at",
] as const;

export type N2DatasetSettlementPreflight = {
  ok: boolean;
  blocks: string[];
  checkedCandidateCount: number;
};

type CandidateLineageRow = {
  candidateId: string;
  raceKey: string;
  candidateBetType: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string | null;
  observationType: string | null;
  observationPayloadType: string | null;
  observationParseRunId: string | null;
  observationRawDocumentId: string | null;
  parseRunRawDocumentId: string | null;
  parseRunStatus: string | null;
  rawIntegrityStatus: string | null;
  rawSecurityScanStatus: string | null;
  rawParserReplayEligible: number | null;
};

type Bounds = {
  fromRaceKey: string;
  toRaceKeyExclusive: string;
};

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function tableHasColumns(db: DatabaseSync, table: string, required: readonly string[]): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  return required.every((column) => names.has(column));
}

function preflightActiveSettlementLineage(
  sidecarPath: string,
  prefix: "DATASET_CANARY" | "DATASET_ACTIVE",
  bounds?: Bounds,
): N2DatasetSettlementPreflight {
  if (!existsSync(sidecarPath)) {
    return { ok: false, blocks: [`${prefix}_SIDECAR_NOT_FOUND`], checkedCandidateCount: 0 };
  }
  const lexicalSidecarPath = resolve(sidecarPath);
  try {
    const lstat = lstatSync(lexicalSidecarPath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      return { ok: false, blocks: [`${prefix}_SIDECAR_IDENTITY_INVALID`], checkedCandidateCount: 0 };
    }
    const stat = statSync(lexicalSidecarPath);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(lexicalSidecarPath) !== lexicalSidecarPath) {
      return { ok: false, blocks: [`${prefix}_SIDECAR_IDENTITY_INVALID`], checkedCandidateCount: 0 };
    }
  } catch {
    return { ok: false, blocks: [`${prefix}_SIDECAR_IDENTITY_INVALID`], checkedCandidateCount: 0 };
  }
  const walPath = `${lexicalSidecarPath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    return { ok: false, blocks: [`${prefix}_SIDECAR_ACTIVE_WAL`], checkedCandidateCount: 0 };
  }

  const db = new DatabaseSync(`${pathToFileURL(lexicalSidecarPath).href}?immutable=1`, { readOnly: true } as never);
  try {
    db.exec("PRAGMA query_only=ON");
    for (const table of [
      "domain_observations",
      "parse_runs",
      "raw_documents",
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "race_refund_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) {
        return {
          ok: false,
          blocks: [`${prefix}_LINEAGE_TABLE_MISSING:${table}`],
          checkedCandidateCount: 0,
        };
      }
    }

    for (const [table, required] of [
      ["settlement_candidates_v2", CURRENT_CANDIDATE_AUTHORITY_COLUMNS],
      ["race_payout_lines_v2", CURRENT_PAYOUT_AUTHORITY_COLUMNS],
      ["race_refund_lines_v2", CURRENT_REFUND_AUTHORITY_COLUMNS],
      ["settlement_source_duplicate_resolutions_v2", CURRENT_SOURCE_DUPLICATE_RESOLUTION_AUTHORITY_COLUMNS],
    ] as const) {
      if (!tableHasColumns(db, table, required)) {
        return {
          ok: false,
          blocks: [`${prefix}_LINEAGE_SCHEMA_INVALID:${table}`],
          checkedCandidateCount: 0,
        };
      }
    }

    try {
      readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return {
        ok: false,
        blocks: [`${prefix}_SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID`],
        checkedCandidateCount: 0,
      };
    }

    const selfSupersessionRangeClause = bounds
      ? "AND c.canonical_race_key >= ? AND c.canonical_race_key < ?"
      : "";
    const selfSuperseders = db.prepare(`
      SELECT c.candidate_id AS candidateId
      FROM settlement_candidates_v2 c
      WHERE c.supersedes_candidate_id=c.candidate_id
        ${selfSupersessionRangeClause}
      ORDER BY c.candidate_id
    `).all(...(bounds ? [bounds.fromRaceKey, bounds.toRaceKeyExclusive] : [])) as unknown as Array<{ candidateId: string }>;
    if (selfSuperseders.length > 0) {
      return {
        ok: false,
        blocks: selfSuperseders.map((row) => `${prefix}_SETTLEMENT_SUPERSESSION_SELF_REFERENCE:${row.candidateId}`),
        checkedCandidateCount: 0,
      };
    }

    const cycleRangeClause = bounds
      ? "AND seed.canonical_race_key >= ? AND seed.canonical_race_key < ?"
      : "";
    const cyclicSuperseders = db.prepare(`
      WITH RECURSIVE ancestry(startId,currentId,nextId,path,cycle) AS (
        SELECT seed.candidate_id,
               seed.candidate_id,
               seed.supersedes_candidate_id,
               '|' || seed.candidate_id || '|',
               0
        FROM settlement_candidates_v2 seed
        WHERE seed.supersedes_candidate_id IS NOT NULL
          ${cycleRangeClause}
        UNION ALL
        SELECT ancestry.startId,
               prior.candidate_id,
               prior.supersedes_candidate_id,
               ancestry.path || prior.candidate_id || '|',
               instr(ancestry.path, '|' || prior.candidate_id || '|') > 0
        FROM ancestry
        JOIN settlement_candidates_v2 prior ON prior.candidate_id=ancestry.nextId
        WHERE ancestry.nextId IS NOT NULL AND ancestry.cycle=0
      )
      SELECT DISTINCT startId AS candidateId
      FROM ancestry
      WHERE cycle=1
      ORDER BY startId
    `).all(...(bounds ? [bounds.fromRaceKey, bounds.toRaceKeyExclusive] : [])) as unknown as Array<{ candidateId: string }>;
    if (cyclicSuperseders.length > 0) {
      return {
        ok: false,
        blocks: cyclicSuperseders.map((row) => `${prefix}_SETTLEMENT_SUPERSESSION_CYCLE:${row.candidateId}`),
        checkedCandidateCount: 0,
      };
    }

    const supersessionRangeClause = bounds
      ? "AND ((prior.canonical_race_key >= ?1 AND prior.canonical_race_key < ?2) OR (newer.canonical_race_key >= ?1 AND newer.canonical_race_key < ?2))"
      : "";
    const invalidSuperseders = db.prepare(`
      SELECT newer.candidate_id AS candidateId
      FROM settlement_candidates_v2 newer
      JOIN settlement_candidates_v2 prior
        ON prior.candidate_id=newer.supersedes_candidate_id
      WHERE (newer.canonical_race_key<>prior.canonical_race_key OR newer.bet_type<>prior.bet_type)
        ${supersessionRangeClause}
      ORDER BY newer.candidate_id
    `).all(...(bounds ? [bounds.fromRaceKey, bounds.toRaceKeyExclusive] : [])) as unknown as Array<{ candidateId: string }>;
    if (invalidSuperseders.length > 0) {
      return {
        ok: false,
        blocks: invalidSuperseders.map((row) => `${prefix}_SETTLEMENT_SUPERSESSION_IDENTITY_INVALID:${row.candidateId}`),
        checkedCandidateCount: 0,
      };
    }

    const branchingSuperseders = db.prepare(`
      SELECT prior.candidate_id AS candidateId
      FROM settlement_candidates_v2 prior
      JOIN settlement_candidates_v2 newer
        ON newer.supersedes_candidate_id=prior.candidate_id
      WHERE 1=1
        ${supersessionRangeClause}
      GROUP BY prior.candidate_id
      HAVING COUNT(*) > 1
      ORDER BY prior.candidate_id
    `).all(...(bounds ? [bounds.fromRaceKey, bounds.toRaceKeyExclusive] : [])) as unknown as Array<{ candidateId: string }>;
    if (branchingSuperseders.length > 0) {
      return {
        ok: false,
        blocks: branchingSuperseders.map((row) => `${prefix}_SETTLEMENT_SUPERSESSION_BRANCHING_INVALID:${row.candidateId}`),
        checkedCandidateCount: 0,
      };
    }

    const rangeClause = bounds
      ? "AND c.canonical_race_key >= ? AND c.canonical_race_key < ?"
      : "";
    const rows = db.prepare(`
      SELECT c.candidate_id AS candidateId,
             c.canonical_race_key AS raceKey,
             c.bet_type AS candidateBetType,
             c.parse_run_id AS candidateParseRunId,
             c.raw_document_id AS candidateRawDocumentId,
             o.canonical_race_key AS observationRaceKey,
             o.observation_type AS observationType,
             o.payload_type AS observationPayloadType,
             o.parse_run_id AS observationParseRunId,
             o.raw_document_id AS observationRawDocumentId,
             pr.raw_document_id AS parseRunRawDocumentId,
             pr.status AS parseRunStatus,
             rd.integrity_status AS rawIntegrityStatus,
             rd.security_scan_status AS rawSecurityScanStatus,
             rd.parser_replay_eligible AS rawParserReplayEligible
      FROM settlement_candidates_v2 c
      LEFT JOIN domain_observations o ON o.observation_id=c.observation_id
      LEFT JOIN parse_runs pr ON pr.parse_run_id=c.parse_run_id
      LEFT JOIN raw_documents rd ON rd.raw_document_id=c.raw_document_id
      WHERE 1=1
        ${rangeClause}
        AND NOT EXISTS (
          SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d
          WHERE d.duplicate_observation_id=c.observation_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
            AND newer.canonical_race_key=c.canonical_race_key
            AND newer.bet_type=c.bet_type
        )
      ORDER BY c.canonical_race_key,c.bet_type,c.candidate_id
    `).all(...(bounds ? [bounds.fromRaceKey, bounds.toRaceKeyExclusive] : [])) as unknown as CandidateLineageRow[];

    const blocks: string[] = [];
    for (const row of rows) {
      if (row.observationRaceKey !== row.raceKey
        || row.observationType !== "settlement_result"
        || row.observationPayloadType !== "settlement_result"
        || row.observationParseRunId !== row.candidateParseRunId
        || row.observationRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunStatus == null
        || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)
        || row.rawIntegrityStatus !== "verified"
        || row.rawSecurityScanStatus !== "passed"
        || row.rawParserReplayEligible !== 1
        || !sourceDuplicateCandidateLineSemanticsValid(db, row.candidateId, row.candidateBetType)
        || !settlementCandidateSemanticHashValid(db, row.candidateId)) {
        blocks.push(`${prefix}_SETTLEMENT_LINEAGE_INVALID:${row.candidateId}`);
      }
    }
    return { ok: blocks.length === 0, blocks, checkedCandidateCount: rows.length };
  } finally {
    db.close();
  }
}

export function preflightN2DatasetCanarySettlementLineage(
  sidecarPath: string,
): N2DatasetSettlementPreflight {
  return preflightActiveSettlementLineage(sidecarPath, "DATASET_CANARY", {
    fromRaceKey: CANARY_COHORT.fromRaceKey,
    toRaceKeyExclusive: CANARY_COHORT.toRaceKeyExclusive,
  });
}

export function preflightN2AllActiveSettlementLineage(
  sidecarPath: string,
): N2DatasetSettlementPreflight {
  return preflightActiveSettlementLineage(sidecarPath, "DATASET_ACTIVE");
}
