import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { readCurrentlyValidSourceDuplicateObservationIds } from "../research-replay/n1SourceDuplicateResolutionValidation";
import { sourceDuplicateCandidateLineSemanticsValid } from "../research-replay/n1SourceDuplicateLineSemantics";
import { settlementCandidateSemanticHashValid } from "../research-replay/n1SettlementCandidateSemanticHash";
import { CANARY_COHORT } from "./taskExecutorsCore";

const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);

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

function preflightActiveSettlementLineage(
  sidecarPath: string,
  prefix: "DATASET_CANARY" | "DATASET_ACTIVE",
  bounds?: Bounds,
): N2DatasetSettlementPreflight {
  if (!existsSync(sidecarPath)) return { ok: true, blocks: [], checkedCandidateCount: 0 };
  const walPath = `${sidecarPath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    return { ok: false, blocks: [`${prefix}_SIDECAR_ACTIVE_WAL`], checkedCandidateCount: 0 };
  }

  const db = new DatabaseSync(`${pathToFileURL(sidecarPath).href}?immutable=1`, { readOnly: true } as never);
  try {
    db.exec("PRAGMA query_only=ON");
    for (const table of [
      "domain_observations",
      "parse_runs",
      "raw_documents",
      "settlement_candidates_v2",
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

    try {
      readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return {
        ok: false,
        blocks: [`${prefix}_SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID`],
        checkedCandidateCount: 0,
      };
    }

    const supersessionRangeClause = bounds
      ? "AND prior.canonical_race_key >= ? AND prior.canonical_race_key < ?"
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
