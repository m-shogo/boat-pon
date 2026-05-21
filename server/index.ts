import express from "express";
import { summarizeHistory } from "../src/domain/backtest";
import {
  createNotificationIfNeeded,
  getManualOdds,
  getSettings,
  insertDecisionHistory,
  listDecisionHistory,
  listNotifications,
  listResults,
  markNotificationSent,
  openDb,
  setManualOdds,
  setSettings,
} from "./db";
import { buildCandidateRows } from "./candidates";
import type { BudgetRule } from "../src/domain/types";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/dashboard", (_req, res) => {
  const db = openDb();
  try {
    const settings = getSettings(db);
    const rows = buildCandidateRows(settings, new Date("2026-05-21T15:00:00+09:00"), getManualOdds(db));
    for (const row of rows) {
      insertDecisionHistory(db, row.candidate, row.decision);
      createNotificationIfNeeded(db, row.candidate, row.decision, row.officialUrl);
    }

    const buyRows = rows.filter((row) => row.decision.status === "BUY");
    const history = listDecisionHistory(db) as any;
    res.json({
      settings,
      headline: buyRows.length ? "BUY候補あり" : "全レース見送り",
      headlineSub: buyRows.length
        ? "BUY条件を満たした候補のみ通知対象です。購入前に公式オッズで最終確認してください。"
        : "EV 1.25以上の候補なし。買わない日として成功扱いです。",
      rows,
      results: listResults(db),
      notifications: listNotifications(db),
      backtest: summarizeHistory(history),
    });
  } finally {
    db.close();
  }
});

app.get("/api/results", (_req, res) => {
  const db = openDb();
  try {
    res.json(listResults(db));
  } finally {
    db.close();
  }
});

app.get("/api/history", (_req, res) => {
  const db = openDb();
  try {
    const history = listDecisionHistory(db) as any;
    res.json({ rows: history, summary: summarizeHistory(history) });
  } finally {
    db.close();
  }
});

app.put("/api/settings", (req, res) => {
  const db = openDb();
  try {
    const current = getSettings(db);
    const next: BudgetRule = { ...current, ...req.body };
    setSettings(db, next);
    res.json(next);
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
