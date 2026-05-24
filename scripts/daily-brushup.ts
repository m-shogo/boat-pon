import { DatabaseSync } from "node:sqlite";
import { DEFAULT_MODEL_ALPHA, buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import type { RaceResult } from "../src/domain/types";

type DateRange = { from: string; to: string };

const JST = "+09:00";

const db = openReadOnlyDb("data/boat.sqlite");
try {
  const maxDecisionDate = scalarString(db, "SELECT MAX(date) FROM decision_history") ?? "";
  const maxProgramDate = scalarString(db, "SELECT MAX(date) FROM official_programs") ?? "";
  const maxResultDate = scalarString(db, "SELECT MAX(date) FROM race_results") ?? "";

  const headline = {
    generatedAt: new Date().toISOString(),
    maxDecisionDate,
    maxProgramDate,
    maxResultDate,
  };
  console.log(JSON.stringify({ headline }, null, 2));

  const decisionRange: DateRange = { from: "2025-08-01", to: maxDecisionDate || "2026-05-21" };
  const wfTo = maxProgramDate || "2026-05-20";
  const trainDays = 365;
  const wfRange: DateRange = { from: addDays(wfTo, -365), to: wfTo };

  const oddsCoverage = oddsCoverageByDecisionMonth(db);
  const buyStability = buyStabilityReport(db, decisionRange);
  const evFilters = evFilterGrid(db, decisionRange);

  const regimeCheck = monthlyRegimeCheck({
    db,
    range: wfRange,
    trainDays,
    configs: [
      { id: "ms600-a1", minSampleSize: 600, alpha: 1 },
      { id: "ms1200-a1", minSampleSize: 1200, alpha: 1 },
      { id: "ms2500-a1", minSampleSize: 2500, alpha: 1 },
      { id: "ms1200-a10", minSampleSize: 1200, alpha: 10 },
      { id: `ms1200-a${DEFAULT_MODEL_ALPHA}`, minSampleSize: 1200, alpha: DEFAULT_MODEL_ALPHA },
      { id: "ms1200-a20", minSampleSize: 1200, alpha: 20 },
    ],
  });

  console.log(JSON.stringify({
    decisionRange,
    wfRange,
    trainDays,
    oddsCoverage,
    buyStability,
    evFilters,
    regimeCheck,
  }, null, 2));
} finally {
  db.close();
}

function openReadOnlyDb(path: string) {
  const uri = `file:${path}?mode=ro`;
  return new DatabaseSync(uri);
}

function scalarString(db: DatabaseSync, sql: string, params: import("node:sqlite").SQLInputValue[] = []) {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  if (!row) return null;
  const key = Object.keys(row)[0];
  const value = row[key];
  return value == null ? null : String(value);
}

function oddsCoverageByDecisionMonth(db: DatabaseSync) {
  const rows = db.prepare(`
WITH base AS (
  SELECT substr(date, 1, 7) AS ym, decision, current_odds IS NOT NULL AS has_odds
  FROM decision_history
)
SELECT ym, decision, COUNT(*) AS n, SUM(has_odds) AS with_odds,
       ROUND(1.0 * SUM(has_odds) / COUNT(*), 4) AS odds_rate
FROM base
GROUP BY ym, decision
ORDER BY ym DESC, decision ASC
`).all() as Array<Record<string, unknown>>;
  return rows.slice(0, 60);
}

function buyStabilityReport(db: DatabaseSync, range: DateRange) {
  const rows = db.prepare(`
WITH buy AS (
  SELECT
    h.race_id AS race_id,
    h.date AS date,
    h.venue AS venue,
    h.race_no AS race_no,
    p.close_at AS close_at,
    h.estimated_hit_rate AS est,
    h.recommended_stake_yen AS stake,
    h.current_odds AS odds,
    (h.result = h.selection) AS hit
  FROM decision_history h
  LEFT JOIN official_programs p ON p.race_id = h.race_id
  WHERE h.decision = 'BUY'
    AND h.returned = 0
    AND h.date >= ? AND h.date <= ?
)
SELECT
  substr(date, 1, 7) AS ym,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(hit) / COUNT(*), 4) AS hit_rate,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi,
  ROUND(AVG(est), 4) AS avg_est,
  ROUND((1.0 * SUM(hit) / COUNT(*)) / NULLIF(AVG(est), 0), 3) AS calibration
FROM buy
GROUP BY ym
ORDER BY ym DESC
`).all(range.from, range.to) as Array<Record<string, unknown>>;

  const byVenue = db.prepare(`
WITH buy AS (
  SELECT
    h.venue AS venue,
    h.estimated_hit_rate AS est,
    h.recommended_stake_yen AS stake,
    h.current_odds AS odds,
    (h.result = h.selection) AS hit
  FROM decision_history h
  WHERE h.decision = 'BUY'
    AND h.returned = 0
    AND h.date >= ? AND h.date <= ?
)
SELECT
  venue,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(hit) / COUNT(*), 4) AS hit_rate,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi,
  ROUND(AVG(est), 4) AS avg_est,
  ROUND((1.0 * SUM(hit) / COUNT(*)) / NULLIF(AVG(est), 0), 3) AS calibration
FROM buy
GROUP BY venue
HAVING COUNT(*) >= 20
ORDER BY roi DESC, n DESC
`).all(range.from, range.to) as Array<Record<string, unknown>>;

  const byRaceNo = db.prepare(`
WITH buy AS (
  SELECT
    h.race_no AS race_no,
    h.estimated_hit_rate AS est,
    h.recommended_stake_yen AS stake,
    h.current_odds AS odds,
    (h.result = h.selection) AS hit
  FROM decision_history h
  WHERE h.decision = 'BUY'
    AND h.returned = 0
    AND h.date >= ? AND h.date <= ?
)
SELECT
  race_no,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(hit) / COUNT(*), 4) AS hit_rate,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi
FROM buy
GROUP BY race_no
HAVING COUNT(*) >= 20
ORDER BY roi DESC, n DESC
`).all(range.from, range.to) as Array<Record<string, unknown>>;

  const byTimeBand = db.prepare(`
WITH buy AS (
  SELECT
    h.estimated_hit_rate AS est,
    h.recommended_stake_yen AS stake,
    h.current_odds AS odds,
    (h.result = h.selection) AS hit,
    COALESCE(p.close_at, '??:??') AS close_at
  FROM decision_history h
  LEFT JOIN official_programs p ON p.race_id = h.race_id
  WHERE h.decision = 'BUY'
    AND h.returned = 0
    AND h.date >= ? AND h.date <= ?
),
bucket AS (
  SELECT
    CASE
      WHEN close_at GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(close_at, 1, 2) AS INT) < 12 THEN 'morning'
      WHEN close_at GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(close_at, 1, 2) AS INT) < 16 THEN 'day'
      WHEN close_at GLOB '[0-2][0-9]:[0-5][0-9]' THEN 'late'
      ELSE 'unknown'
    END AS time_band,
    est, stake, odds, hit
  FROM buy
)
SELECT
  time_band,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(hit) / COUNT(*), 4) AS hit_rate,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi,
  ROUND(AVG(est), 4) AS avg_est,
  ROUND((1.0 * SUM(hit) / COUNT(*)) / NULLIF(AVG(est), 0), 3) AS calibration
FROM bucket
GROUP BY time_band
ORDER BY roi DESC, n DESC
`).all(range.from, range.to) as Array<Record<string, unknown>>;

  return {
    byMonth: rows,
    byVenue,
    byRaceNo,
    byTimeBand,
  };
}

function evFilterGrid(db: DatabaseSync, range: DateRange) {
  const thresholds = [1.25, 1.35, 1.5, 1.75, 2.0, 2.5];
  const bandStmt = db.prepare(`
WITH base AS (
  SELECT
    ev AS ev,
    current_odds AS current_odds,
    required_odds AS required_odds,
    sample_size AS sample_size,
    recommended_stake_yen AS stake,
    current_odds AS odds,
    (result = selection) AS hit
  FROM decision_history
  WHERE decision = 'BUY'
    AND returned = 0
    AND date >= ? AND date <= ?
    AND ev IS NOT NULL
)
SELECT
  ? AS label,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi,
  ROUND(AVG(ev), 3) AS avg_ev,
  ROUND(AVG(current_odds), 1) AS avg_odds
FROM base
WHERE ev BETWEEN ? AND ?
  AND current_odds < ?
  AND required_odds < ?
  AND sample_size >= ?
`);

  const bands = [
    { label: "ev[1.5,3.0], odds<50, req<50, sample>=100", evMin: 1.5, evMax: 3.0, maxOdds: 50, maxReq: 50, minSample: 100 },
    { label: "ev[2.0,3.0], odds<50, req<50, sample>=600", evMin: 2.0, evMax: 3.0, maxOdds: 50, maxReq: 50, minSample: 600 },
  ];
  const bandRows = bands.map((b) => bandStmt.all(
    range.from,
    range.to,
    b.label,
    b.evMin,
    b.evMax,
    b.maxOdds,
    b.maxReq,
    b.minSample,
  )[0]);

  const thrRows = thresholds.map((thr) => {
    const r = db.prepare(`
WITH base AS (
  SELECT ev AS ev, recommended_stake_yen AS stake, current_odds AS odds, (result = selection) AS hit
  FROM decision_history
  WHERE decision = 'BUY'
    AND returned = 0
    AND date >= ? AND date <= ?
    AND ev IS NOT NULL
)
SELECT
  ? AS target_ev,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(1.0 * SUM(CASE WHEN hit THEN COALESCE(odds, 0) * stake ELSE 0 END) / NULLIF(SUM(stake), 0), 3) AS roi,
  ROUND(AVG(ev), 3) AS avg_ev
FROM base
WHERE ev >= ?
`).get(range.from, range.to, thr, thr) as Record<string, unknown>;
    return r;
  });

  return { thresholds: thrRows, bands: bandRows };
}

function monthlyRegimeCheck(input: {
  db: DatabaseSync;
  range: DateRange;
  trainDays: number;
  configs: Array<{ id: string; minSampleSize: number; alpha: number }>;
}) {
  const trainFrom = addDays(input.range.from, -input.trainDays);
  const results = listResultsRange(input.db, trainFrom, input.range.to);
  const programs = listProgramsRange(input.db, input.range.from, input.range.to);
  const resultByRaceId = new Map(results.map((r) => [r.raceId, r]));
  const months = monthsInRange(input.range.from, input.range.to);

  const rows = input.configs.map((cfg) => {
    const perMonth = months.map((ym) => {
      const monthFrom = `${ym}-01`;
      const monthTo = addDays(addMonths(monthFrom, 1), -1);
      const trainCut = monthFrom;
      const trainStart = addDays(trainCut, -input.trainDays);

      const trainResults = filterComparableResultsForDate(
        results.filter((r) => r.date >= trainStart && r.date < trainCut),
        trainCut,
      );
      const model = buildVenueModel(trainResults, cfg.minSampleSize, cfg.alpha);

      const monthPrograms = programs.filter((p) => p.date >= monthFrom && p.date <= monthTo);
      let modeled = 0;
      let hits = 0;
      let avgEstSum = 0;

      for (const p of monthPrograms) {
        const candidates = buildCandidatesFromModel([p], model, 1.25, `${p.date}T00:00:00${JST}`, new Map());
        const c = candidates[0];
        if (!c) continue;
        modeled += 1;
        avgEstSum += c.estimatedHitRate;
        const raceId = `${p.date.replaceAll("-", "")}-${p.venue}-${String(p.raceNo).padStart(2, "0")}`;
        const r = resultByRaceId.get(raceId);
        const selection = c.selection.join("-");
        if (r?.trifecta === selection) hits += 1;
      }

      const hitRate = modeled ? hits / modeled : 0;
      const avgEst = modeled ? avgEstSum / modeled : 0;
      const calibration = avgEst ? hitRate / avgEst : 0;
      return { ym, programs: monthPrograms.length, modeled, hits, hitRate, avgEst, calibration };
    });
    return { config: cfg, perMonth };
  });

  return { range: input.range, trainFrom, programs: programs.length, results: results.length, rows };
}

function listResultsRange(db: DatabaseSync, from: string, to: string): RaceResult[] {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at
FROM race_results
WHERE date >= ? AND date <= ?
ORDER BY date ASC, venue ASC, race_no ASC
`).all(from, to) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    trifecta: row.trifecta == null ? null : String(row.trifecta),
    payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
    popularity: row.popularity == null ? null : Number(row.popularity),
    returned: Boolean(row.returned),
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
  }));
}

function listProgramsRange(db: DatabaseSync, from: string, to: string): ModelCandidateInput[] {
  const rows = db.prepare(`
SELECT date, venue, race_no, close_at
FROM official_programs
WHERE date >= ? AND date <= ?
ORDER BY date ASC, venue ASC, race_no ASC
`).all(from, to) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    closeAt: String(row.close_at),
  }));
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthsInRange(from: string, to: string) {
  const start = from.slice(0, 7);
  const end = to.slice(0, 7);
  const out: string[] = [];
  let cursor = `${start}-01`;
  while (cursor.slice(0, 7) <= end) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
