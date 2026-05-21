import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_RULE } from "../src/domain/decision";
import type { BetCandidate, BudgetRule, Decision, DecisionStatus, RaceResult } from "../src/domain/types";
import { sampleResults } from "../src/sampleData";

export function openDb() {
  mkdirSync("data", { recursive: true });
  const db = new DatabaseSync("data/boat.sqlite");
  migrate(db);
  seedIfEmpty(db);
  return db;
}

export function migrate(db: DatabaseSync) {
  db.exec(`
CREATE TABLE IF NOT EXISTS race_results (
  race_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  trifecta TEXT,
  payout_yen INTEGER,
  popularity INTEGER,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  estimated_hit_rate REAL NOT NULL,
  required_odds REAL NOT NULL,
  current_odds REAL,
  ev REAL,
  decision TEXT NOT NULL,
  actually_bought INTEGER NOT NULL DEFAULT 0,
  stake_yen INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  payout_yen INTEGER,
  popularity INTEGER,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  recommended_stake_yen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  official_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_log_race_channel_uq
ON notification_log (race_id, channel);

CREATE TABLE IF NOT EXISTS manual_odds (
  race_id TEXT PRIMARY KEY,
  odds REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS official_programs (
  race_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  close_at TEXT NOT NULL,
  source_file TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN recommended_stake_yen INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN sample_size INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Existing databases already have this column.
  }
}

export function getSettings(db: DatabaseSync): BudgetRule {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("budget_rule") as { value: string } | undefined;
  if (!row) return DEFAULT_RULE;
  return { ...DEFAULT_RULE, ...JSON.parse(row.value) };
}

export function setSettings(db: DatabaseSync, settings: BudgetRule) {
  db.prepare(`
INSERT INTO app_settings (key, value, updated_at)
VALUES (?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
`).run("budget_rule", JSON.stringify(settings));
}

export function insertResult(db: DatabaseSync, result: RaceResult) {
  db.prepare(`
INSERT OR REPLACE INTO race_results
(race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    result.raceId,
    result.date,
    result.venue,
    result.raceNo,
    result.trifecta,
    result.payoutYen,
    result.popularity,
    result.returned ? 1 : 0,
    result.source,
    result.fetchedAt,
  );
}

export function getManualOdds(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare("SELECT race_id, odds FROM manual_odds").all() as Array<{ race_id: string; odds: number }>;
  return new Map(rows.map((row) => [row.race_id, Number(row.odds)]));
}

export function setManualOdds(db: DatabaseSync, raceId: string, odds: number) {
  setOdds(db, raceId, odds, "manual");
}

export function setOdds(db: DatabaseSync, raceId: string, odds: number, source: string) {
  db.prepare(`
INSERT INTO manual_odds (race_id, odds, source, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(race_id) DO UPDATE SET odds = excluded.odds, source = excluded.source, updated_at = CURRENT_TIMESTAMP
`).run(raceId, odds, source);
}

export function listResults(db: DatabaseSync, date?: string): RaceResult[] {
  const params: string[] = [];
  const where = date ? "WHERE date = ?" : "";
  if (date) params.push(date);
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at
FROM race_results
${where}
ORDER BY date DESC, venue ASC, race_no ASC
LIMIT 120
`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToResult);
}

export function listAllResultsForModel(db: DatabaseSync): RaceResult[] {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at
FROM race_results
ORDER BY date DESC, venue ASC, race_no ASC
`).all() as Array<Record<string, unknown>>;
  return rows.map(rowToResult);
}

export function listProgramInputs(db: DatabaseSync, date?: string) {
  const params: string[] = [];
  const where = date ? "WHERE date = ?" : "";
  if (date) params.push(date);
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at
FROM official_programs
${where}
ORDER BY date DESC, venue ASC, race_no ASC
`).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    closeAt: String(row.close_at),
  }));
}

export function insertOfficialProgram(db: DatabaseSync, row: {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  sourceFile: string;
  raw: Record<string, unknown>;
}) {
  db.prepare(`
INSERT OR REPLACE INTO official_programs
(race_id, date, venue, race_no, close_at, source_file, raw_json, imported_at)
VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`).run(row.raceId, row.date, row.venue, row.raceNo, row.closeAt, row.sourceFile, JSON.stringify(row.raw));
}



export function insertDecisionHistory(db: DatabaseSync, candidate: BetCandidate, decision: Decision) {
  const selection = candidate.selection.join("-");
  const existing = db.prepare("SELECT id FROM decision_history WHERE race_id = ? AND selection = ?").get(
    candidate.raceId,
    selection,
  ) as { id: number } | undefined;

  const result = db.prepare("SELECT trifecta, payout_yen, popularity, returned FROM race_results WHERE race_id = ?").get(candidate.raceId) as
    | { trifecta: string | null; payout_yen: number | null; popularity: number | null; returned: number }
    | undefined;

  if (existing) {
    db.prepare(`
UPDATE decision_history
SET estimated_hit_rate = ?, required_odds = ?, current_odds = ?, ev = ?, decision = ?,
    result = ?, payout_yen = ?, popularity = ?, returned = ?, source = ?, fetched_at = ?,
    recommended_stake_yen = ?, sample_size = ?
WHERE id = ?
`).run(
      candidate.estimatedHitRate,
      decision.requiredOdds,
      candidate.currentOdds,
      decision.ev,
      decision.status,
      result?.trifecta ?? null,
      result?.payout_yen ?? null,
      result?.popularity ?? null,
      result?.returned ? 1 : 0,
      candidate.source,
      candidate.fetchedAt,
      decision.recommendedAmount,
      candidate.sampleSize,
      existing.id,
    );
    return;
  }

  db.prepare(`
INSERT INTO decision_history
(race_id, date, venue, race_no, bet_type, selection, estimated_hit_rate, required_odds, current_odds, ev, decision,
 actually_bought, stake_yen, result, payout_yen, popularity, returned, source, fetched_at, recommended_stake_yen, sample_size)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    candidate.raceId,
    candidate.date,
    candidate.venue,
    candidate.raceNo,
    candidate.betType,
    selection,
    candidate.estimatedHitRate,
    decision.requiredOdds,
    candidate.currentOdds,
    decision.ev,
    decision.status,
    0,
    0,
    result?.trifecta ?? null,
    result?.payout_yen ?? null,
    result?.popularity ?? null,
    result?.returned ? 1 : 0,
    candidate.source,
    candidate.fetchedAt,
    decision.recommendedAmount,
    candidate.sampleSize,
  );
}

export function listDecisionHistory(db: DatabaseSync): import("../src/domain/backtest").DecisionHistoryRow[] {
  const rows = db.prepare(`
SELECT id, race_id, date, venue, race_no, selection, estimated_hit_rate, required_odds, current_odds,
       ev, decision, actually_bought, stake_yen, result, payout_yen, popularity, returned,
       source, fetched_at, recommended_stake_yen, sample_size, created_at
FROM decision_history
ORDER BY created_at DESC, id DESC
LIMIT 500
`).all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: Number(row.id),
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    selection: String(row.selection),
    estimatedHitRate: Number(row.estimated_hit_rate),
    requiredOdds: Number(row.required_odds),
    currentOdds: row.current_odds == null ? null : Number(row.current_odds),
    ev: row.ev == null ? null : Number(row.ev),
    decision: String(row.decision) as DecisionStatus,
    actuallyBought: Boolean(row.actually_bought),
    stakeYen: Number(row.stake_yen),
    recommendedStakeYen: Number(row.recommended_stake_yen ?? 0),
    sampleSize: Number(row.sample_size ?? 0),
    result: row.result == null ? null : String(row.result),
    payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
    popularity: row.popularity == null ? null : Number(row.popularity),
    returned: Boolean(row.returned),
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
    createdAt: String(row.created_at),
  }));
}

export function createNotificationIfNeeded(db: DatabaseSync, candidate: BetCandidate, decision: Decision, officialUrl: string) {
  if (decision.status !== "BUY") return;
  const title = `BUY候補あり: ${candidate.venue} ${candidate.raceNo}R`;
  const body = [
    `買い目: ${candidate.selection.join("-")}`,
    `推定的中率: ${(candidate.estimatedHitRate * 100).toFixed(1)}%`,
    `必要オッズ: ${decision.requiredOdds.toFixed(1)}倍以上`,
    `取得オッズ: ${candidate.currentOdds?.toFixed(1) ?? "未取得"}倍`,
    `EV: ${decision.ev?.toFixed(2) ?? "-"}`,
    `推奨: ${decision.recommendedAmount}円のみ`,
    "購入前に公式オッズで最終確認してください。",
  ].join("\n");

  db.prepare(`
INSERT OR IGNORE INTO notification_log
(race_id, channel, status, title, body, official_url)
VALUES (?, ?, ?, ?, ?, ?)
`).run(candidate.raceId, "browser", "PENDING", title, body, officialUrl);
}

export function listNotifications(db: DatabaseSync) {
  const rows = db.prepare(`
SELECT id, race_id, channel, status, title, body, official_url, created_at, sent_at
FROM notification_log
ORDER BY created_at DESC, id DESC
LIMIT 50
`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    raceId: String(row.race_id),
    channel: row.channel,
    status: row.status,
    title: String(row.title),
    body: String(row.body),
    officialUrl: String(row.official_url),
    createdAt: String(row.created_at),
    sentAt: row.sent_at == null ? null : String(row.sent_at),
  }));
}

export function updatePurchaseRecord(db: DatabaseSync, id: number, actuallyBought: boolean, stakeYen: number) {
  db.prepare("UPDATE decision_history SET actually_bought = ?, stake_yen = ? WHERE id = ?").run(
    actuallyBought ? 1 : 0,
    actuallyBought ? stakeYen : 0,
    id,
  );
  return listDecisionHistory(db).find((row) => row.id === id);
}

export function markNotificationSent(db: DatabaseSync, id: number) {
  db.prepare("UPDATE notification_log SET status = 'SENT', sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  return listNotifications(db).find((notification) => notification.id === id);
}

function seedIfEmpty(db: DatabaseSync) {
  const resultCount = db.prepare("SELECT COUNT(*) AS c FROM race_results").get() as { c: number };
  if (resultCount.c === 0) {
    for (const result of sampleResults) insertResult(db, result);
  }
}

function rowToResult(row: Record<string, unknown>): RaceResult {
  return {
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
  };
}
