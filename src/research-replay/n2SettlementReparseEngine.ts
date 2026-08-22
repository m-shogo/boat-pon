// N2 settlement reparse engine（DB 実行層, append-only）。
//
// 純粋 core（n2SettlementReparse.ts）の decision/derivation を、temp copy sidecar への
// append-only supersession 書き込みへ結線する。既存 row を UPDATE/DELETE しない。
// CLI（scripts/reparse-settlement-v2.ts）と integration test の両方から使う。
import type { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "./canonical";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import { SettlementRepository, type ResultKind, type SettlementBetType, type SettlementStatus } from "./settlement";
import {
  REPARSE_ACTIONS, REPARSE_CANONICALIZATION_VERSION, REPARSE_PARSER_NAME, REPARSE_SOURCE_PARSER_VERSION,
  REPARSE_TARGET_PARSER_VERSION, candidateKey, decideReparseAction, isAppendingAction, isSupersedingAction,
  type DerivedCandidate, type ExistingActiveCandidate, type ReparseAction,
} from "./n2SettlementReparse";

export const REPARSE_DEFECT_CODE = "V1_SPECIAL_PAYOUT_FALSE_REFUND";

export type RawMeta = { rawDocumentId: string; date: string; family: string };
export type ActiveValue = { candidateId: string; status: SettlementStatus; resultKind: ResultKind };
export type ActiveState = {
  active: Map<string, ActiveValue>;
  ambiguousKeys: Set<string>;
  before: Record<string, number>;
  physicalRows: number;
  supersededCount: number;
};

export type Counts = Record<ReparseAction, number> & {
  files_scanned: number; files_ingested: number; files_not_ingested: number; files_duplicate_source: number;
  parse_errors: number; appended_candidates: number; appended_parse_runs: number; appended_observations: number;
  supersession_relations: number; ambiguous_active: number; fr_from_refunded: number; fr_from_partial: number;
};
export function emptyCounts(): Counts {
  const c = {
    files_scanned: 0, files_ingested: 0, files_not_ingested: 0, files_duplicate_source: 0,
    parse_errors: 0, appended_candidates: 0, appended_parse_runs: 0, appended_observations: 0,
    supersession_relations: 0, ambiguous_active: 0, fr_from_refunded: 0, fr_from_partial: 0,
  } as Counts;
  for (const a of REPARSE_ACTIONS) c[a] = 0;
  return c;
}

export type CorrectionSample = {
  raceKey: string; betType: string; action: ReparseAction;
  originalStatus: string | null; correctedStatus: string; originalResultKind: string | null; correctedResultKind: string; defectCode: string;
};
export type Delta = { false_refund: number; result_kind: number; special_addition: number };
export type ReparseState = {
  counts: Counts; corrections: CorrectionSample[]; processedFiles: string[]; processedRawDocs: string[];
  byYear: Map<string, Delta>; byBetType: Map<string, Delta>;
};
export function newState(): ReparseState {
  return { counts: emptyCounts(), corrections: [], processedFiles: [], processedRawDocs: [], byYear: new Map(), byBetType: new Map() };
}
function bump(map: Map<string, Delta>, key: string, field: keyof Delta): void {
  const cur = map.get(key) ?? { false_refund: 0, result_kind: 0, special_addition: 0 };
  cur[field] += 1; map.set(key, cur);
}

export function loadSourceDuplicateSet(db: DatabaseSync): Set<string> {
  return readCurrentlyValidSourceDuplicateObservationIds(db);
}

// 1回の sequential full scan で active map・before status counts・physical rows を構築する。
// source_dup obs と superseded candidate を除外する。
export function loadActiveState(db: DatabaseSync, sourceDup: Set<string>): ActiveState {
  const superseded = new Set<string>();
  for (const r of db.prepare("SELECT supersedes_candidate_id AS id FROM settlement_candidates_v2 WHERE supersedes_candidate_id IS NOT NULL").all() as Array<{ id: string }>) superseded.add(r.id);
  const active = new Map<string, ActiveValue>();
  const ambiguousKeys = new Set<string>();
  const before: Record<string, number> = {};
  let physicalRows = 0;
  const stmt = db.prepare("SELECT candidate_id AS c, canonical_race_key AS k, bet_type AS b, settlement_status AS s, result_kind AS r, observation_id AS o FROM settlement_candidates_v2");
  for (const row of stmt.iterate() as IterableIterator<{ c: string; k: string; b: string; s: string; r: string; o: string }>) {
    physicalRows += 1;
    if (sourceDup.has(row.o)) continue;
    if (superseded.has(row.c)) continue;
    const key = candidateKey(row.k, row.b as SettlementBetType);
    if (active.has(key)) { ambiguousKeys.add(key); continue; }
    active.set(key, { candidateId: row.c, status: row.s as SettlementStatus, resultKind: row.r as ResultKind });
    before[row.s] = (before[row.s] ?? 0) + 1;
  }
  return { active, ambiguousKeys, before, physicalRows, supersededCount: superseded.size };
}

export const ensureSupersedesIndex = (db: DatabaseSync): void =>
  db.exec("CREATE INDEX IF NOT EXISTS reparse_idx_supersedes ON settlement_candidates_v2(supersedes_candidate_id) WHERE supersedes_candidate_id IS NOT NULL");

function requireSingleSourceParseRun(db: DatabaseSync, rawDocumentId: string, sourceSchemaVersion: string): string {
  const rows = db.prepare(
    `SELECT parse_run_id AS id, parser_name AS parserName, source_schema_version AS sourceSchemaVersion,
            payload_type AS payloadType, status, error_code AS errorCode
     FROM parse_runs
     WHERE raw_document_id=? AND parser_version=?
     ORDER BY parse_run_id`,
  ).all(rawDocumentId, REPARSE_SOURCE_PARSER_VERSION) as Array<{
    id: string;
    parserName: string;
    sourceSchemaVersion: string;
    payloadType: string;
    status: string;
    errorCode: string | null;
  }>;
  if (rows.length === 0) {
    throw new Error(`REPARSE_SOURCE_PARSE_RUN_MISSING:${rawDocumentId}`);
  }
  if (rows.length > 1) {
    throw new Error(`REPARSE_SOURCE_PARSE_RUN_AMBIGUOUS:${rawDocumentId}:${rows.length}`);
  }
  const row = rows[0];
  if (
    row.parserName !== "n1-backfill-archive" ||
    row.sourceSchemaVersion !== sourceSchemaVersion ||
    row.payloadType !== "settlement_result" ||
    row.status !== "success" ||
    row.errorCode !== null
  ) {
    throw new Error(`REPARSE_SOURCE_PARSE_RUN_INVALID:${rawDocumentId}:${row.id}`);
  }
  return row.id;
}

function requireTargetParseRunContract(
  db: DatabaseSync,
  parseRunId: string,
  rawDocumentId: string,
  sourceSchemaVersion: string,
  sourceParseRunId: string,
): void {
  const row = db.prepare(
    `SELECT raw_document_id AS rawDocumentId, parser_name AS parserName, parser_version AS parserVersion,
            source_schema_version AS sourceSchemaVersion, canonicalization_version AS canonicalizationVersion,
            payload_type AS payloadType, status, warning_codes AS warningCodes, error_code AS errorCode,
            semantic_payload_hash AS semanticPayloadHash, supersedes_id AS supersedesId,
            correction_kind AS correctionKind, correction_reason AS correctionReason
     FROM parse_runs WHERE parse_run_id=?`,
  ).get(parseRunId) as {
    rawDocumentId: string;
    parserName: string;
    parserVersion: string;
    sourceSchemaVersion: string;
    canonicalizationVersion: string;
    payloadType: string;
    status: string;
    warningCodes: string;
    errorCode: string | null;
    semanticPayloadHash: string | null;
    supersedesId: string | null;
    correctionKind: string | null;
    correctionReason: string | null;
  } | undefined;
  const expectedSemanticPayloadHash = canonicalHash({ reparse: rawDocumentId });
  if (
    row === undefined ||
    row.rawDocumentId !== rawDocumentId ||
    row.parserName !== REPARSE_PARSER_NAME ||
    row.parserVersion !== REPARSE_TARGET_PARSER_VERSION ||
    row.sourceSchemaVersion !== sourceSchemaVersion ||
    row.canonicalizationVersion !== REPARSE_CANONICALIZATION_VERSION ||
    row.payloadType !== "settlement_result" ||
    row.status !== "success" ||
    row.warningCodes !== "[]" ||
    row.errorCode !== null ||
    row.semanticPayloadHash !== expectedSemanticPayloadHash ||
    row.supersedesId !== sourceParseRunId ||
    row.correctionKind !== "parser_reparse" ||
    row.correctionReason !== REPARSE_DEFECT_CODE
  ) {
    throw new Error(`REPARSE_TARGET_PARSE_RUN_CONFLICT:${rawDocumentId}:${parseRunId}`);
  }
}

function requireTargetObservationContract(
  db: DatabaseSync,
  observationId: string,
  raceKey: string,
  parseRunId: string,
  rawDocumentId: string,
): void {
  const row = db.prepare(
    `SELECT canonical_race_key AS raceKey, observation_type AS observationType,
            payload_type AS payloadType, payload_schema_version AS payloadSchemaVersion,
            parse_run_id AS parseRunId, raw_document_id AS rawDocumentId,
            source_published_at AS sourcePublishedAt, timing_quality AS timingQuality,
            source_quality AS sourceQuality, measurement_quality AS measurementQuality,
            semantic_payload_hash AS semanticPayloadHash, supersedes_id AS supersedesId,
            correction_kind AS correctionKind, correction_reason AS correctionReason
     FROM domain_observations WHERE observation_id=?`,
  ).get(observationId) as {
    raceKey: string;
    observationType: string;
    payloadType: string;
    payloadSchemaVersion: string;
    parseRunId: string;
    rawDocumentId: string;
    sourcePublishedAt: string | null;
    timingQuality: string;
    sourceQuality: string;
    measurementQuality: string;
    semanticPayloadHash: string;
    supersedesId: string | null;
    correctionKind: string | null;
    correctionReason: string | null;
  } | undefined;
  if (
    row === undefined ||
    row.raceKey !== raceKey ||
    row.observationType !== "settlement_result" ||
    row.payloadType !== "settlement_result" ||
    row.payloadSchemaVersion !== "rr-payload-v1" ||
    row.parseRunId !== parseRunId ||
    row.rawDocumentId !== rawDocumentId ||
    row.sourcePublishedAt !== null ||
    row.timingQuality !== "observed_only" ||
    row.sourceQuality !== "derived_existing_row" ||
    row.measurementQuality !== "official_archive" ||
    row.semanticPayloadHash !== canonicalHash({ reparse: observationId }) ||
    row.supersedesId !== null ||
    row.correctionKind !== "parser_reparse" ||
    row.correctionReason !== REPARSE_DEFECT_CODE
  ) {
    throw new Error(`REPARSE_TARGET_OBSERVATION_CONFLICT:${rawDocumentId}:${observationId}`);
  }
}

function requireTargetCandidateContract(
  db: DatabaseSync,
  candidateId: string,
  expected: {
    raceKey: string;
    betType: SettlementBetType;
    settlementStatus: SettlementStatus;
    resultKind: ResultKind;
    revisionKind: "initial" | "parser_reparse";
    sourceSchemaVersion: string;
    observationId: string;
    parseRunId: string;
    rawDocumentId: string;
    semanticHash: string;
    supersedesCandidateId: string | null;
    correctionReason: string | null;
  },
): void {
  const row = db.prepare(
    `SELECT canonical_race_key AS raceKey, bet_type AS betType, settlement_status AS settlementStatus,
            result_kind AS resultKind, revision_kind AS revisionKind, resolution_status AS resolutionStatus,
            source_kind AS sourceKind, source_schema_version AS sourceSchemaVersion,
            observation_id AS observationId, parse_run_id AS parseRunId, raw_document_id AS rawDocumentId,
            semantic_hash AS semanticHash, supersedes_candidate_id AS supersedesCandidateId,
            correction_reason AS correctionReason
     FROM settlement_candidates_v2 WHERE candidate_id=?`,
  ).get(candidateId) as {
    raceKey: string;
    betType: string;
    settlementStatus: string;
    resultKind: string;
    revisionKind: string;
    resolutionStatus: string;
    sourceKind: string;
    sourceSchemaVersion: string;
    observationId: string;
    parseRunId: string;
    rawDocumentId: string;
    semanticHash: string;
    supersedesCandidateId: string | null;
    correctionReason: string | null;
  } | undefined;
  if (
    row === undefined ||
    row.raceKey !== expected.raceKey ||
    row.betType !== expected.betType ||
    row.settlementStatus !== expected.settlementStatus ||
    row.resultKind !== expected.resultKind ||
    row.revisionKind !== expected.revisionKind ||
    row.resolutionStatus !== "resolved" ||
    row.sourceKind !== "official_archive" ||
    row.sourceSchemaVersion !== expected.sourceSchemaVersion ||
    row.observationId !== expected.observationId ||
    row.parseRunId !== expected.parseRunId ||
    row.rawDocumentId !== expected.rawDocumentId ||
    row.semanticHash !== expected.semanticHash ||
    row.supersedesCandidateId !== expected.supersedesCandidateId ||
    row.correctionReason !== expected.correctionReason
  ) {
    throw new Error(`REPARSE_TARGET_CANDIDATE_CONFLICT:${expected.rawDocumentId}:${candidateId}`);
  }
}

// 1 raw document 分の v2 derived candidate を temp copy へ append-only 適用する（per-document transaction）。
// meta.rawDocumentId は当該 raw の既存 raw_document_id（provenance 保持）。state/activeState を mutate する。
export function applyReparseForDocument(
  db: DatabaseSync, repo: SettlementRepository, meta: RawMeta, derived: DerivedCandidate[],
  activeState: ActiveState, state: ReparseState, nowIso: string,
): void {
  if (derived.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const parseRunId = `rpr-parse-${meta.rawDocumentId}`;
    const v1ParseRunId = requireSingleSourceParseRun(db, meta.rawDocumentId, meta.family);
    const prInfo = db.prepare(
      `INSERT OR IGNORE INTO parse_runs
       (parse_run_id, raw_document_id, parser_name, parser_version, source_schema_version,
        canonicalization_version, payload_type, status, warning_codes, error_code,
        started_at, completed_at, semantic_payload_hash, supersedes_id, correction_kind, correction_reason, created_at)
       VALUES (?,?,?,?,?,?, 'settlement_result', 'success', '[]', NULL, ?,?,?,?, 'parser_reparse', ?, ?)`,
    ).run(parseRunId, meta.rawDocumentId, REPARSE_PARSER_NAME, REPARSE_TARGET_PARSER_VERSION, meta.family,
      REPARSE_CANONICALIZATION_VERSION, nowIso, nowIso, canonicalHash({ reparse: meta.rawDocumentId }),
      v1ParseRunId, REPARSE_DEFECT_CODE, nowIso);
    requireTargetParseRunContract(db, parseRunId, meta.rawDocumentId, meta.family, v1ParseRunId);
    if (Number(prInfo.changes) > 0) state.counts.appended_parse_runs += 1;

    const obsInsert = db.prepare(
      `INSERT OR IGNORE INTO domain_observations
       (observation_id, canonical_race_key, observation_type, payload_type, payload_schema_version,
        parse_run_id, raw_document_id, source_published_at, source_observed_at, first_seen_at,
        timing_quality, source_quality, measurement_quality, semantic_payload_hash, supersedes_id,
        correction_kind, correction_reason, recorded_at, effective_at, created_at)
       VALUES (?,?, 'settlement_result','settlement_result','rr-payload-v1', ?,?, NULL, ?, ?,
               'observed_only','derived_existing_row','official_archive', ?, NULL, 'parser_reparse', ?, ?, ?, ?)`,
    );
    const observedRaces = new Set<string>();
    for (const cand of derived) {
      const key = candidateKey(cand.raceKey, cand.betType);
      if (activeState.ambiguousKeys.has(key)) { state.counts.ambiguous_active += 1; continue; }
      const existingVal = activeState.active.get(key) ?? null;
      const existing: ExistingActiveCandidate = existingVal
        ? { candidateId: existingVal.candidateId, status: existingVal.status, resultKind: existingVal.resultKind, rawDocumentId: meta.rawDocumentId, sourceSchemaVersion: meta.family }
        : null;
      const action = decideReparseAction(existing, cand);
      state.counts[action] += 1;
      if (!isAppendingAction(action)) continue;

      const observationId = `rpr-obs-${meta.rawDocumentId}-${cand.raceKey}`;
      if (!observedRaces.has(cand.raceKey)) {
        const oi = obsInsert.run(observationId, cand.raceKey, parseRunId, meta.rawDocumentId, nowIso, nowIso,
          canonicalHash({ reparse: observationId }), REPARSE_DEFECT_CODE, nowIso, nowIso, nowIso);
        requireTargetObservationContract(db, observationId, cand.raceKey, parseRunId, meta.rawDocumentId);
        if (Number(oi.changes) > 0) state.counts.appended_observations += 1;
        observedRaces.add(cand.raceKey);
      }
      const superseding = isSupersedingAction(action);
      const sourceSchemaVersion = existing?.sourceSchemaVersion ?? meta.family;
      const supersedesCandidateId = superseding ? existing!.candidateId : null;
      const correctionReason = superseding ? REPARSE_DEFECT_CODE : null;
      const appended = repo.appendCandidate({
        canonicalRaceKey: cand.raceKey, betType: cand.betType, settlementStatus: cand.status, resultKind: cand.resultKind,
        revisionKind: superseding ? "parser_reparse" : "initial", resolutionStatus: "resolved", sourceKind: "official_archive",
        sourceSchemaVersion,
        observationId, parseRunId, rawDocumentId: meta.rawDocumentId, observedAt: nowIso,
        supersedesCandidateId,
        correctionReason,
        payouts: cand.payouts.map((p) => ({ selection: p.selection, payoutYen: p.payoutYen, popularity: p.popularity, lineKind: p.lineKind })),
        refunds: cand.refunds.map((r) => ({ selection: r.selection, scope: r.scope, refundYenPer100: r.refundYenPer100, reasonCode: r.reasonCode })),
        emitEvidencePins: false, withinTransaction: true,
      });
      requireTargetCandidateContract(db, appended.candidateId, {
        raceKey: cand.raceKey,
        betType: cand.betType,
        settlementStatus: cand.status,
        resultKind: cand.resultKind,
        revisionKind: superseding ? "parser_reparse" : "initial",
        sourceSchemaVersion,
        observationId,
        parseRunId,
        rawDocumentId: meta.rawDocumentId,
        semanticHash: appended.semanticHash,
        supersedesCandidateId,
        correctionReason,
      });
      if (appended.inserted) {
        state.counts.appended_candidates += 1;
        if (superseding) {
          state.counts.supersession_relations += 1;
          if (action === "false_refund_correction" && existing!.status === "refunded") state.counts.fr_from_refunded += 1;
          if (action === "false_refund_correction" && existing!.status === "partially_refunded") state.counts.fr_from_partial += 1;
        }
        activeState.active.set(key, { candidateId: appended.candidateId, status: cand.status, resultKind: cand.resultKind });
        const year = cand.raceKey.slice(0, 4);
        const field: keyof Delta = action === "false_refund_correction" ? "false_refund" : action === "result_kind_correction" ? "result_kind" : "special_addition";
        bump(state.byYear, year, field); bump(state.byBetType, cand.betType, field);
        if (state.corrections.length < 400) state.corrections.push({
          raceKey: cand.raceKey, betType: cand.betType, action,
          originalStatus: existing?.status ?? null, correctedStatus: cand.status,
          originalResultKind: existing?.resultKind ?? null, correctedResultKind: cand.resultKind, defectCode: REPARSE_DEFECT_CODE,
        });
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function computeAfter(before: Record<string, number>, c: Counts): Record<string, number> {
  const after = { ...before };
  after.settled = (after.settled ?? 0) + c.false_refund_correction + c.special_payout_addition;
  if (c.fr_from_refunded > 0) after.refunded = (after.refunded ?? 0) - c.fr_from_refunded;
  if (c.fr_from_partial > 0) after.partially_refunded = (after.partially_refunded ?? 0) - c.fr_from_partial;
  return after;
}

export const physicalRowCount = (db: DatabaseSync): number =>
  Number((db.prepare("SELECT COUNT(*) AS n FROM settlement_candidates_v2").get() as { n: number }).n);

// active resolver（status別集計）。
// excludeReparse=false: 通常（parser_reparse supersession を尊重した corrected truth）。
// excludeReparse=true : rollback（reparse parse_run 由来 candidate を無視し v1 original を復元）。
// reparse 由来判定は parse_run（parser_name='n2-settlement-reparse'）で行う。special payout addition は
// revision_kind='initial' だが reparse parse_run に属するため、これで正しく除外される。
// 既存 row は削除せず resolver だけで切替える（append-only rollback）。
export function activeStatusCounts(db: DatabaseSync, excludeReparse: boolean): Record<string, number> {
  const rows = excludeReparse
    ? db.prepare(
      `SELECT settlement_status AS s, COUNT(*) AS n FROM settlement_candidates_v2 c
       WHERE c.parse_run_id NOT IN (SELECT parse_run_id FROM parse_runs WHERE parser_name = ?)
         AND NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
       GROUP BY settlement_status`).all(REPARSE_PARSER_NAME)
    : db.prepare(
      `SELECT settlement_status AS s, COUNT(*) AS n FROM settlement_candidates_v2 c
       WHERE NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=c.observation_id)
         AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s WHERE s.supersedes_candidate_id=c.candidate_id)
       GROUP BY settlement_status`).all();
  const out: Record<string, number> = {};
  for (const r of rows as Array<{ s: string; n: number }>) out[r.s] = Number(r.n);
  return out;
}

export function lightIntegrity(db: DatabaseSync): Record<string, number> {
  const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
  return {
    multipleActiveSuccessors: one("SELECT COUNT(*) n FROM (SELECT supersedes_candidate_id FROM settlement_candidates_v2 WHERE supersedes_candidate_id IS NOT NULL GROUP BY supersedes_candidate_id HAVING COUNT(*)>1)"),
    selfSupersedingCycles: one("SELECT COUNT(*) n FROM settlement_candidates_v2 WHERE supersedes_candidate_id=candidate_id"),
    danglingSupersedes: one("SELECT COUNT(*) n FROM settlement_candidates_v2 c WHERE c.supersedes_candidate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 t WHERE t.candidate_id=c.supersedes_candidate_id)"),
  };
}
export function fullIntegrity(db: DatabaseSync): Record<string, unknown> {
  db.exec("CREATE INDEX IF NOT EXISTS reparse_idx_race_bet ON settlement_candidates_v2(canonical_race_key, bet_type)");
  const integrity = (db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>).map((r) => r.integrity_check);
  const fkRows = db.prepare("PRAGMA foreign_key_check").all() as unknown[];
  const one = (sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
  return {
    integrityCheck: integrity.length === 1 && integrity[0] === "ok" ? "ok" : integrity,
    foreignKeyViolations: fkRows.length,
    orphanPayoutLines: one("SELECT COUNT(*) n FROM race_payout_lines_v2 p WHERE NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 c WHERE c.candidate_id=p.candidate_id)"),
    orphanRefundLines: one("SELECT COUNT(*) n FROM race_refund_lines_v2 p WHERE NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 c WHERE c.candidate_id=p.candidate_id)"),
    ambiguousActiveKeys: one(
      `SELECT COUNT(*) n FROM (
         SELECT canonical_race_key, bet_type FROM settlement_candidates_v2 x
         WHERE NOT EXISTS (SELECT 1 FROM settlement_source_duplicate_resolutions_v2 d WHERE d.duplicate_observation_id=x.observation_id)
           AND NOT EXISTS (SELECT 1 FROM settlement_candidates_v2 s WHERE s.supersedes_candidate_id=x.candidate_id)
         GROUP BY canonical_race_key, bet_type HAVING COUNT(*)>1)`),
  };
}
// append-only trigger enforcement を実証（savepoint rollback して痕跡を残さない）。
export function appendOnlyEnforcement(db: DatabaseSync): { updateBlocked: boolean; deleteBlocked: boolean } {
  const target = db.prepare("SELECT candidate_id AS id FROM settlement_candidates_v2 LIMIT 1").get() as { id: string } | undefined;
  if (!target) return { updateBlocked: false, deleteBlocked: false };
  const check = (sql: string): boolean => {
    db.exec("SAVEPOINT ao");
    try { db.prepare(sql).run(target.id); db.exec("ROLLBACK TO ao"); db.exec("RELEASE ao"); return false; }
    catch { db.exec("ROLLBACK TO ao"); db.exec("RELEASE ao"); return true; }
  };
  return {
    updateBlocked: check("UPDATE settlement_candidates_v2 SET settlement_status='settled' WHERE candidate_id=?"),
    deleteBlocked: check("DELETE FROM settlement_candidates_v2 WHERE candidate_id=?"),
  };
}
