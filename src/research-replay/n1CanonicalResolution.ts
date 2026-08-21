// N1 canonical source-duplicate resolution。
// raw provenance（重複 observation/candidate）は削除せず保持し、canonical evaluation で
// source-level exact duplicate copy を append-only mapping で 1 回だけ有効化する。
// 決定的 canonical = 各 race の source 順で最初の observation（domain_observations.rowid 昇順）。
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { parseCanonicalRaceKey } from "./identity";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION, SourceDuplicateResolutionRepository } from "./settlement";

export const SOURCE_DUPLICATE_RESOLVER_VERSION = "n1c-source-duplicate-resolver-v1";
export const SOURCE_DUPLICATE_POLICY_VERSION = "n1c-source-duplicate-policy-v1"; // canonical = first observation by source order (rowid asc)

const SOURCE_DUPLICATE_DETECTION_REASON = "intra_file_source_duplicate: same raw document produced multiple identical race observations";
const SETTLEMENT_OBSERVATION_WHERE = "observation_type='settlement_result' AND payload_type='settlement_result'";
const SETTLEMENT_OBSERVATION_WHERE_O = "o.observation_type='settlement_result' AND o.payload_type='settlement_result'";

type SettlementObservationLineage = {
  observation_id: string;
  raw_document_id: string;
  parse_run_id: string;
  supersedes_id: string | null;
  correction_kind: string | null;
  correction_reason: string | null;
};

function sameUncorrectedParseLineage(left: SettlementObservationLineage, right: SettlementObservationLineage): boolean {
  return left.raw_document_id === right.raw_document_id
    && left.parse_run_id === right.parse_run_id
    && left.supersedes_id === null
    && right.supersedes_id === null
    && left.correction_kind === null
    && right.correction_kind === null
    && left.correction_reason === null
    && right.correction_reason === null;
}

// canonical_race_key "YYYY-MM-DD:VV:RN" → source archive file "kYYMMDD.lzh"。
// 不正なrace identityはappend-only resolution lineageへ入れる前にfail-closedする。
export function archiveFileForRaceKey(raceKey: string): string {
  const { raceDateJst } = parseCanonicalRaceKey(raceKey);
  const [year, month, day] = raceDateJst.split("-");
  return `k${year.slice(2)}${month}${day}.lzh`;
}

// 1 observation の candidate 集合 digest（bet_type, semantic_hash を sort して hash）。
function observationCandidateDigest(db: DatabaseSync, observationId: string): { digest: string; count: number } {
  const rows = db.prepare(
    "SELECT bet_type, semantic_hash FROM settlement_candidates_v2 WHERE observation_id=? ORDER BY bet_type, semantic_hash",
  ).all(observationId) as Array<{ bet_type: string; semantic_hash: string }>;
  return { digest: canonicalHash(rows.map((r) => [r.bet_type, r.semantic_hash])), count: rows.length };
}

export type DuplicateResolutionPlanItem = {
  canonicalRaceKey: string;
  canonicalObservationId: string;
  duplicateObservationId: string;
  rawDocumentId: string;
  sourceArchiveFile: string;
  duplicateSemanticDigest: string;
  valueEqual: boolean;
};

export type DuplicateResolutionPlan = {
  resolverVersion: string;
  policyVersion: string;
  duplicatedRaces: number;
  plannedResolutions: DuplicateResolutionPlanItem[];
  valueConflicts: DuplicateResolutionPlanItem[]; // exact でない（値が異なる）→ resolution しない
};

// source 順で最初の settlement observation を canonical、残りを duplicate 候補として計画する。
// 非settlement observationは共有domain_observations上の同一race eventであり、N1 source-duplicateではない。
// 同一raw・同一parse runの未訂正observationでcandidate集合も一致する場合だけ exact source duplicate とする。
export function planSourceDuplicateResolution(db: DatabaseSync): DuplicateResolutionPlan {
  const dupRaces = db.prepare(`
    SELECT canonical_race_key FROM domain_observations
    WHERE ${SETTLEMENT_OBSERVATION_WHERE}
    GROUP BY canonical_race_key HAVING COUNT(*)>1
    ORDER BY canonical_race_key
  `).all() as Array<{ canonical_race_key: string }>;
  const planned: DuplicateResolutionPlanItem[] = [];
  const conflicts: DuplicateResolutionPlanItem[] = [];
  for (const { canonical_race_key: raceKey } of dupRaces) {
    const obs = db.prepare(`
      SELECT observation_id, raw_document_id, parse_run_id, supersedes_id, correction_kind, correction_reason
      FROM domain_observations
      WHERE canonical_race_key=? AND ${SETTLEMENT_OBSERVATION_WHERE} ORDER BY rowid ASC
    `).all(raceKey) as SettlementObservationLineage[];
    const canonical = obs[0];
    const canonicalDigest = observationCandidateDigest(db, canonical.observation_id);
    for (const dup of obs.slice(1)) {
      const dupDigest = observationCandidateDigest(db, dup.observation_id);
      const valueEqual = dupDigest.digest === canonicalDigest.digest
        && dupDigest.count === canonicalDigest.count
        && sameUncorrectedParseLineage(canonical, dup);
      const item: DuplicateResolutionPlanItem = {
        canonicalRaceKey: raceKey,
        canonicalObservationId: canonical.observation_id,
        duplicateObservationId: dup.observation_id,
        rawDocumentId: dup.raw_document_id,
        sourceArchiveFile: archiveFileForRaceKey(raceKey),
        duplicateSemanticDigest: dupDigest.digest,
        valueEqual,
      };
      if (valueEqual) planned.push(item);
      else conflicts.push(item);
    }
  }
  return {
    resolverVersion: SOURCE_DUPLICATE_RESOLVER_VERSION,
    policyVersion: SOURCE_DUPLICATE_POLICY_VERSION,
    duplicatedRaces: dupRaces.length,
    plannedResolutions: planned,
    valueConflicts: conflicts,
  };
}

function requireSourceDuplicateResolutionContract(
  db: DatabaseSync,
  resolutionId: string,
  item: DuplicateResolutionPlanItem,
  resolverVersion: string,
  policyVersion: string,
): void {
  const row = db.prepare(`
    SELECT duplicate_observation_id AS duplicateObservationId,
           canonical_observation_id AS canonicalObservationId,
           canonical_race_key AS canonicalRaceKey,
           raw_document_id AS rawDocumentId,
           source_archive_file AS sourceArchiveFile,
           resolution_kind AS resolutionKind,
           detection_reason AS detectionReason,
           duplicate_semantic_digest AS duplicateSemanticDigest,
           resolver_version AS resolverVersion,
           policy_version AS policyVersion,
           schema_version AS schemaVersion
    FROM settlement_source_duplicate_resolutions_v2
    WHERE resolution_id=?
  `).get(resolutionId) as {
    duplicateObservationId: string;
    canonicalObservationId: string;
    canonicalRaceKey: string;
    rawDocumentId: string;
    sourceArchiveFile: string;
    resolutionKind: string;
    detectionReason: string;
    duplicateSemanticDigest: string;
    resolverVersion: string;
    policyVersion: string;
    schemaVersion: string;
  } | undefined;
  if (
    row === undefined ||
    row.duplicateObservationId !== item.duplicateObservationId ||
    row.canonicalObservationId !== item.canonicalObservationId ||
    row.canonicalRaceKey !== item.canonicalRaceKey ||
    row.rawDocumentId !== item.rawDocumentId ||
    row.sourceArchiveFile !== item.sourceArchiveFile ||
    row.resolutionKind !== "source_duplicate" ||
    row.detectionReason !== SOURCE_DUPLICATE_DETECTION_REASON ||
    row.duplicateSemanticDigest !== item.duplicateSemanticDigest ||
    row.resolverVersion !== resolverVersion ||
    row.policyVersion !== policyVersion ||
    row.schemaVersion !== N1_CANONICAL_RESOLUTION_SCHEMA_VERSION
  ) {
    throw new Error(`SOURCE_DUPLICATE_RESOLUTION_CONFLICT:${item.duplicateObservationId}:${resolutionId}`);
  }
}

// append-only で resolution を適用する。value conflict があれば適用せず throw（stop condition）。
// 既に解決済みの duplicate は immutable body が一致する場合だけ no-op（冪等）。
export function applySourceDuplicateResolution(
  db: DatabaseSync,
  plan: DuplicateResolutionPlan,
  now: string,
): { inserted: number; noop: number } {
  if (plan.valueConflicts.length > 0) {
    throw new Error(`value conflicts present (${plan.valueConflicts.length}); refuse to auto-resolve as source_duplicate`);
  }
  const repo = new SourceDuplicateResolutionRepository(db);
  let inserted = 0;
  let noop = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of plan.plannedResolutions) {
      const result = repo.record({
        duplicateObservationId: item.duplicateObservationId,
        canonicalObservationId: item.canonicalObservationId,
        canonicalRaceKey: item.canonicalRaceKey,
        rawDocumentId: item.rawDocumentId,
        sourceArchiveFile: item.sourceArchiveFile,
        detectionReason: SOURCE_DUPLICATE_DETECTION_REASON,
        duplicateSemanticDigest: item.duplicateSemanticDigest,
        resolverVersion: plan.resolverVersion,
        policyVersion: plan.policyVersion,
        detectedAt: now,
      });
      requireSourceDuplicateResolutionContract(db, result.resolutionId, item, plan.resolverVersion, plan.policyVersion);
      if (result.inserted) inserted += 1; else noop += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { inserted, noop };
}

// ===== raw / active canonical duplicate 監査 =====

const NOT_RESOLVED = `NOT EXISTS (
  SELECT 1 FROM settlement_source_duplicate_resolutions_v2 r
  WHERE r.duplicate_observation_id = o.observation_id)`;
const CAND_NOT_RESOLVED = `NOT EXISTS (
  SELECT 1 FROM settlement_source_duplicate_resolutions_v2 r
  WHERE r.duplicate_observation_id = c.observation_id)`;

function scalar(db: DatabaseSync, sql: string): number {
  return Number((db.prepare(sql).get() as { c: number }).c);
}

export type CanonicalDuplicateAudit = {
  rawObservations: number;
  rawDistinctRaceKeys: number;
  rawDuplicateObservations: number;
  activeDuplicateObservations: number;
  rawCandidates: number;
  rawDistinctRaceBetHash: number;
  rawRaceLevelDuplicateCandidates: number;
  activeCandidates: number;
  activeDistinctRaceBetHash: number;
  activeCanonicalRaceLevelDuplicateCandidates: number;
  resolvedDuplicateObservations: number;
};

export function auditCanonicalDuplicates(db: DatabaseSync): CanonicalDuplicateAudit {
  const rawObservations = scalar(db, `SELECT COUNT(*) c FROM domain_observations o WHERE ${SETTLEMENT_OBSERVATION_WHERE_O}`);
  const rawDistinctRaceKeys = scalar(db, `SELECT COUNT(DISTINCT o.canonical_race_key) c FROM domain_observations o WHERE ${SETTLEMENT_OBSERVATION_WHERE_O}`);
  // active duplicate observations: resolved duplicate を除いた上で race あたり >1 settlement observation の余剰
  const activeDupObsRaces = scalar(db, `
    SELECT COUNT(*) c FROM (
      SELECT o.canonical_race_key FROM domain_observations o
      WHERE ${SETTLEMENT_OBSERVATION_WHERE_O} AND ${NOT_RESOLVED}
      GROUP BY o.canonical_race_key HAVING COUNT(*)>1
    )`);
  const activeObsTotal = scalar(db, `SELECT COUNT(*) c FROM domain_observations o WHERE ${SETTLEMENT_OBSERVATION_WHERE_O} AND ${NOT_RESOLVED}`);
  const activeDistinctRaces = scalar(db, `SELECT COUNT(DISTINCT o.canonical_race_key) c FROM domain_observations o WHERE ${SETTLEMENT_OBSERVATION_WHERE_O} AND ${NOT_RESOLVED}`);
  const activeDuplicateObservations = activeObsTotal - activeDistinctRaces;
  void activeDupObsRaces;
  const rawCandidates = scalar(db, "SELECT COUNT(*) c FROM settlement_candidates_v2");
  const rawDistinctRaceBetHash = scalar(db, "SELECT COUNT(*) c FROM (SELECT DISTINCT canonical_race_key,bet_type,semantic_hash FROM settlement_candidates_v2)");
  const activeCandidates = scalar(db, `SELECT COUNT(*) c FROM settlement_candidates_v2 c WHERE ${CAND_NOT_RESOLVED}`);
  const activeDistinctRaceBetHash = scalar(db, `SELECT COUNT(*) c FROM (SELECT DISTINCT canonical_race_key,bet_type,semantic_hash FROM settlement_candidates_v2 c WHERE ${CAND_NOT_RESOLVED})`);
  const resolvedDuplicateObservations = scalar(db, "SELECT COUNT(*) c FROM settlement_source_duplicate_resolutions_v2");
  return {
    rawObservations, rawDistinctRaceKeys,
    rawDuplicateObservations: rawObservations - rawDistinctRaceKeys,
    activeDuplicateObservations,
    rawCandidates, rawDistinctRaceBetHash,
    rawRaceLevelDuplicateCandidates: rawCandidates - rawDistinctRaceBetHash,
    activeCandidates, activeDistinctRaceBetHash,
    activeCanonicalRaceLevelDuplicateCandidates: activeCandidates - activeDistinctRaceBetHash,
    resolvedDuplicateObservations,
  };
}

// ===== future ingest guard =====
// 同一 raw document 内で同一 canonical race key の settlement observation が複数生成された場合に、
// 同一parse runの未訂正observationでcandidate集合一致だけを exact duplicate とする。
export function detectExactDuplicateObservationsInRaw(
  db: DatabaseSync,
  rawDocumentId: string,
): Array<{ canonicalRaceKey: string; canonicalObservationId: string; duplicateObservationId: string; valueEqual: boolean }> {
  const rows = db.prepare(`
    SELECT canonical_race_key, observation_id, raw_document_id, parse_run_id, supersedes_id, correction_kind, correction_reason
    FROM domain_observations
    WHERE raw_document_id=? AND ${SETTLEMENT_OBSERVATION_WHERE} ORDER BY canonical_race_key, rowid ASC
  `).all(rawDocumentId) as Array<SettlementObservationLineage & { canonical_race_key: string }>;
  const byRace = new Map<string, Array<SettlementObservationLineage & { canonical_race_key: string }>>();
  for (const row of rows) {
    const list = byRace.get(row.canonical_race_key) ?? [];
    list.push(row);
    byRace.set(row.canonical_race_key, list);
  }
  const out: Array<{ canonicalRaceKey: string; canonicalObservationId: string; duplicateObservationId: string; valueEqual: boolean }> = [];
  for (const [raceKey, observations] of byRace) {
    if (observations.length < 2) continue;
    const canonical = observations[0];
    const canonicalDigest = observationCandidateDigest(db, canonical.observation_id);
    for (const dup of observations.slice(1)) {
      const digest = observationCandidateDigest(db, dup.observation_id);
      out.push({
        canonicalRaceKey: raceKey,
        canonicalObservationId: canonical.observation_id,
        duplicateObservationId: dup.observation_id,
        valueEqual: digest.digest === canonicalDigest.digest
          && digest.count === canonicalDigest.count
          && sameUncorrectedParseLineage(canonical, dup),
      });
    }
  }
  return out;
}
