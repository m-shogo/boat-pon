import express from "express";
import { summarizeByMonth, summarizeHistory, summarizeMonth } from "../src/domain/backtest";
import { calculateSavings } from "../src/domain/savings";
import { summarizeVenueHeatmap } from "../src/domain/venueHeatmap";
import { summarizeByRaceNo, summarizeByTimeBand } from "../src/domain/segmentStats";
import { summarizeProgramStats } from "../src/domain/programStats";
import { summarizeCategoryStats } from "../src/domain/categoryStats";
import { summarizeRollingDrift } from "../src/domain/rollingDrift";
import { getModelVersionInfo } from "../src/domain/modelVersion";
import { analyzeOvervaluation } from "../src/domain/analysis";
import { explainDecision, summarizeSkipReasons } from "../src/domain/decisionExplain";
import { runWalkForwardBacktest, summarizeWalkForward } from "../src/domain/walkForward";
import { compareModelVariants } from "../src/domain/modelComparison";
import { mergeOddsMaps } from "../src/domain/oddsSnapshot";
import {
  createNotificationIfNeeded,
  deletePushSubscription,
  getDataCoverage,
  getManualOdds,
  insertOfficialProgram,
  listOddsSnapshots,
  listAllResultsForModel,
  getSettings,
  insertDecisionHistory,
  listDecisionHistory,
  listNotifications,
  listOfficialProgramsRaw,
  listProgramInputs,
  listPushSubscriptions,
  listResults,
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
import { parseTrifectaOdds } from "../src/domain/oddsParser";
import { minutesUntil } from "../src/domain/decision";
import type { BudgetRule } from "../src/domain/types";

const ODDS_FETCH_WINDOW_MINUTES = 30;

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
    if (!Number.isFinite(value) || value <= 0) return `${key} must be positive`;
  }
  if (settings.stakePerBetYen > settings.maxStakePerRaceYen) return "stakePerBetYen must be <= maxStakePerRaceYen";
  if (settings.maxStakePerRaceYen > settings.dailyBudgetYen) return "maxStakePerRaceYen must be <= dailyBudgetYen";
  return null;
}

const app = express();
app.use(express.json());

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
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
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
      listAllResultsForModel(db),
    );
    const freshPushPayloads: Array<{ title: string; body: string; url: string }> = [];
    for (const row of rows) {
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

    const explainedRows = rows.map((row) => ({
      ...row,
      explanation: explainDecision(row.candidate, row.decision, settings),
    }));
    const buyRows = rows.filter((row) => row.decision.status === "BUY");
    const history = listDecisionHistory(db);
    const rawPrograms = listOfficialProgramsRaw(db);
    const closeAtByRaceId = new Map(rawPrograms.map((row) => [row.raceId, row.closeAt]));
    const programByRaceId = new Map(rawPrograms.map((row) => [row.raceId, row.raw]));
    res.json({
      settings,
      headline: buyRows.length ? "BUY候補あり" : "全レース見送り",
      headlineSub: buyRows.length
        ? "BUY条件を満たした候補のみ通知対象です。購入前に公式オッズで最終確認してください。"
        : "EV 1.25以上の候補なし。買わない日として成功扱いです。",
      rows: explainedRows,
      date: date ?? null,
      results: listResults(db, date),
      notifications: listNotifications(db),
      history,
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
      oddsSnapshots: listOddsSnapshots(db),
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
    res.json({ rows: history, summary: summarizeHistory(history, settings.minSampleSize) });
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
    );

    type OddsResult = { raceId: string; odds: number | null; status: string; error?: string };
    const results: OddsResult[] = [];
    for (const row of rows) {
      const { candidate } = row;
      if (requestedIds && !requestedIds.includes(candidate.raceId)) continue;
      const minutes = minutesUntil(candidate.closeAt, now);
      if (minutes < settings.minMinutesBeforeClose || minutes > ODDS_FETCH_WINDOW_MINUTES) {
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
          results.push({ raceId: candidate.raceId, odds: null, status: "parse-failed" });
          continue;
        }
        setOdds(db, candidate.raceId, odds, "official", candidate.selection.join("-"));
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
      ["id", "raceId", "date", "venue", "raceNo", "selection", "estimatedHitRate", "requiredOdds", "currentOdds", "ev", "decision", "actuallyBought", "stakeYen", "recommendedStakeYen", "result", "payoutYen"],
      ...listDecisionHistory(db).map((row) => [row.id, row.raceId, row.date, row.venue, row.raceNo, row.selection, row.estimatedHitRate, row.requiredOdds, row.currentOdds ?? "", row.ev ?? "", row.decision, row.actuallyBought ? 1 : 0, row.stakeYen, row.recommendedStakeYen, row.result ?? "", row.payoutYen ?? ""]),
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
const port = Number(process.env.BOAT_PON_API_PORT ?? 5174);
app.listen(port, "127.0.0.1", () => {
  console.log(`Boat Pon API listening on http://127.0.0.1:${port}`);
});
