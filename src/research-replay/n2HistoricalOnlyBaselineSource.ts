import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { parseCanonicalRaceKey } from "./identity";
import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";
import {
  N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT,
  N2_HISTORICAL_LOOKBACK_DAYS,
  type N2HistoricalEvaluationRace,
  type N2HistoricalOutcomeRow,
} from "./n2HistoricalOnlyBaselineDataset";
import { buildN2MarketBaselineReadinessReport } from "./n2MarketBaselineReadiness";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";
import { compareN2RaceKeysByRaceTime } from "./n2MarketOnlyBaselineDataset";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

export const N2_HISTORICAL_ONLY_BASELINE_SOURCE_VERSION =
  "n2-historical-only-baseline-source-v1" as const;

export type N2HistoricalOnlyBaselineSourceRead = {
  readerVersion: typeof N2_HISTORICAL_ONLY_BASELINE_SOURCE_VERSION;
  status: "PASS" | "BLOCKED";
  blockers: string[];
  readinessStatus: string;
  readinessDigest: string;
  acceptedT5RaceCount: number;
  settledAcceptedT5RaceCount: number;
  selectedCohortRaceCount: number;
  historicalTrainingRaceCount: number;
  trainingFromDateInclusive: string | null;
  trainingToDateInclusive: string | null;
  training: N2HistoricalOutcomeRow[];
  evaluationRaces: N2HistoricalEvaluationRace[];
  databaseReadCount: number;
  databaseWriteCount: 0;
  networkRequestCount: 0;
  rawOddsValuesRead: false;
  liveOnlyFeatureReadCount: 0;
  publicPublishAuthorized: false;
  productionApplyExecuted: false;
};

type WinnerRow = {
  raceKey: string;
  observationId: string;
  candidateParseRunId: string;
  candidateRawDocumentId: string;
  observationRaceKey: string | null;
  observationType: string | null;
  observationPayloadType: string | null;
  observationParseRunId: string | null;
  observationRawDocumentId: string | null;
  parseRunRawDocumentId: string | null;
  parseRunStatus: string | null;
  winningSelection: string | null;
};

const RACE_KEY_RE = /^(\d{4}-\d{2}-\d{2}):(0[1-9]|1\d|2[0-4]):R([1-9]|1[0-2])$/u;
const TRIFECTA_SELECTION_RE = /^[1-6]-[1-6]-[1-6]$/u;
const REUSABLE_PARSE_STATUSES = new Set(["success", "warning"]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function isCanonicalN2HistoricalRaceKey(value: string): boolean {
  try {
    parseCanonicalRaceKey(value);
    return true;
  } catch {
    return false;
  }
}

function raceDate(raceKey: string): string | null {
  try {
    return parseCanonicalRaceKey(raceKey).raceDateJst;
  } catch {
    return null;
  }
}

function compareRaceKeys(left: string, right: string): number {
  const a = RACE_KEY_RE.exec(left);
  const b = RACE_KEY_RE.exec(right);
  if (!a || !b) return left.localeCompare(right);
  return a[1].localeCompare(b[1]) || Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3]);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) throw new Error(`N2_HISTORICAL_SOURCE_DATE_INVALID:${date}`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validSelection(value: string): boolean {
  if (!TRIFECTA_SELECTION_RE.test(value)) return false;
  return new Set(value.split("-")).size === 3;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function openImmutableSidecar(path: string): DatabaseSync {
  const walPath = `${path}-wal`;
  if (existsSync(walPath) && statSync(walPath).size > 0) {
    throw new Error("SIDECAR_ACTIVE_WAL");
  }
  const db = new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  return db;
}

function readCleanTrifectaWinners(input: {
  sidecarDbPath: string;
  fromDate: string;
  toDate: string;
}): { rows: N2HistoricalOutcomeRow[]; blockers: string[] } {
  const db = openImmutableSidecar(input.sidecarDbPath);
  try {
    for (const table of [
      "domain_observations",
      "parse_runs",
      "settlement_candidates_v2",
      "race_payout_lines_v2",
      "settlement_source_duplicate_resolutions_v2",
    ]) {
      if (!tableExists(db, table)) return { rows: [], blockers: [`SIDECAR_TABLE_MISSING:${table}`] };
    }
    let validResolvedObservationIds: Set<string>;
    try {
      validResolvedObservationIds = readCurrentlyValidSourceDuplicateObservationIds(db);
    } catch {
      return { rows: [], blockers: ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"] };
    }
    const rawRows = db.prepare(`
      SELECT
        c.canonical_race_key AS raceKey,
        c.observation_id AS observationId,
        c.parse_run_id AS candidateParseRunId,
        c.raw_document_id AS candidateRawDocumentId,
        o.canonical_race_key AS observationRaceKey,
        o.observation_type AS observationType,
        o.payload_type AS observationPayloadType,
        o.parse_run_id AS observationParseRunId,
        o.raw_document_id AS observationRawDocumentId,
        pr.raw_document_id AS parseRunRawDocumentId,
        pr.status AS parseRunStatus,
        p.selection_canonical AS winningSelection
      FROM settlement_candidates_v2 c
      LEFT JOIN domain_observations o
        ON o.observation_id=c.observation_id
      LEFT JOIN parse_runs pr
        ON pr.parse_run_id=c.parse_run_id
      JOIN race_payout_lines_v2 p
        ON p.candidate_id=c.candidate_id
       AND p.bet_type='trifecta'
       AND p.line_kind='payout'
       AND p.selection_canonical IS NOT NULL
      WHERE c.bet_type='trifecta'
        AND c.settlement_status='settled'
        AND c.result_kind='normal'
        AND c.resolution_status='resolved'
        AND substr(c.canonical_race_key,1,10) >= ?
        AND substr(c.canonical_race_key,1,10) <= ?
        AND NOT EXISTS (
          SELECT 1 FROM settlement_candidates_v2 newer
          WHERE newer.supersedes_candidate_id=c.candidate_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM race_payout_lines_v2 special
          WHERE special.candidate_id=c.candidate_id
            AND special.bet_type='trifecta'
            AND special.line_kind='special_payout'
        )
      ORDER BY c.canonical_race_key,p.line_no
    `).all(input.fromDate, input.toDate) as unknown as WinnerRow[];

    const blockers: string[] = [];
    const grouped = new Map<string, string[]>();
    for (const row of rawRows) {
      if (validResolvedObservationIds.has(row.observationId)) continue;
      if (row.observationRaceKey !== row.raceKey
        || row.observationType !== "settlement_result"
        || row.observationPayloadType !== "settlement_result"
        || row.observationParseRunId !== row.candidateParseRunId
        || row.observationRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunRawDocumentId !== row.candidateRawDocumentId
        || row.parseRunStatus == null
        || !REUSABLE_PARSE_STATUSES.has(row.parseRunStatus)) {
        blockers.push(`${row.raceKey}:SETTLEMENT_LINEAGE_MISMATCH:${row.observationId}`);
        continue;
      }
      const current = grouped.get(row.raceKey) ?? [];
      if (row.winningSelection != null) current.push(row.winningSelection);
      grouped.set(row.raceKey, current);
    }
    const rows: N2HistoricalOutcomeRow[] = [];
    for (const [raceKey, selections] of grouped.entries()) {
      if (!isCanonicalN2HistoricalRaceKey(raceKey)) {
        blockers.push(`${raceKey}:CANONICAL_RACE_KEY_INVALID`);
        continue;
      }
      if (selections.length !== 1) {
        blockers.push(`${raceKey}:ACTIVE_WINNER_COUNT_${selections.length}`);
        continue;
      }
      const winningSelection = selections[0];
      if (!validSelection(winningSelection)) {
        blockers.push(`${raceKey}:WINNING_SELECTION_INVALID`);
        continue;
      }
      rows.push({ canonicalRaceKey: raceKey, winningSelection });
    }
    return {
      rows: rows.sort((left, right) => compareRaceKeys(left.canonicalRaceKey, right.canonicalRaceKey)),
      blockers: unique(blockers),
    };
  } finally {
    db.close();
  }
}

function blocked(input: {
  blockers: string[];
  readinessStatus: string;
  readinessDigest: string;
  acceptedT5RaceCount: number;
  settledAcceptedT5RaceCount: number;
  databaseReadCount: number;
}): N2HistoricalOnlyBaselineSourceRead {
  return {
    readerVersion: N2_HISTORICAL_ONLY_BASELINE_SOURCE_VERSION,
    status: "BLOCKED",
    blockers: unique(input.blockers),
    readinessStatus: input.readinessStatus,
    readinessDigest: input.readinessDigest,
    acceptedT5RaceCount: input.acceptedT5RaceCount,
    settledAcceptedT5RaceCount: input.settledAcceptedT5RaceCount,
    selectedCohortRaceCount: 0,
    historicalTrainingRaceCount: 0,
    trainingFromDateInclusive: null,
    trainingToDateInclusive: null,
    training: [],
    evaluationRaces: [],
    databaseReadCount: input.databaseReadCount,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawOddsValuesRead: false,
    liveOnlyFeatureReadCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}

export function readN2HistoricalOnlyBaselineSources(input: {
  dataRoot: string;
  sidecarDbPath?: string;
}): N2HistoricalOnlyBaselineSourceRead {
  const dataRoot = resolve(input.dataRoot);
  const sidecarDbPath = resolve(input.sidecarDbPath ?? resolve(dataRoot, "data/research-replay.sqlite"));
  const readinessRead = readN2MarketBaselineReadiness({ dataRoot, sidecarDbPath });
  const readiness = buildN2MarketBaselineReadinessReport({
    acceptedT5RaceKeys: readinessRead.acceptedT5RaceKeys,
    settledRaceKeys: readinessRead.settledRaceKeys,
    integrityBlockedRaceKeys: readinessRead.integrityBlockedRaceKeys,
    sourceBlockers: readinessRead.sourceBlockers,
  });
  if (!readiness.n2TaskReady) {
    return blocked({
      blockers: [`READINESS_${readiness.status}`, ...readiness.blockers],
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount,
    });
  }

  const cutoffRead = readN2T5DecisionCutoffMetadata({
    dataRoot,
    raceKeys: readinessRead.settledRaceKeys,
  });
  if (cutoffRead.status !== "PASS") {
    return blocked({
      blockers: cutoffRead.blockers.map((blocker) => `T5_CUTOFF_METADATA:${blocker}`),
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount,
    });
  }

  const evaluationKeys = [...readinessRead.settledRaceKeys]
    .sort((left, right) => Date.parse(cutoffRead.decisionCutoffByRaceKey[left])
      - Date.parse(cutoffRead.decisionCutoffByRaceKey[right])
      || compareN2RaceKeysByRaceTime(left, right))
    .slice(0, N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT);
  const evaluationDates = evaluationKeys.map(raceDate).filter((date): date is string => date != null);
  if (evaluationKeys.length !== N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT
    || evaluationDates.length !== evaluationKeys.length) {
    return blocked({
      blockers: [`EVALUATION_COHORT_INVALID:${evaluationKeys.length}/${N2_HISTORICAL_EVALUATION_COHORT_RACE_COUNT}`],
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount,
    });
  }
  const earliestDate = [...evaluationDates].sort()[0];
  const latestDate = [...evaluationDates].sort().at(-1)!;
  const trainingFromDate = addDays(earliestDate, -N2_HISTORICAL_LOOKBACK_DAYS);
  let historical: ReturnType<typeof readCleanTrifectaWinners>;
  try {
    historical = readCleanTrifectaWinners({
      sidecarDbPath,
      fromDate: trainingFromDate,
      toDate: latestDate,
    });
  } catch (error) {
    return blocked({
      blockers: [error instanceof Error ? error.message : "SIDECAR_HISTORICAL_READ_FAILED"],
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount,
    });
  }
  if (historical.blockers.length > 0) {
    return blocked({
      blockers: historical.blockers,
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount + 1,
    });
  }
  const winnerByRace = new Map(historical.rows.map((row) => [row.canonicalRaceKey, row.winningSelection]));
  const missingEvaluation = evaluationKeys.filter((raceKey) => !winnerByRace.has(raceKey));
  if (missingEvaluation.length > 0) {
    return blocked({
      blockers: [`EVALUATION_WINNER_MISSING:${missingEvaluation.length}`],
      readinessStatus: readiness.status,
      readinessDigest: readiness.outputDigest,
      acceptedT5RaceCount: readiness.acceptedT5RaceCount,
      settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
      databaseReadCount: readinessRead.databaseReadCount + 1,
    });
  }
  const evaluationRaces = evaluationKeys.map((canonicalRaceKey) => ({
    canonicalRaceKey,
    winningSelection: winnerByRace.get(canonicalRaceKey)!,
  }));
  return {
    readerVersion: N2_HISTORICAL_ONLY_BASELINE_SOURCE_VERSION,
    status: "PASS",
    blockers: [],
    readinessStatus: readiness.status,
    readinessDigest: readiness.outputDigest,
    acceptedT5RaceCount: readiness.acceptedT5RaceCount,
    settledAcceptedT5RaceCount: readiness.settledAcceptedT5RaceCount,
    selectedCohortRaceCount: evaluationRaces.length,
    historicalTrainingRaceCount: historical.rows.length,
    trainingFromDateInclusive: trainingFromDate,
    trainingToDateInclusive: latestDate,
    training: historical.rows,
    evaluationRaces,
    databaseReadCount: readinessRead.databaseReadCount + 1,
    databaseWriteCount: 0,
    networkRequestCount: 0,
    rawOddsValuesRead: false,
    liveOnlyFeatureReadCount: 0,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}
