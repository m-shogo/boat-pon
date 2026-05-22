import express from "express";
import { summarizeByMonth, summarizeHistory, summarizeMonth } from "../src/domain/backtest";
import { analyzeOvervaluation } from "../src/domain/analysis";
import {
  createNotificationIfNeeded,
  getManualOdds,
  insertOfficialProgram,
  listAllResultsForModel,
  getSettings,
  insertDecisionHistory,
  listDecisionHistory,
  listNotifications,
  listProgramInputs,
  listResults,
  markNotificationSent,
  openDb,
  setManualOdds,
  setOdds,
  updatePurchaseRecord,
  setSettings,
} from "./db";
import { buildCandidateRows } from "./candidates";
import { fetchOfficialOdds } from "../scripts/fetch-official-odds";
import { parseTrifectaOdds } from "../src/domain/oddsParser";
import { minutesUntil } from "../src/domain/decision";
import type { BudgetRule } from "../src/domain/types";

const ODDS_FETCH_WINDOW_MINUTES = 30;

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

app.get("/api/dashboard", (req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const rows = buildCandidateRows(
      settings,
      new Date(),
      getManualOdds(db),
      listProgramInputs(db, date).map((row) => ({
        date: row.date,
        venue: row.venue,
        raceNo: row.raceNo,
        closeAt: row.closeAt,
      })),
      listAllResultsForModel(db),
    );
    for (const row of rows) {
      insertDecisionHistory(db, row.candidate, row.decision);
      createNotificationIfNeeded(db, row.candidate, row.decision, row.officialUrl);
    }

    const buyRows = rows.filter((row) => row.decision.status === "BUY");
    const history = listDecisionHistory(db);
    res.json({
      settings,
      headline: buyRows.length ? "BUY候補あり" : "全レース見送り",
      headlineSub: buyRows.length
        ? "BUY条件を満たした候補のみ通知対象です。購入前に公式オッズで最終確認してください。"
        : "EV 1.25以上の候補なし。買わない日として成功扱いです。",
      rows,
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
    const rows = buildCandidateRows(
      settings,
      now,
      getManualOdds(db),
      listProgramInputs(db).map((row) => ({
        date: row.date,
        venue: row.venue,
        raceNo: row.raceNo,
        closeAt: row.closeAt,
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
        setOdds(db, candidate.raceId, odds, "official");
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

const port = Number(process.env.BOAT_PON_API_PORT ?? 5174);
app.listen(port, "127.0.0.1", () => {
  console.log(`Boat Pon API listening on http://127.0.0.1:${port}`);
});
