import express from "express";
import { summarizeByMonth, summarizeHistory, summarizeMonth } from "../src/domain/backtest";
import { calculateSavings } from "../src/domain/savings";
import { summarizeVenueHeatmap } from "../src/domain/venueHeatmap";
import { summarizeByRaceNo, summarizeByTimeBand } from "../src/domain/segmentStats";
import { summarizeProgramStats } from "../src/domain/programStats";
import { summarizeCategoryStats } from "../src/domain/categoryStats";
import { summarizeRollingDrift } from "../src/domain/rollingDrift";
import { getModelVersionInfo } from "../src/domain/modelVersion";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION, liveMonitorFilterText } from "../src/domain/liveMonitor";
import { analyzeOvervaluation } from "../src/domain/analysis";
import { explainDecision, summarizeSkipReasons } from "../src/domain/decisionExplain";
import { runWalkForwardBacktest, summarizeWalkForward } from "../src/domain/walkForward";
import { compareModelVariants } from "../src/domain/modelComparison";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import {
  createNotificationIfNeeded,
  countOddsSnapshots,
  deletePushSubscription,
  getDataCoverage,
  getManualOdds,
  insertOfficialProgram,
  listOddsSnapshots,
  listEarlyOddsSnapshots,
  listAllOddsBySelection,
  getSettings,
  insertDecisionHistory,
  listDecisionHistory,
  listNotifications,
  listOfficialProgramsRaw,
  listProgramInputs,
  listPushSubscriptions,
  listAllResultsForModel,
  listResults,
  listResultsForModelRange,
  markNotificationSent,
  openDb,
  setManualOdds,
  setOdds,
  updatePurchaseRecord,
  upsertPushSubscription,
  setSettings,
} from "./db";
import webpush from "web-push";
import { buildCandidateRows } from "./candidates";
import { fetchOfficialOdds } from "../scripts/fetch-official-odds";
import { isTrifectaSelectionUnavailable, parseTrifectaOdds } from "../src/domain/oddsParser";
import { isWithinOddsFetchWindow, shouldPersistDecisionHistory } from "../src/domain/livePersistence";
import type { BudgetRule } from "../src/domain/types";

const ODDS_FETCH_WINDOW_MINUTES = 30;
const CANDIDATE_CACHE_TTL_MS = 15_000;

const VAPID_PUBLIC = process.env.BOAT_PON_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.BOAT_PON_VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.BOAT_PON_VAPID_SUBJECT ?? "mailto:boatpon@example.com";
const PUSH_ENABLED = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC!, VAPID_PRIVATE!);
}

async function broadcastPush(payload: { title: string; body: string; url?: string }) {
  if (!PUSH_ENABLED) return { sent: 0, failed: 0, skipped: true };
  const db = openDb();
  let sent = 0;
  let failed = 0;
  try {
    const subs = listPushSubscriptions(db);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          deletePushSubscription(db, sub.endpoint);
        }
      }
    }
  } finally {
    db.close();
  }
  return { sent, failed, skipped: false };
}

function validateBudgetRule(settings: BudgetRule): string | null {
  const positiveKeys: Array<keyof BudgetRule> = [
    "dailyBudgetYen",
    "stakePerBetYen",
    "maxStakePerRaceYen",
    "maxBuyCountPerDay",
    "minSampleSize",
    "minMinutesBeforeClose",
    "targetEv",
  ];
  for (const key of positiveKeys) {
    const value = settings[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return `${key} must be positive`;
  }
  if (settings.stakePerBetYen > settings.maxStakePerRaceYen) return "stakePerBetYen must be <= maxStakePerRaceYen";
  if (settings.maxStakePerRaceYen > settings.dailyBudgetYen) return "maxStakePerRaceYen must be <= dailyBudgetYen";
  if (settings.calibrationMode != null && !["none", "v3-empirical"].includes(settings.calibrationMode)) {
    return "calibrationMode must be none or v3-empirical";
  }
  if (settings.calibrationBasis != null && !["requiredOdds", "currentOdds"].includes(settings.calibrationBasis)) {
    return "calibrationBasis must be requiredOdds or currentOdds";
  }
  if (settings.maxOdds != null && (!Number.isFinite(settings.maxOdds) || settings.maxOdds <= 0)) {
    return "maxOdds must be positive";
  }
  if (settings.oddsCalibrationFactors != null) {
    if (!Array.isArray(settings.oddsCalibrationFactors)) return "oddsCalibrationFactors must be an array";
    for (const factor of settings.oddsCalibrationFactors) {
      if (!Number.isFinite(factor.maxRequiredOdds) || factor.maxRequiredOdds <= 0) return "oddsCalibrationFactors.maxRequiredOdds must be positive";
      if (!Number.isFinite(factor.factor) || factor.factor <= 0) return "oddsCalibrationFactors.factor must be positive";
    }
  }
  if (settings.programFilter != null) {
    const filter = settings.programFilter;
    if (filter.allowedClassNames != null && (!Array.isArray(filter.allowedClassNames) || filter.allowedClassNames.some((name) => typeof name !== "string"))) {
      return "programFilter.allowedClassNames must be a string array";
    }
    if (filter.maxMotorTop2Rate != null && (!Number.isFinite(filter.maxMotorTop2Rate) || filter.maxMotorTop2Rate < 0 || filter.maxMotorTop2Rate > 100)) {
      return "programFilter.maxMotorTop2Rate must be between 0 and 100";
    }
    if (filter.maxBoatTop2Rate != null && (!Number.isFinite(filter.maxBoatTop2Rate) || filter.maxBoatTop2Rate < 0 || filter.maxBoatTop2Rate > 100)) {
      return "programFilter.maxBoatTop2Rate must be between 0 and 100";
    }
    if (filter.excludedSecondBoatClassNames != null && (!Array.isArray(filter.excludedSecondBoatClassNames) || filter.excludedSecondBoatClassNames.some((name) => typeof name !== "string"))) {
      return "programFilter.excludedSecondBoatClassNames must be a string array";
    }
    if (filter.excludeSameClassSecondBoat != null && typeof filter.excludeSameClassSecondBoat !== "boolean") {
      return "programFilter.excludeSameClassSecondBoat must be a boolean";
    }
    if (filter.minFirstBoatNationalWinRate != null && (!Number.isFinite(filter.minFirstBoatNationalWinRate) || filter.minFirstBoatNationalWinRate < 0)) {
      return "programFilter.minFirstBoatNationalWinRate must be a non-negative number";
    }
  }
  if (settings.classOddsRatioRules != null) {
    if (!Array.isArray(settings.classOddsRatioRules)) return "classOddsRatioRules must be an array";
    for (const r of settings.classOddsRatioRules) {
      if (!Array.isArray(r.classNames) || r.classNames.some((n: unknown) => typeof n !== "string")) {
        return "classOddsRatioRules[].classNames must be a string array";
      }
      if (r.maxOddsRatio != null && (!Number.isFinite(r.maxOddsRatio) || r.maxOddsRatio <= 0)) {
        return "classOddsRatioRules[].maxOddsRatio must be positive";
      }
      if (r.minOddsRatio != null && (!Number.isFinite(r.minOddsRatio) || r.minOddsRatio <= 0)) {
        return "classOddsRatioRules[].minOddsRatio must be positive";
      }
    }
  }
  if (settings.venueSignalBandRules != null) {
    if (!Array.isArray(settings.venueSignalBandRules)) return "venueSignalBandRules must be an array";
    for (const r of settings.venueSignalBandRules) {
      if (!Array.isArray(r.venues) || r.venues.some((v: unknown) => typeof v !== "string")) {
        return "venueSignalBandRules[].venues must be a string array";
      }
      if (!["S", "A", "B"].includes(String(r.minBand))) {
        return "venueSignalBandRules[].minBand must be S, A, or B";
      }
    }
  }
  if (settings.minRequiredOdds != null && (!Number.isFinite(settings.minRequiredOdds) || settings.minRequiredOdds <= 0)) {
    return "minRequiredOdds must be positive";
  }
  if (settings.maxRequiredOdds != null && (!Number.isFinite(settings.maxRequiredOdds) || settings.maxRequiredOdds <= 0)) {
    return "maxRequiredOdds must be positive";
  }
  if (settings.minRequiredOdds != null && settings.maxRequiredOdds != null && settings.minRequiredOdds >= settings.maxRequiredOdds) {
    return "minRequiredOdds must be less than maxRequiredOdds";
  }
  if (settings.excludedVenues != null && (!Array.isArray(settings.excludedVenues) || settings.excludedVenues.some((v) => typeof v !== "string"))) {
    return "excludedVenues must be a string array";
  }
  if (settings.excludedRaceNos != null && (!Array.isArray(settings.excludedRaceNos) || settings.excludedRaceNos.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 12))) {
    return "excludedRaceNos must be an array of integers between 1 and 12";
  }
  return null;
}

const app = express();
app.use(express.json());

type BuiltCandidateRow = ReturnType<typeof buildCandidateRows>[number];
type CandidateCacheEntry = {
  createdAt: number;
  date: string;
  settingsKey: string;
  rows: BuiltCandidateRow[];
};

let candidateCache: CandidateCacheEntry | null = null;

function candidateSettingsKey(settings: BudgetRule) {
  return JSON.stringify(settings);
}

function invalidateCandidateCache() {
  candidateCache = null;
}

function buildRowsForDate(db: ReturnType<typeof openDb>, settings: BudgetRule, date: string) {
  const settingsKey = candidateSettingsKey(settings);
  const nowMs = Date.now();
  if (
    candidateCache &&
    candidateCache.date === date &&
    candidateCache.settingsKey === settingsKey &&
    nowMs - candidateCache.createdAt <= CANDIDATE_CACHE_TTL_MS
  ) {
    return candidateCache.rows;
  }

  const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
  const rows = buildCandidateRows(
    settings,
    new Date(),
    oddsByRaceId,
    listProgramInputs(db, date).map((row) => ({
      date: row.date,
      venue: row.venue,
      raceNo: row.raceNo,
      closeAt: row.closeAt,
      raceCategory: row.raceCategory,
      features: row.features,
    })),
    listResultsForModelRange(db, addDaysJst(date, -180), date),
    listEarlyOddsSnapshots(db),
    listAllOddsBySelection(db),
  );
  candidateCache = { createdAt: nowMs, date, settingsKey, rows };
  return rows;
}

function candidateCounts(rows: BuiltCandidateRow[]) {
  return {
    total: rows.length,
    buy: rows.filter((row) => row.decision.status === "BUY").length,
    watch: rows.filter((row) => row.decision.status === "WATCH").length,
    skip: rows.filter((row) => row.decision.status === "SKIP").length,
  };
}

function pctNumber(num: number, denom: number) {
  if (denom === 0) return null;
  return Math.round((num / denom) * 1000) / 10;
}

function getScalarCount(db: ReturnType<typeof openDb>, sql: string, ...params: Array<string | number>) {
  const row = db.prepare(sql).get(...params) as { value: number | bigint | null } | undefined;
  return Number(row?.value ?? 0);
}

function tableExists(db: ReturnType<typeof openDb>, table: string) {
  return db.prepare("SELECT 1 AS value FROM sqlite_master WHERE type='table' AND name=?").get(table) != null;
}

function buildBeforeInfoCoverage(db: ReturnType<typeof openDb>, date: string) {
  const hasExhibition = tableExists(db, "exhibition_data");
  const hasWeather = tableExists(db, "race_weather");
  const hasEquipment = tableExists(db, "race_equipment");
  const totalRaces = getScalarCount(db, "SELECT COUNT(*) AS value FROM official_programs WHERE date = ?", date);
  if (totalRaces === 0) {
    return {
      totalRaces: 0,
      exhibitionRaces: 0,
      weatherRaces: 0,
      equipmentRaces: 0,
      fullRaces: 0,
      exhibitionPct: null,
      weatherPct: null,
      equipmentPct: null,
      fullPct: null,
      watchBuyRaces: 0,
      watchBuyFullRaces: 0,
      watchBuyFullPct: null,
    };
  }
  const exhibitionRaces = hasExhibition ? getScalarCount(db, `
    SELECT COUNT(DISTINCT e.race_id) AS value
    FROM exhibition_data e
    JOIN official_programs p ON p.race_id = e.race_id
    WHERE p.date = ?
  `, date) : 0;
  const weatherRaces = hasWeather ? getScalarCount(db, `
    SELECT COUNT(DISTINCT w.race_id) AS value
    FROM race_weather w
    JOIN official_programs p ON p.race_id = w.race_id
    WHERE p.date = ?
  `, date) : 0;
  const equipmentRaces = hasEquipment ? getScalarCount(db, `
    SELECT COUNT(DISTINCT q.race_id) AS value
    FROM race_equipment q
    JOIN official_programs p ON p.race_id = q.race_id
    WHERE p.date = ?
  `, date) : 0;
  const canMeasureFullCoverage = hasExhibition && hasWeather && hasEquipment;
  const fullRaces = canMeasureFullCoverage ? getScalarCount(db, `
    SELECT COUNT(*) AS value
    FROM official_programs p
    WHERE p.date = ?
      AND EXISTS (SELECT 1 FROM exhibition_data e WHERE e.race_id = p.race_id)
      AND EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = p.race_id)
      AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = p.race_id)
  `, date) : 0;
  const watchBuyRaces = tableExists(db, "decision_history") ? getScalarCount(db, `
    SELECT COUNT(DISTINCT race_id) AS value
    FROM decision_history
    WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
  `, date, LIVE_MONITOR_MODEL_VERSION) : 0;
  const watchBuyFullRaces = watchBuyRaces > 0 && canMeasureFullCoverage ? getScalarCount(db, `
    SELECT COUNT(DISTINCT dh.race_id) AS value
    FROM decision_history dh
    WHERE dh.date = ? AND dh.model_version = ? AND dh.decision IN ('WATCH', 'BUY')
      AND EXISTS (SELECT 1 FROM exhibition_data e WHERE e.race_id = dh.race_id)
      AND EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = dh.race_id)
      AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = dh.race_id)
  `, date, LIVE_MONITOR_MODEL_VERSION) : 0;

  return {
    totalRaces,
    exhibitionRaces,
    weatherRaces,
    equipmentRaces,
    fullRaces,
    exhibitionPct: pctNumber(exhibitionRaces, totalRaces),
    weatherPct: pctNumber(weatherRaces, totalRaces),
    equipmentPct: pctNumber(equipmentRaces, totalRaces),
    fullPct: pctNumber(fullRaces, totalRaces),
    watchBuyRaces,
    watchBuyFullRaces,
    watchBuyFullPct: pctNumber(watchBuyFullRaces, watchBuyRaces),
  };
}

function selectDashboardRows(rows: BuiltCandidateRow[]) {
  const buyRows = rows.filter((row) => row.decision.status === "BUY");
  const watchRows = rows.filter((row) => row.decision.status === "WATCH");
  if (buyRows.length + watchRows.length > 0) return [...buyRows, ...watchRows.slice(0, 24)];
  return rows.slice(0, 24);
}

function explainRows(rows: BuiltCandidateRow[], settings: BudgetRule) {
  return rows.map((row) => ({
    ...row,
    explanation: explainDecision(row.candidate, row.decision, settings),
  }));
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/coverage", (_req, res) => {
  const db = openDb();
  try {
    res.json(getDataCoverage(db));
  } finally {
    db.close();
  }
});

app.get("/api/dashboard", (req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const date = typeof req.query.date === "string" ? req.query.date : todayJst();
    const persistDashboardHistory = date < LIVE_MONITOR_FROM || date === todayJst();
    const rows = buildRowsForDate(db, settings, date);
    const freshPushPayloads: Array<{ title: string; body: string; url: string }> = [];
    for (const row of rows) {
      if (!persistDashboardHistory || row.candidate.source === "sample") continue;
      if (!shouldPersistDecisionHistory(row.candidate, settings, LIVE_MONITOR_FROM)) continue;
      insertDecisionHistory(db, row.candidate, row.decision);
      const created = createNotificationIfNeeded(db, row.candidate, row.decision, row.officialUrl);
      if (created?.created) {
        freshPushPayloads.push({ title: created.title, body: created.body, url: row.officialUrl });
      }
    }
    if (PUSH_ENABLED && freshPushPayloads.length > 0) {
      for (const payload of freshPushPayloads) {
        void broadcastPush(payload);
      }
    }

    const counts = candidateCounts(rows);
    const explainedRows = explainRows(selectDashboardRows(rows), settings);
    const buyRows = rows.filter((row) => row.decision.status === "BUY");
    const oddsSnapshotCount = countOddsSnapshots(db);
    const history = listDecisionHistory(db);
    const rawPrograms = listOfficialProgramsRaw(db, date);
    const closeAtByRaceId = new Map(rawPrograms.map((row) => [row.raceId, row.closeAt]));
    const programByRaceId = new Map(rawPrograms.map((row) => [row.raceId, row.raw]));
    res.json({
      settings,
      headline: buyRows.length ? "BUY候補あり" : "全レース見送り",
      headlineSub: buyRows.length
        ? "BUY条件を満たした候補のみ通知対象です。購入前に公式オッズで最終確認してください。"
        : "EV 1.25以上の候補なし。買わない日として成功扱いです。",
      rows: explainedRows,
      candidateRowCount: counts.total,
      decisionCounts: counts,
      date,
      results: listResults(db, date),
      notifications: listNotifications(db),
      history: [],
      backtest: {
        ...summarizeHistory(history, settings.minSampleSize),
        overvaluation: analyzeOvervaluation(history),
      },
      monthly: summarizeMonth(
        history,
        (date ?? new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date())).slice(0, 7),
        settings.minSampleSize,
      ),
      monthlyTrend: summarizeByMonth(history, settings.minSampleSize),
      savings: calculateSavings(history, date),
      venueHeatmap: summarizeVenueHeatmap(history),
      segmentStats: {
        byTimeBand: summarizeByTimeBand(history, closeAtByRaceId),
        byRaceNo: summarizeByRaceNo(history),
      },
      programStats: summarizeProgramStats(history, programByRaceId),
      categoryStats: summarizeCategoryStats(history),
      rollingDrift: summarizeRollingDrift(history, settings.minSampleSize),
      modelVersion: getModelVersionInfo(),
      skipReasons: summarizeSkipReasons(history, settings),
      beforeInfoCoverage: buildBeforeInfoCoverage(db, date),
      oddsSnapshotCount,
      oddsSnapshots: [],
    });
  } finally {
    db.close();
  }
});

app.get("/api/candidates", (req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const date = typeof req.query.date === "string" ? req.query.date : todayJst();
    const limitParam = Number(req.query.limit ?? 100);
    const offsetParam = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 300) : 100;
    const offset = Number.isFinite(offsetParam) ? Math.max(Math.trunc(offsetParam), 0) : 0;
    const statuses = typeof req.query.status === "string"
      ? new Set(req.query.status.split(",").map((status) => status.trim().toUpperCase()).filter(Boolean))
      : null;
    const rows = buildRowsForDate(db, settings, date)
      .filter((row) => !statuses || statuses.has(row.decision.status));
    const pageRows = rows.slice(offset, offset + limit);
    res.json({
      date,
      offset,
      limit,
      total: rows.length,
      decisionCounts: candidateCounts(rows),
      rows: explainRows(pageRows, settings),
    });
  } finally {
    db.close();
  }
});

app.get("/api/results", (req, res) => {
  const db = openDb();
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    res.json(listResults(db, date));
  } finally {
    db.close();
  }
});

app.get("/api/history", (_req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const history = listDecisionHistory(db);
    res.json({
      rows: history,
      summary: summarizeHistory(history, settings.minSampleSize),
      backtest: {
        ...summarizeHistory(history, settings.minSampleSize),
        overvaluation: analyzeOvervaluation(history),
      },
    });
  } finally {
    db.close();
  }
});

app.get("/api/backtest/walk-forward", (req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const minTrainRaceCount = req.query.minTrainRaceCount == null
      ? settings.minSampleSize
      : Number(req.query.minTrainRaceCount);
    const alpha = req.query.alpha == null ? 1 : Number(req.query.alpha);
    if (!Number.isFinite(minTrainRaceCount) || minTrainRaceCount < 0) {
      res.status(400).json({ error: "minTrainRaceCount must be zero or positive" });
      return;
    }
    if (!Number.isFinite(alpha) || alpha < 0) {
      res.status(400).json({ error: "alpha must be zero or positive" });
      return;
    }
    const programs = listProgramInputs(db)
      .filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
    const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
    const rows = runWalkForwardBacktest({
      results: listAllResultsForModel(db),
      programs,
      settings,
      oddsByRaceId,
      minTrainRaceCount,
      alpha,
    });
    res.json({
      summary: summarizeWalkForward(rows, settings.stakePerBetYen),
      rows: rows.slice(-300).reverse(),
    });
  } finally {
    db.close();
  }
});

app.get("/api/backtest/model-comparison", (req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const programs = listProgramInputs(db)
      .filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
    const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
    res.json({
      rows: compareModelVariants({
        results: listAllResultsForModel(db),
        programs,
        settings,
        oddsByRaceId,
      }),
    });
  } finally {
    db.close();
  }
});

// B1フィルター条件の共通WHERE句（decision_history=dh, official_programs=op が必要）
// 注意: boats[1].className != 'B1' は旧検証用フィルター。
// 現行 DEFAULT_APP_RULE の excludeSameClassSecondBoat=false とは一致しない。
// Calibration UI の集計範囲であり、live判定ロジックとは別物。
// in-sample(BUY records): current_odds はdecision_historyの列
const B1_FILTER_WHERE = `
  AND json_extract(op.raw_json, '$.boats[0].className') = 'B1'
  AND json_extract(op.raw_json, '$.boats[1].className') != 'B1'
  AND CAST(json_extract(op.raw_json, '$.boats[0].nationalWinRate') AS REAL) >= 4.0
  AND dh.venue NOT IN ('戸田','多摩川','桐生','三国','江戸川')
  AND CAST(substr(dh.race_id, -2) AS INTEGER) NOT IN (11, 12)
  AND dh.required_odds >= 25
  AND dh.current_odds / dh.required_odds < 1.5`;

// external(SKIP records + odds_snapshots JOIN): current_oddsはos.odds
const B1_FILTER_WHERE_EXT = `
  AND json_extract(op.raw_json, '$.boats[0].className') = 'B1'
  AND json_extract(op.raw_json, '$.boats[1].className') != 'B1'
  AND CAST(json_extract(op.raw_json, '$.boats[0].nationalWinRate') AS REAL) >= 4.0
  AND dh.venue NOT IN ('戸田','多摩川','桐生','三国','江戸川')
  AND CAST(substr(dh.race_id, -2) AS INTEGER) NOT IN (11, 12)
  AND dh.required_odds >= 25
  AND os.odds / dh.required_odds < 1.5`;

function buildCalibrationQuery(extraWhere: string): string {
  return `
WITH base AS (
  SELECT
    dh.required_odds,
    dh.estimated_hit_rate,
    dh.current_odds,
    (dh.selection = dh.result) AS hit,
    json_extract(op.raw_json, '$.boats[0].className') AS cls
  FROM decision_history dh
  LEFT JOIN official_programs op ON op.race_id = dh.race_id
  WHERE dh.decision = 'BUY'
    AND dh.returned = 0
    AND dh.selection = '1-2-3'
    AND dh.estimated_hit_rate > 0
    AND dh.date >= ? AND dh.date <= ?
    ${extraWhere}
)
SELECT
  CASE
    WHEN required_odds < 30 THEN '25-30'
    WHEN required_odds < 40 THEN '30-40'
    WHEN required_odds < 50 THEN '40-50'
    WHEN required_odds < 70 THEN '50-70'
    ELSE '>= 70'
  END AS req_band,
  COALESCE(cls, 'unknown') AS cls,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(AVG(estimated_hit_rate) * 100, 2) AS avg_est_pct,
  ROUND(1.0 * SUM(hit) / COUNT(*) * 100, 2) AS actual_pct,
  ROUND((1.0 * SUM(hit) / COUNT(*)) / AVG(estimated_hit_rate), 3) AS calib_ratio,
  ROUND(AVG(current_odds), 1) AS avg_odds,
  ROUND(AVG(required_odds), 1) AS avg_req,
  ROUND(MAX(CASE WHEN hit THEN current_odds ELSE 0 END), 0) AS max_hit_odds
FROM base
GROUP BY req_band, cls
ORDER BY MIN(required_odds), cls`;
}

// 外部期間(2020-2023)はdecision='BUY'が存在しないため、odds_snapshotsで擬似BUYを再現するクエリ
function buildCalibrationQueryExternal(extraWhere: string): string {
  return `
WITH base AS (
  SELECT
    dh.required_odds,
    dh.estimated_hit_rate,
    os.odds AS current_odds,
    (dh.selection = dh.result) AS hit,
    json_extract(op.raw_json, '$.boats[0].className') AS cls
  FROM decision_history dh
  JOIN official_programs op ON op.race_id = dh.race_id
  JOIN odds_snapshots os ON os.race_id = dh.race_id AND os.selection = dh.selection
  WHERE dh.selection = '1-2-3'
    AND dh.estimated_hit_rate > 0
    AND os.odds >= dh.required_odds
    AND dh.date >= ? AND dh.date <= ?
    ${extraWhere}
)
SELECT
  CASE
    WHEN required_odds < 30 THEN '25-30'
    WHEN required_odds < 40 THEN '30-40'
    WHEN required_odds < 50 THEN '40-50'
    WHEN required_odds < 70 THEN '50-70'
    ELSE '>= 70'
  END AS req_band,
  COALESCE(cls, 'unknown') AS cls,
  COUNT(*) AS n,
  SUM(hit) AS hits,
  ROUND(AVG(estimated_hit_rate) * 100, 2) AS avg_est_pct,
  ROUND(1.0 * SUM(hit) / COUNT(*) * 100, 2) AS actual_pct,
  ROUND((1.0 * SUM(hit) / COUNT(*)) / AVG(estimated_hit_rate), 3) AS calib_ratio,
  ROUND(AVG(current_odds), 1) AS avg_odds,
  ROUND(AVG(required_odds), 1) AS avg_req,
  ROUND(MAX(CASE WHEN hit THEN current_odds ELSE 0 END), 0) AS max_hit_odds
FROM base
GROUP BY req_band, cls
ORDER BY MIN(required_odds), cls`;
}

// 外部検証データが存在する期間（kyotei24バックフィル済み）
const EXTERNAL_FROM = "2020-01-01";
const EXTERNAL_TO   = "2023-12-31";
const INSAMPLE_FROM = "2024-01-01";

app.get("/api/backtest/calibration", (req, res) => {
  const db = openDb();
  try {
    // b1filter=1 で現行B1フィルター条件を適用
    const b1filter = req.query.b1filter === "1";
    const extraWhere = b1filter ? B1_FILTER_WHERE : "";

    // mode=compare: external(2020-2023) と insample(2024+) を両方返す
    // mode=custom (デフォルト): from/to で手動指定
    const mode = req.query.mode === "compare" ? "compare" : "custom";

    if (mode === "compare") {
      // 外部期間(2020-2023): SKIP records + odds_snapshots JOIN で擬似BUY再現
      const extExtraWhere = b1filter ? B1_FILTER_WHERE_EXT : "";
      const externalRows = db.prepare(buildCalibrationQueryExternal(extExtraWhere))
        .all(EXTERNAL_FROM, EXTERNAL_TO) as Array<Record<string, unknown>>;
      const insampleRows = db.prepare(buildCalibrationQuery(extraWhere))
        .all(INSAMPLE_FROM, "2099-12-31") as Array<Record<string, unknown>>;

      // 外部検証合算ROI（B1フィルター適用時）
      const externalSummary = b1filter
        ? db.prepare(`
            SELECT
              COUNT(*) AS n,
              ROUND(SUM(CASE WHEN dh.selection = dh.result THEN os.odds ELSE 0 END) * 1.0 / COUNT(*), 3) AS roi,
              SUM(CASE WHEN dh.selection = dh.result THEN 1 ELSE 0 END) AS hits
            FROM decision_history dh
            JOIN official_programs op ON op.race_id = dh.race_id
            JOIN odds_snapshots os ON os.race_id = dh.race_id AND os.selection = dh.selection
            WHERE dh.date >= ? AND dh.date < ?
              AND dh.selection = '1-2-3'
              AND os.odds >= dh.required_odds
              AND json_extract(op.raw_json, '$.boats[0].className') = 'B1'
              AND json_extract(op.raw_json, '$.boats[1].className') != 'B1'
              AND CAST(json_extract(op.raw_json, '$.boats[0].nationalWinRate') AS REAL) >= 4.0
              AND dh.venue NOT IN ('戸田','多摩川','桐生','三国','江戸川')
              AND CAST(substr(dh.race_id, -2) AS INTEGER) NOT IN (11, 12)
              AND dh.required_odds >= 25
              AND os.odds / dh.required_odds < 1.5
          `).get("2020-01-01", "2024-01-01") as Record<string, unknown>
        : null;

      // in-sample の返還BUY件数（監視用）
      const insampleReturnedStats = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(returned) AS returned_count,
          ROUND(100.0 * SUM(returned) / COUNT(*), 2) AS pct
        FROM decision_history
        WHERE decision = 'BUY' AND date >= ?
      `).get(INSAMPLE_FROM) as Record<string, unknown>;

      res.json({
        mode: "compare",
        b1filter,
        external: { from: EXTERNAL_FROM, to: EXTERNAL_TO, rows: externalRows, summary: externalSummary },
        insample: { from: INSAMPLE_FROM, to: "現在", rows: insampleRows },
        insampleReturnedStats: {
          total: insampleReturnedStats.total as number,
          returned: insampleReturnedStats.returned_count as number,
          pct: insampleReturnedStats.pct as number,
        },
      });
    } else {
      const from = typeof req.query.from === "string" ? req.query.from : INSAMPLE_FROM;
      const to   = typeof req.query.to   === "string" ? req.query.to   : "2099-12-31";
      const rows = db.prepare(buildCalibrationQuery(extraWhere))
        .all(from, to) as Array<Record<string, unknown>>;
      res.json({ mode: "custom", from, to, b1filter, rows });
    }
  } finally {
    db.close();
  }
});

// 2026 live B1 監視（現行model_version + date>=2026-01-01、app_settingsがB1フィルターを保証）
const LIVE_FROM = LIVE_MONITOR_FROM;
const LIVE_MODEL = LIVE_MONITOR_MODEL_VERSION;
const PAPER_LIVE_START = "2026-05-27";
const TARGET_BUY_N = 300;

app.get("/api/live/b1-monitor", (_req, res) => {
  const db = openDb();
  try {
    // 全体サマリー
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS n,
        SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
        SUM(returned) AS returned_n,
        ROUND(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 /
          NULLIF(SUM(CASE WHEN returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi,
        MAX(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) AS max_hit_odds,
        ROUND(AVG(required_odds), 2) AS avg_required_odds,
        ROUND(AVG(current_odds), 2) AS avg_current_odds,
        ROUND(AVG(CASE WHEN required_odds > 0 THEN current_odds / required_odds END), 3) AS avg_odds_ratio,
        ROUND(SUM(estimated_hit_rate), 2) AS estimated_hits
      FROM decision_history
      WHERE decision = 'BUY'
        AND date >= ?
        AND model_version = ?
    `).get(LIVE_FROM, LIVE_MODEL) as Record<string, unknown>;

    const n = (summary.n as number) ?? 0;
    const hits = (summary.hits as number) ?? 0;
    const returnedN = (summary.returned_n as number) ?? 0;
    const roi = (summary.roi as number) ?? null;
    const maxHitOdds = (summary.max_hit_odds as number) ?? 0;
    const avgRequiredOdds = (summary.avg_required_odds as number) ?? null;
    const avgCurrentOdds = (summary.avg_current_odds as number) ?? null;
    const avgOddsRatio = (summary.avg_odds_ratio as number) ?? null;
    const estimatedHits = (summary.estimated_hits as number) ?? null;

    // 最大払戻除外ROI
    const effectiveN = n - returnedN;
    const roiExMax = (roi !== null && effectiveN > 0 && maxHitOdds > 0)
      ? Math.round((roi - maxHitOdds / effectiveN) * 1000) / 1000
      : null;

    // マイルストーン判定
    type MilestoneStatus = "insufficient" | "watch" | "conditional" | "near-confirmed";
    let milestoneStatus: MilestoneStatus;
    let milestoneNote: string;
    if (n < 300) {
      milestoneStatus = "insufficient";
      milestoneNote = `n=${n} — データ蓄積中（目安: 300件で一次判定）`;
    } else if (n < 600) {
      milestoneStatus = "watch";
      milestoneNote = `n=${n} — 継続保留ゾーン（300〜600件）。ROI<0.75なら撤退候補`;
    } else if (n < 1000) {
      milestoneStatus = "conditional";
      milestoneNote = `n=${n} — 条件付き採用判定可。ROI>1.2かつ月別・ratio帯別に一発依存でないこと`;
    } else {
      milestoneStatus = "near-confirmed";
      milestoneNote = `n=${n} — 採用確定に近い。最大払戻除外ROI>1.0が条件`;
    }

    // 月別内訳
    const monthly = db.prepare(`
      SELECT
        substr(date, 1, 7) AS ym,
        COUNT(*) AS n,
        SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
        SUM(returned) AS returned_n,
        ROUND(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 /
          NULLIF(SUM(CASE WHEN returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi,
        ROUND(AVG(current_odds), 1) AS avg_odds,
        ROUND(AVG(current_odds / required_odds), 3) AS avg_ratio
      FROM decision_history
      WHERE decision = 'BUY'
        AND date >= ?
        AND model_version = ?
      GROUP BY ym
      ORDER BY ym
    `).all(LIVE_FROM, LIVE_MODEL) as Array<Record<string, unknown>>;

    // 診断情報: 2026年のBUY全件をmodel_version/source別に集計（除外対象の確認用）
    const diagnostics = db.prepare(`
      SELECT
        COALESCE(model_version, '(null)') AS model_version,
        source,
        COUNT(*) AS n,
        MAX(date) AS latest_date
      FROM decision_history
      WHERE decision = 'BUY' AND date >= ?
      GROUP BY model_version, source
      ORDER BY n DESC
    `).all(LIVE_FROM) as Array<Record<string, unknown>>;

    const latestLiveDate = (db.prepare(`
      SELECT MAX(date) AS d FROM decision_history
      WHERE decision = 'BUY' AND date >= ? AND model_version = ?
    `).get(LIVE_FROM, LIVE_MODEL) as { d: string | null }).d;

    const decisionCounts = db.prepare(`
      SELECT decision, COUNT(*) AS n, MAX(date) AS latest_date
      FROM decision_history
      WHERE date >= ? AND model_version = ?
      GROUP BY decision
      ORDER BY decision
    `).all(LIVE_FROM, LIVE_MODEL) as Array<Record<string, unknown>>;

    const latestModelDecisionDate = (db.prepare(`
      SELECT MAX(date) AS d
      FROM decision_history
      WHERE date >= ? AND model_version = ?
    `).get(LIVE_FROM, LIVE_MODEL) as { d: string | null }).d;

    const latestAnyDecisionDate = (db.prepare(`
      SELECT MAX(date) AS d
      FROM decision_history
      WHERE date >= ?
    `).get(LIVE_FROM) as { d: string | null }).d;

    const latestOfficialProgramDate = (db.prepare(`
      SELECT MAX(date) AS d
      FROM official_programs
      WHERE date >= ?
    `).get(LIVE_FROM) as { d: string | null }).d;

    const latestOddsSnapshotDate = (db.prepare(`
      SELECT MAX(substr(captured_at, 1, 10)) AS d
      FROM odds_snapshots
      WHERE substr(captured_at, 1, 10) >= ?
    `).get(LIVE_FROM) as { d: string | null }).d;

    const watchBuyQuality = db.prepare(`
      SELECT
        COUNT(*) AS n,
        SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
        SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
      FROM decision_history
      WHERE date >= ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
    `).get(LIVE_FROM, LIVE_MODEL) as { n: number; odds_missing: number; odds_present: number };

    const paperDays = db.prepare(`
      SELECT
        date,
        SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy_n,
        SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch_n,
        COUNT(*) AS total_n
      FROM decision_history
      WHERE date >= ? AND model_version = ?
      GROUP BY date
      ORDER BY date
    `).all(PAPER_LIVE_START, LIVE_MODEL) as Array<{ date: string; buy_n: number; watch_n: number; total_n: number }>;

    const historicalPace = historicalBuyPace(db);
    const livePace = liveBuyPace(paperDays);
    const eta = buyEta(n, livePace.ratePerDay, historicalPace);
    const alerts = buildLiveAlerts({
      buyN: n,
      paperDays,
      watchBuyN: numberValue(watchBuyQuality.n),
      watchBuyOddsMissing: numberValue(watchBuyQuality.odds_missing),
      latestModelDecisionDate,
      latestOddsSnapshotDate,
    });

    // 除外件数の集計（diagnostics から）
    let excludedOldModelCount = 0;
    let excludedSampleCount = 0;
    const sources: string[] = [];
    for (const row of diagnostics) {
      const mv = row.model_version as string;
      const src = row.source as string;
      const cnt = row.n as number;
      if (mv === LIVE_MODEL) {
        if (!sources.includes(src)) sources.push(src);
      } else if (mv === "(null)") {
        excludedSampleCount += cnt;
      } else {
        excludedOldModelCount += cnt;
      }
    }

    res.json({
      period: {
        from: LIVE_FROM,
        to: "現在",
        modelVersion: LIVE_MODEL,
        filter: liveMonitorFilterText(),
      },
      summary: {
        n, hits, returnedN, roi, maxHitOdds, roiExMax,
        avgRequiredOdds, avgCurrentOdds, avgOddsRatio, estimatedHits,
      },
      milestoneStatus,
      milestoneNote,
      monthly,
      diagnostics,
      latestLiveDate,
      decisionCounts,
      latestModelDecisionDate,
      latestAnyDecisionDate,
      latestOfficialProgramDate,
      latestOddsSnapshotDate,
      excludedOldModelCount,
      excludedSampleCount,
      sources,
      watchBuyQuality: {
        n: numberValue(watchBuyQuality.n),
        oddsMissing: numberValue(watchBuyQuality.odds_missing),
        oddsPresent: numberValue(watchBuyQuality.odds_present),
      },
      paperLive: {
        startDate: PAPER_LIVE_START,
        observedDays: paperDays.length,
        zeroBuyDays: paperDays.filter((row) => numberValue(row.buy_n) === 0).length,
        consecutiveZeroBuyDays: consecutiveZeroBuyDays(paperDays),
        latestDay: paperDays.at(-1) ?? null,
      },
      pace: {
        live: livePace,
        historical: historicalPace,
        eta,
      },
      alerts,
      todayDiagnosis: buildTodayDiagnosis(db, getSettings(db)),
    });
  } finally {
    db.close();
  }
});

type TodayNearMissRow = {
  race_id: string;
  venue: string;
  race_no: number;
  current_odds: number | null;
  required_odds: number | null;
  close_at: string | null;
};

function buildTodayDiagnosis(db: ReturnType<typeof openDb>, settings: BudgetRule) {
  const date = todayJst();
  const now = new Date();
  const countsRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
      SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      SUM(CASE WHEN decision = 'SKIP' AND current_odds IS NOT NULL AND required_odds IS NOT NULL AND current_odds >= required_odds THEN 1 ELSE 0 END) AS skip_at_or_above_required
    FROM decision_history
    WHERE date = ? AND model_version = ?
  `).get(date, LIVE_MODEL) as Record<string, unknown>;

  const nearRows = db.prepare(`
    SELECT
      dh.race_id,
      dh.venue,
      dh.race_no,
      dh.current_odds,
      dh.required_odds,
      op.close_at
    FROM decision_history dh
    LEFT JOIN official_programs op ON op.race_id = dh.race_id
    WHERE dh.date = ?
      AND dh.model_version = ?
      AND dh.decision = 'WATCH'
      AND dh.current_odds IS NOT NULL
      AND dh.required_odds IS NOT NULL
      AND dh.current_odds < dh.required_odds
    ORDER BY dh.required_odds - dh.current_odds ASC, dh.race_id
  `).all(date, LIVE_MODEL) as TodayNearMissRow[];

  const enrichedNearRows = nearRows.map((row) => {
    const currentOdds = nullableNumber(row.current_odds);
    const requiredOdds = nullableNumber(row.required_odds);
    const gap = currentOdds == null || requiredOdds == null ? null : round2(requiredOdds - currentOdds);
    const closeStatus = liveCloseStatus(date, row.close_at, settings, now);
    return {
      raceId: row.race_id,
      venue: row.venue,
      raceNo: row.race_no,
      currentOdds,
      requiredOdds,
      gap,
      closeAt: row.close_at,
      closeStatus,
    };
  });

  let within1_0 = 0;
  let openWithin1_0 = 0;
  let minGap: number | null = null;
  for (const row of enrichedNearRows) {
    if (row.gap != null) {
      minGap = minGap == null ? row.gap : Math.min(minGap, row.gap);
      if (row.gap <= 1) {
        within1_0 += 1;
        if (row.closeStatus !== 'closed') openWithin1_0 += 1;
      }
    }
  }
  const topNearMisses = enrichedNearRows.slice(0, 5);

  const total = numberValue(countsRow.total);
  const oddsPresent = numberValue(countsRow.odds_present);
  const counts = {
    total,
    BUY: numberValue(countsRow.buy),
    WATCH: numberValue(countsRow.watch),
    SKIP: numberValue(countsRow.skip),
  };

  return {
    date,
    counts,
    oddsCoverage: { present: oddsPresent, total, pct: total > 0 ? round2(oddsPresent / total) : null },
    nearMiss: { watchN: counts.WATCH, within1_0, openWithin1_0, minGap },
    topNearMisses,
    skipAtOrAboveRequired: numberValue(countsRow.skip_at_or_above_required),
    action: diagnosisAction(counts, openWithin1_0, within1_0),
  };
}

function liveCloseStatus(date: string, closeAt: string | null, settings: BudgetRule, now: Date) {
  if (!closeAt) return 'no_close_at';
  const minutes = (new Date(`${date}T${closeAt}:00+09:00`).getTime() - now.getTime()) / 60_000;
  if (minutes < 0) return 'closed';
  if (minutes < settings.minMinutesBeforeClose) return 'too_late';
  if (minutes <= ODDS_FETCH_WINDOW_MINUTES) return 'in_window';
  return 'too_early';
}

function diagnosisAction(counts: { BUY: number; WATCH: number }, openWithin1_0: number, within1_0: number) {
  if (counts.BUY > 0) return 'review paper BUY rows';
  if (openWithin1_0 > 0) return 'watch next odds refresh; open near-miss exists';
  if (within1_0 > 0) return 'review closed near-misses; no open near-miss within 1.0 odds';
  if (counts.WATCH > 0) return 'observe; WATCH exists but not near BUY boundary';
  return 'observe; no WATCH/BUY pressure yet';
}

function historicalBuyPace(db: ReturnType<typeof openDb>) {
  const rows = db.prepare(`
    SELECT substr(date, 1, 7) AS ym, COUNT(*) AS n
    FROM decision_history
    WHERE model_version = ?
      AND decision = 'BUY'
      AND date BETWEEN '2024-01-01' AND '2025-12-31'
    GROUP BY ym
    ORDER BY ym
  `).all(LIVE_MODEL) as Array<{ ym: string; n: number }>;

  const counts = rows.map((row) => numberValue(row.n)).filter((count) => count > 0);
  const sorted = [...counts].sort((a, b) => a - b);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const averagePerMonth = counts.length > 0 ? total / counts.length : 0;
  const medianPerMonth =
    sorted.length > 0 ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0;

  return {
    source: "2024-2025 v3 BUY months",
    months: counts.length,
    total,
    averagePerMonth: round1(averagePerMonth),
    medianPerMonth: round1(medianPerMonth),
    minPerMonth: sorted[0] ?? 0,
    maxPerMonth: sorted.at(-1) ?? 0,
  };
}

function liveBuyPace(rows: Array<{ buy_n: number }>) {
  const buyN = rows.reduce((sum, row) => sum + numberValue(row.buy_n), 0);
  return {
    observedDays: rows.length,
    buyN,
    ratePerDay: rows.length > 0 ? round2(buyN / rows.length) : 0,
  };
}

function buyEta(n: number, liveRatePerDay: number, historical: ReturnType<typeof historicalBuyPace>) {
  const remaining = Math.max(0, TARGET_BUY_N - n);
  return {
    targetN: TARGET_BUY_N,
    remaining,
    liveDaysLeft: liveRatePerDay > 0 ? Math.ceil(remaining / liveRatePerDay) : null,
    historicalMedianDaysLeft: daysLeftFromMonthlyPace(remaining, historical.medianPerMonth),
    historicalAverageDaysLeft: daysLeftFromMonthlyPace(remaining, historical.averagePerMonth),
    historicalMinDaysLeft: daysLeftFromMonthlyPace(remaining, historical.minPerMonth),
  };
}

function buildLiveAlerts(input: {
  buyN: number;
  paperDays: Array<{ buy_n: number }>;
  watchBuyN: number;
  watchBuyOddsMissing: number;
  latestModelDecisionDate: string | null;
  latestOddsSnapshotDate: string | null;
}) {
  const alerts: Array<{ level: "info" | "warn" | "critical"; code: string; message: string }> = [];
  const zeroDays = consecutiveZeroBuyDays(input.paperDays);

  if (input.buyN === 0 && zeroDays >= 7) {
    alerts.push({ level: "critical", code: "buy_zero_7d", message: `BUYが${zeroDays}日連続0件です。取得タイミング・BUY条件・保存条件を点検してください。` });
  } else if (input.buyN === 0 && zeroDays >= 3) {
    alerts.push({ level: "warn", code: "buy_zero_3d", message: `BUYが${zeroDays}日連続0件です。数日継続するならライブ条件の厳しさを確認します。` });
  } else if (input.buyN === 0 && input.watchBuyN > 0) {
    alerts.push({ level: "info", code: "watch_present_buy_zero", message: `WATCH/BUY候補は${input.watchBuyN}件ありますがBUYはまだ0件です。初期日は観察継続で十分です。` });
  }

  if (input.watchBuyN > 0 && input.watchBuyOddsMissing > 0) {
    alerts.push({ level: "warn", code: "watch_buy_odds_missing", message: `WATCH/BUY候補のオッズ未取得が${input.watchBuyOddsMissing}件あります。auto-oddsログを確認してください。` });
  }

  if (input.latestModelDecisionDate !== input.latestOddsSnapshotDate) {
    alerts.push({ level: "info", code: "latest_date_mismatch", message: `最新判定日=${input.latestModelDecisionDate ?? "-"}、最新オッズ日=${input.latestOddsSnapshotDate ?? "-"}です。` });
  }

  return alerts;
}

function consecutiveZeroBuyDays(rows: Array<{ buy_n: number }>) {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (numberValue(rows[i].buy_n) === 0) count += 1;
    else break;
  }
  return count;
}

function daysLeftFromMonthlyPace(remaining: number, monthlyPace: number) {
  return monthlyPace > 0 ? Math.ceil(Math.max(0, remaining) / (monthlyPace / 30.4375)) : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

app.put("/api/settings", (req, res) => {
  const db = openDb();
  try {
    const current = getSettings(db);
    const next: BudgetRule = { ...current, ...req.body };
    const invalid = validateBudgetRule(next);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    setSettings(db, next);
    invalidateCandidateCache();
    res.json(next);
  } finally {
    db.close();
  }
});

app.post("/api/import/official-local", (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const sourceFile = String(req.body?.sourceFile ?? "manual-ui");
  const db = openDb();
  try {
    let imported = 0;
    for (const raw of rows) {
      const date = String(raw.date ?? "");
      const venue = String(raw.venue ?? "");
      const raceNo = Number(raw.raceNo);
      const closeAt = String(raw.closeAt ?? "12:00");
      if (!date || !venue || !Number.isFinite(raceNo)) continue;
      const raceId = `${date.replaceAll("-", "")}-${venue}-${String(raceNo).padStart(2, "0")}`;
      insertOfficialProgram(db, { raceId, date, venue, raceNo, closeAt, sourceFile, raw });
      imported += 1;
    }
    if (imported > 0) invalidateCandidateCache();
    res.json({ imported });
  } finally {
    db.close();
  }
});

app.post("/api/import/reparse-kyotei24", async (req, res) => {
  const date = String(req.body?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const { parseSavedKyotei24 } = await import("../scripts/import-kyotei24");
  const result = await parseSavedKyotei24(date);
  invalidateCandidateCache();
  res.json(result);
});

app.put("/api/history/:id/purchase", (req, res) => {
  const actuallyBought = Boolean(req.body?.actuallyBought);
  const stakeYen = Number(req.body?.stakeYen ?? 0);
  const db = openDb();
  try {
    const row = updatePurchaseRecord(db, Number(req.params.id), actuallyBought, stakeYen);
    if (!row) {
      res.status(404).json({ error: "history not found" });
      return;
    }
    res.json(row);
  } finally {
    db.close();
  }
});

app.put("/api/odds/:raceId", (req, res) => {
  const odds = Number(req.body?.odds);
  if (!Number.isFinite(odds) || odds <= 0) {
    res.status(400).json({ error: "odds must be positive number" });
    return;
  }
  const db = openDb();
  try {
    setManualOdds(db, req.params.raceId, odds);
    invalidateCandidateCache();
    res.json({ raceId: req.params.raceId, odds });
  } finally {
    db.close();
  }
});

app.post("/api/odds/fetch", async (req, res) => {
  const requestedIds: string[] | undefined = Array.isArray(req.body?.raceIds)
    ? req.body.raceIds.map(String)
    : undefined;
  const db = openDb();
  try {
    const settings = getSettings(db);
    const now = new Date();
    const oddsByRaceId = mergeOddsMaps(getManualOdds(db), listOddsSnapshots(db));
    const rows = buildCandidateRows(
      settings,
      now,
      oddsByRaceId,
      listProgramInputs(db).map((row) => ({
        date: row.date,
        venue: row.venue,
        raceNo: row.raceNo,
        closeAt: row.closeAt,
        raceCategory: row.raceCategory,
        features: row.features,
      })),
      listAllResultsForModel(db),
      listEarlyOddsSnapshots(db),
      listAllOddsBySelection(db),
    );

    type OddsResult = { raceId: string; odds: number | null; status: string; error?: string };
    const results: OddsResult[] = [];
    let persistedOdds = false;
    for (const row of rows) {
      const { candidate } = row;
      if (requestedIds && !requestedIds.includes(candidate.raceId)) continue;
      if (!isWithinOddsFetchWindow(candidate, settings, now, ODDS_FETCH_WINDOW_MINUTES)) {
        results.push({ raceId: candidate.raceId, odds: null, status: "out-of-window" });
        continue;
      }
      try {
        const fetched = await fetchOfficialOdds({
          date: candidate.date,
          venue: candidate.venue,
          raceNo: candidate.raceNo,
        });
        const odds = parseTrifectaOdds(fetched.html, candidate.selection);
        if (odds == null) {
          results.push({
            raceId: candidate.raceId,
            odds: null,
            status: isTrifectaSelectionUnavailable(fetched.html, candidate.selection)
              ? "odds-unavailable"
              : "parse-failed",
          });
          continue;
        }
        setOdds(db, candidate.raceId, odds, "official", candidate.selection.join("-"));
        persistedOdds = true;
        results.push({
          raceId: candidate.raceId,
          odds,
          status: fetched.cached ? "ok-cached" : "ok",
        });
      } catch (err) {
        results.push({
          raceId: candidate.raceId,
          odds: null,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (persistedOdds) invalidateCandidateCache();
    res.json({ results });
  } finally {
    db.close();
  }
});

app.get("/api/odds/snapshots", (req, res) => {
  const db = openDb();
  try {
    const raceId = typeof req.query.raceId === "string" ? req.query.raceId : undefined;
    res.json({ rows: listOddsSnapshots(db, raceId) });
  } finally {
    db.close();
  }
});

app.post("/api/notifications/:id/send", (req, res) => {
  const db = openDb();
  try {
    const notification = markNotificationSent(db, Number(req.params.id));
    if (!notification) {
      res.status(404).json({ error: "notification not found" });
      return;
    }
    res.json(notification);
  } finally {
    db.close();
  }
});

app.get("/api/export/results.csv", (_req, res) => {
  const db = openDb();
  try {
    sendCsv(res, "results.csv", [
      ["raceId", "date", "venue", "raceNo", "trifecta", "payoutYen", "popularity", "returned", "source", "fetchedAt"],
      ...listResults(db).map((row) => [row.raceId, row.date, row.venue, row.raceNo, row.trifecta ?? "", row.payoutYen ?? "", row.popularity ?? "", row.returned ? 1 : 0, row.source, row.fetchedAt]),
    ]);
  } finally {
    db.close();
  }
});

app.get("/api/export/history.csv", (_req, res) => {
  const db = openDb();
  try {
    sendCsv(res, "history.csv", [
      ["id", "raceId", "date", "venue", "raceNo", "selection", "estimatedHitRate", "rawEstimatedHitRate", "conservativeHitRate", "modelSelectionScore", "requiredOdds", "currentOdds", "ev", "decision", "actuallyBought", "stakeYen", "recommendedStakeYen", "result", "payoutYen"],
      ...listDecisionHistory(db).map((row) => [row.id, row.raceId, row.date, row.venue, row.raceNo, row.selection, row.estimatedHitRate, row.rawEstimatedHitRate ?? "", row.conservativeHitRate ?? "", row.modelSelectionScore ?? "", row.requiredOdds, row.currentOdds ?? "", row.ev ?? "", row.decision, row.actuallyBought ? 1 : 0, row.stakeYen, row.recommendedStakeYen, row.result ?? "", row.payoutYen ?? ""]),
    ]);
  } finally {
    db.close();
  }
});

app.get("/api/export/monthly.csv", (_req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    sendCsv(res, "monthly.csv", [
      ["ym", "decisions", "buy", "hits", "hitRate", "modelStakeYen", "modelPayoutYen", "modelRoi", "noBuyDays"],
      ...summarizeByMonth(listDecisionHistory(db), settings.minSampleSize).map((row) => [row.ym, row.decisions, row.buy, row.hits, row.hitRate, row.modelStakeYen, row.modelPayoutYen, row.modelRoi, row.noBuyDays]),
    ]);
  } finally {
    db.close();
  }
});

app.get("/api/export/odds.csv", (_req, res) => {
  const db = openDb();
  try {
    sendCsv(res, "odds.csv", [
      ["raceId", "selection", "odds", "popularity", "source", "capturedAt", "isFinalLike"],
      ...listOddsSnapshots(db).map((row) => [row.raceId, row.selection, row.odds, row.popularity ?? "", row.source, row.capturedAt, row.isFinalLike ? 1 : 0]),
    ]);
  } finally {
    db.close();
  }
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC ?? null, enabled: PUSH_ENABLED });
});

app.post("/api/push/subscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint ?? "");
  const p256dh = String(req.body?.keys?.p256dh ?? "");
  const auth = String(req.body?.keys?.auth ?? "");
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: "endpoint and keys.p256dh and keys.auth are required" });
    return;
  }
  const db = openDb();
  try {
    upsertPushSubscription(db, { endpoint, p256dh, auth });
    res.json({ ok: true, enabled: PUSH_ENABLED });
  } finally {
    db.close();
  }
});

app.post("/api/push/test", async (_req, res) => {
  if (!PUSH_ENABLED) {
    res.status(503).json({ ok: false, error: "VAPIDキー未設定です。`npm run generate:vapid` で生成して .env.local に保存してください。" });
    return;
  }
  const result = await broadcastPush({
    title: "Boat Pon テスト通知",
    body: "Push通知が正しく届いています。",
    url: "/",
  });
  res.json({ ok: true, ...result });
});

function sendCsv(res: express.Response, filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=\"" + filename + "\"");
  res.send("\ufeff" + csv);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? "\"" + text.replaceAll("\"", "\"\"") + "\"" : text;
}

function todayJst() {
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function addDaysJst(date: string, days: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("sv", { timeZone: "Asia/Tokyo" }).format(d);
}

const port = Number(process.env.BOAT_PON_API_PORT ?? 5174);
app.listen(port, "127.0.0.1", () => {
  console.log(`Boat Pon API listening on http://127.0.0.1:${port}`);
});
