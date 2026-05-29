import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_APP_RULE } from "../src/domain/decision";
import { extractProgramFeatures } from "../src/domain/programFeatures";
import type { OddsSnapshot } from "../src/domain/oddsSnapshot";
import type { RaceCategory } from "../src/domain/programCategory";
import type { BetCandidate, BudgetRule, Decision, DecisionStatus, RaceResult } from "../src/domain/types";
import { sampleResults } from "../src/sampleData";

export function openDb() {
  mkdirSync("data", { recursive: true });
  const db = new DatabaseSync("data/boat.sqlite");
  // ロック競合時に最大30秒待つ。並列書き込み時の "database is locked" を回避
  db.exec("PRAGMA busy_timeout = 30000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
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
  raw_estimated_hit_rate REAL,
  conservative_hit_rate REAL,
  model_selection_score REAL,
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

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  selection TEXT NOT NULL,
  odds REAL NOT NULL,
  popularity INTEGER,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_final_like INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exhibition_data (
  race_id TEXT NOT NULL,
  course INTEGER NOT NULL,
  exhibition_time REAL,
  start_timing REAL,
  ranking INTEGER,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (race_id, course)
);

CREATE TABLE IF NOT EXISTS racer_course_stats (
  registration_no TEXT NOT NULL,
  course INTEGER NOT NULL,
  races INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  win_rate REAL,
  entry_rate REAL,
  top3_rate REAL,
  avg_st REAL,
  start_order REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (registration_no, course)
);

CREATE TABLE IF NOT EXISTS racer_profiles (
  registration_no TEXT PRIMARY KEY,
  flying_count INTEGER,
  late_start_count INTEGER,
  top3_rate REAL,
  avg_st REAL,
  ability_index INTEGER,
  fetched_at TEXT NOT NULL
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
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN model_version TEXT");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN race_category TEXT");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN raw_estimated_hit_rate REAL");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN conservative_hit_rate REAL");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN model_selection_score REAL");
  } catch {
    // Existing databases already have this column.
  }

  // 検索性能向上のためのINDEX（冪等）
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_race_results_date ON race_results (date);
CREATE INDEX IF NOT EXISTS idx_race_results_venue ON race_results (venue);
CREATE INDEX IF NOT EXISTS idx_race_results_venue_date ON race_results (venue, date);
CREATE INDEX IF NOT EXISTS idx_official_programs_date ON official_programs (date);
CREATE INDEX IF NOT EXISTS idx_official_programs_venue ON official_programs (venue);
CREATE INDEX IF NOT EXISTS idx_decision_history_date ON decision_history (date);
CREATE INDEX IF NOT EXISTS idx_decision_history_venue ON decision_history (venue);
CREATE INDEX IF NOT EXISTS idx_decision_history_decision ON decision_history (decision);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_race ON odds_snapshots (race_id, captured_at);
`);

  // venue表記揺れの正規化（旧「琵琶湖」→新「びわこ」）。冪等。race_idも更新する。
  try {
    db.exec(`
UPDATE race_results
SET venue='びわこ', race_id=REPLACE(race_id, '-琵琶湖-', '-びわこ-')
WHERE venue='琵琶湖';
UPDATE decision_history
SET venue='びわこ', race_id=REPLACE(race_id, '-琵琶湖-', '-びわこ-')
WHERE venue='琵琶湖';
UPDATE official_programs
SET venue='びわこ', race_id=REPLACE(race_id, '-琵琶湖-', '-びわこ-')
WHERE venue='琵琶湖';
`);
  } catch {
    // UNIQUE衝突時は手動で要対処（ここでは握りつぶす）。
  }

  try {
    db.exec("ALTER TABLE racer_course_stats ADD COLUMN avg_st REAL");
  } catch { /* Already exists. */ }
  try {
    db.exec("ALTER TABLE racer_course_stats ADD COLUMN entry_rate REAL");
  } catch { /* Already exists. */ }
  try {
    db.exec("ALTER TABLE racer_course_stats ADD COLUMN top3_rate REAL");
  } catch { /* Already exists. */ }
  try {
    db.exec("ALTER TABLE racer_course_stats ADD COLUMN start_order REAL");
  } catch { /* Already exists. */ }
}

export function getSettings(db: DatabaseSync): BudgetRule {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("budget_rule") as { value: string } | undefined;
  if (!row) return DEFAULT_APP_RULE;
  return { ...DEFAULT_APP_RULE, ...JSON.parse(row.value) };
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

export function setOdds(db: DatabaseSync, raceId: string, odds: number, source: string, selection = "") {
  db.prepare(`
INSERT INTO manual_odds (race_id, odds, source, updated_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(race_id) DO UPDATE SET odds = excluded.odds, source = excluded.source, updated_at = CURRENT_TIMESTAMP
`).run(raceId, odds, source);
  recordOddsSnapshot(db, {
    raceId,
    selection,
    odds,
    popularity: null,
    source: source === "official" || source === "kyotei24" || source === "import" ? source : "manual",
    capturedAt: new Date().toISOString(),
    isFinalLike: source !== "manual",
  });
}

export function recordOddsSnapshot(db: DatabaseSync, snapshot: OddsSnapshot) {
  // 同一(race_id, selection, source)の既存行を削除してから挿入（重複防止）
  db.prepare(`
DELETE FROM odds_snapshots WHERE race_id = ? AND selection = ? AND source = ?
`).run(snapshot.raceId, snapshot.selection, snapshot.source);
  db.prepare(`
INSERT INTO odds_snapshots (race_id, selection, odds, popularity, source, captured_at, is_final_like)
VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
    snapshot.raceId,
    snapshot.selection,
    snapshot.odds,
    snapshot.popularity,
    snapshot.source,
    snapshot.capturedAt,
    snapshot.isFinalLike ? 1 : 0,
  );
}

export function hasEarlyOddsSnapshot(db: DatabaseSync, raceId: string, selection: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM odds_snapshots WHERE race_id = ? AND selection = ? AND source = 'official-early'",
  ).get(raceId, selection);
  return row != null;
}

export function listAllOddsBySelection(db: DatabaseSync): Map<string, number> {
  // 各(race_id, selection)の最新オッズを取得（source問わず最新行）
  const rows = db.prepare(`
SELECT race_id, selection, odds
FROM odds_snapshots
WHERE id IN (
  SELECT MAX(id) FROM odds_snapshots GROUP BY race_id, selection
)
`).all() as Array<{ race_id: string; selection: string; odds: number }>;
  return new Map(rows.map((row) => [`${row.race_id}/${row.selection}`, Number(row.odds)]));
}

export function listEarlyOddsSnapshots(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(
    "SELECT race_id, selection, odds FROM odds_snapshots WHERE source = 'official-early'",
  ).all() as Array<{ race_id: string; selection: string; odds: number }>;
  return new Map(rows.map((row) => [`${row.race_id}/${row.selection}`, Number(row.odds)]));
}

export function listOddsSnapshots(db: DatabaseSync, raceId?: string): OddsSnapshot[] {
  const rows = raceId
    ? db.prepare(`
SELECT race_id, selection, odds, popularity, source, captured_at, is_final_like
FROM odds_snapshots
WHERE race_id = ?
ORDER BY captured_at DESC, id DESC
LIMIT 200
`).all(raceId)
    : db.prepare(`
SELECT race_id, selection, odds, popularity, source, captured_at, is_final_like
FROM odds_snapshots
WHERE id IN (
  SELECT MAX(id) FROM odds_snapshots GROUP BY race_id, selection
)
ORDER BY captured_at DESC, id DESC
`).all();
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    raceId: String(row.race_id),
    selection: String(row.selection),
    odds: Number(row.odds),
    popularity: row.popularity == null ? null : Number(row.popularity),
    source: String(row.source) as OddsSnapshot["source"],
    capturedAt: String(row.captured_at),
    isFinalLike: Boolean(row.is_final_like),
  }));
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

export function listResultsForModelRange(db: DatabaseSync, from: string, to: string): RaceResult[] {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, trifecta, payout_yen, popularity, returned, source, fetched_at
FROM race_results
WHERE date >= ? AND date <= ?
ORDER BY date DESC, venue ASC, race_no ASC
`).all(from, to) as Array<Record<string, unknown>>;
  return rows.map(rowToResult);
}

export function listOfficialProgramsRaw(db: DatabaseSync, date?: string) {
  const params: string[] = [];
  const where = date ? "WHERE date = ?" : "";
  if (date) params.push(date);
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at, raw_json
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
    raw: JSON.parse(String(row.raw_json)) as Record<string, unknown>,
  }));
}

export function listProgramInputs(db: DatabaseSync, date?: string) {
  const params: string[] = [];
  const where = date ? "WHERE date = ?" : "";
  if (date) params.push(date);
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at, raw_json
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
    raceCategory: parseRaceCategory(row.raw_json),
    features: extractProgramFeatures(parseRawJson(row.raw_json)),
  }));
}

export function listProgramInputsRange(db: DatabaseSync, from: string, to: string, limit: number) {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at, raw_json
FROM official_programs
WHERE date >= ? AND date <= ?
ORDER BY date ASC, venue ASC, race_no ASC
LIMIT ?
`).all(from, to, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    closeAt: String(row.close_at),
    raceCategory: parseRaceCategory(row.raw_json),
    features: extractProgramFeatures(parseRawJson(row.raw_json)),
  }));
}

export function listProgramInputsWithOddsSnapshotsRange(db: DatabaseSync, from: string, to: string, limit: number) {
  const rows = db.prepare(`
SELECT p.race_id, p.date, p.venue, p.race_no, p.close_at, p.raw_json
FROM official_programs p
WHERE p.date >= ? AND p.date <= ?
  AND EXISTS (
    SELECT 1 FROM odds_snapshots os WHERE os.race_id = p.race_id
  )
ORDER BY p.date ASC, p.venue ASC, p.race_no ASC
LIMIT ?
`).all(from, to, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    raceId: String(row.race_id),
    date: String(row.date),
    venue: String(row.venue),
    raceNo: Number(row.race_no),
    closeAt: String(row.close_at),
    raceCategory: parseRaceCategory(row.raw_json),
    features: extractProgramFeatures(parseRawJson(row.raw_json)),
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



export function insertDecisionHistory(db: DatabaseSync, candidate: BetCandidate, decision: Decision, options: { replaceRace?: boolean } = {}) {
  const selection = candidate.selection.join("-");
  const existingBySelection = db.prepare("SELECT id FROM decision_history WHERE race_id = ? AND selection = ?").get(
    candidate.raceId,
    selection,
  ) as { id: number } | undefined;
  const existing = existingBySelection ?? (options.replaceRace
    ? db.prepare("SELECT id FROM decision_history WHERE race_id = ? ORDER BY id DESC LIMIT 1").get(candidate.raceId) as { id: number } | undefined
    : undefined);

  const result = db.prepare("SELECT trifecta, payout_yen, popularity, returned FROM race_results WHERE race_id = ?").get(candidate.raceId) as
    | { trifecta: string | null; payout_yen: number | null; popularity: number | null; returned: number }
    | undefined;

  if (existing) {
    db.prepare(`
UPDATE decision_history
SET selection = ?, estimated_hit_rate = ?, raw_estimated_hit_rate = ?, conservative_hit_rate = ?, model_selection_score = ?,
    required_odds = ?, current_odds = ?, ev = ?, decision = ?,
    result = ?, payout_yen = ?, popularity = ?, returned = ?, source = ?, fetched_at = ?,
    recommended_stake_yen = ?, sample_size = ?, model_version = ?, race_category = ?
WHERE id = ?
`).run(
      selection,
      candidate.estimatedHitRate,
      candidate.rawEstimatedHitRate ?? null,
      candidate.conservativeHitRate ?? null,
      candidate.modelSelectionScore ?? null,
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
      candidate.modelVersion ?? null,
      candidate.raceCategory ?? null,
      existing.id,
    );
    if (options.replaceRace) {
      if (!existingBySelection) {
        db.prepare("UPDATE decision_history SET actually_bought = 0, stake_yen = 0 WHERE id = ?").run(existing.id);
      }
      db.prepare("DELETE FROM decision_history WHERE race_id = ? AND id <> ?").run(candidate.raceId, existing.id);
    }
    return;
  }

  db.prepare(`
INSERT INTO decision_history
(race_id, date, venue, race_no, bet_type, selection, estimated_hit_rate, raw_estimated_hit_rate, conservative_hit_rate,
 model_selection_score, required_odds, current_odds, ev, decision,
 actually_bought, stake_yen, result, payout_yen, popularity, returned, source, fetched_at, recommended_stake_yen, sample_size,
 model_version, race_category)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    candidate.raceId,
    candidate.date,
    candidate.venue,
    candidate.raceNo,
    candidate.betType,
    selection,
    candidate.estimatedHitRate,
    candidate.rawEstimatedHitRate ?? null,
    candidate.conservativeHitRate ?? null,
    candidate.modelSelectionScore ?? null,
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
    candidate.modelVersion ?? null,
    candidate.raceCategory ?? null,
  );
}

export function listDecisionHistory(db: DatabaseSync): import("../src/domain/backtest").DecisionHistoryRow[] {
  const rows = db.prepare(`
SELECT id, race_id, date, venue, race_no, selection, estimated_hit_rate, required_odds, current_odds,
       raw_estimated_hit_rate, conservative_hit_rate, model_selection_score,
       ev, decision, actually_bought, stake_yen, result, payout_yen, popularity, returned,
       source, fetched_at, recommended_stake_yen, sample_size, model_version, race_category, created_at
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
    rawEstimatedHitRate: row.raw_estimated_hit_rate == null ? null : Number(row.raw_estimated_hit_rate),
    conservativeHitRate: row.conservative_hit_rate == null ? null : Number(row.conservative_hit_rate),
    modelSelectionScore: row.model_selection_score == null ? null : Number(row.model_selection_score),
    requiredOdds: Number(row.required_odds),
    currentOdds: row.current_odds == null ? null : Number(row.current_odds),
    ev: row.ev == null ? null : Number(row.ev),
    decision: String(row.decision) as DecisionStatus,
    actuallyBought: Boolean(row.actually_bought),
    stakeYen: Number(row.stake_yen),
    recommendedStakeYen: Number(row.recommended_stake_yen ?? 0),
    sampleSize: Number(row.sample_size ?? 0),
    modelVersion: row.model_version == null ? null : String(row.model_version),
    raceCategory: row.race_category == null ? null : String(row.race_category),
    result: row.result == null ? null : String(row.result),
    payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
    popularity: row.popularity == null ? null : Number(row.popularity),
    returned: Boolean(row.returned),
    source: String(row.source),
    fetchedAt: String(row.fetched_at),
    createdAt: String(row.created_at),
  }));
}

export function createNotificationIfNeeded(
  db: DatabaseSync,
  candidate: BetCandidate,
  decision: Decision,
  officialUrl: string,
): { created: boolean; title: string; body: string } | null {
  if (decision.status !== "BUY") return null;
  const title = `[paper] BUY候補: ${candidate.venue} ${candidate.raceNo}R`;
  const body = [
    `買い目: ${candidate.selection.join("-")}`,
    `判定的中率: ${(candidate.estimatedHitRate * 100).toFixed(1)}%`,
    candidate.rawEstimatedHitRate != null
      ? `保守化前推定: ${(candidate.rawEstimatedHitRate * 100).toFixed(1)}%`
      : null,
    `必要オッズ: ${decision.requiredOdds.toFixed(1)}倍以上`,
    `取得オッズ: ${candidate.currentOdds?.toFixed(1) ?? "未取得"}倍`,
    `EV: ${decision.ev?.toFixed(2) ?? "-"}`,
    "【paper観察モード】実購入なし。live ROI確認まで購入しない。",
  ].filter((row): row is string => row != null).join("\n");

  const result = db.prepare(`
INSERT OR IGNORE INTO notification_log
(race_id, channel, status, title, body, official_url)
VALUES (?, ?, ?, ?, ?, ?)
`).run(candidate.raceId, "browser", "PENDING", title, body, officialUrl);

  return { created: result.changes > 0, title, body };
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

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
};

export function upsertPushSubscription(db: DatabaseSync, sub: { endpoint: string; p256dh: string; auth: string }) {
  db.prepare(`
INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
VALUES (?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
`).run(sub.endpoint, sub.p256dh, sub.auth);
}

export function listPushSubscriptions(db: DatabaseSync): PushSubscriptionRecord[] {
  const rows = db.prepare(`SELECT endpoint, p256dh, auth, created_at FROM push_subscriptions`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    createdAt: String(row.created_at),
  }));
}

export function deletePushSubscription(db: DatabaseSync, endpoint: string) {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export type DataCoverage = {
  results: { count: number; days: number; minDate: string | null; maxDate: string | null };
  programs: { count: number; days: number; minDate: string | null; maxDate: string | null };
};

export function getDataCoverage(db: DatabaseSync): DataCoverage {
  const r = db.prepare(`
    SELECT COUNT(*) AS count, COUNT(DISTINCT date) AS days, MIN(date) AS minDate, MAX(date) AS maxDate
    FROM race_results WHERE source='official'
  `).get() as { count: number; days: number; minDate: string | null; maxDate: string | null };
  const p = db.prepare(`
    SELECT COUNT(*) AS count, COUNT(DISTINCT date) AS days, MIN(date) AS minDate, MAX(date) AS maxDate
    FROM official_programs
  `).get() as { count: number; days: number; minDate: string | null; maxDate: string | null };
  return { results: r, programs: p };
}

function seedIfEmpty(db: DatabaseSync) {
  const resultCount = db.prepare("SELECT COUNT(*) AS c FROM race_results").get() as { c: number };
  if (resultCount.c === 0) {
    for (const result of sampleResults) insertResult(db, result);
  }
}

function parseRaceCategory(rawJson: unknown): RaceCategory | undefined {
  const parsed = parseRawJson(rawJson) as { category?: { primary?: unknown } } | null;
  if (!parsed) return undefined;
  return typeof parsed.category?.primary === "string" ? parsed.category.primary as RaceCategory : undefined;
}

function parseRawJson(rawJson: unknown): unknown {
  try {
    return rawJson == null ? null : JSON.parse(String(rawJson));
  } catch {
    return null;
  }
}

export type ExhibitionEntry = {
  course: number;
  exhibitionTime: number | null;
  startTiming: number | null;
  ranking: number | null;
};

export function upsertExhibitionData(db: DatabaseSync, raceId: string, entries: ExhibitionEntry[], fetchedAt: string): void {
  for (const entry of entries) {
    db.prepare(`
INSERT INTO exhibition_data (race_id, course, exhibition_time, start_timing, ranking, fetched_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id, course) DO UPDATE SET
  exhibition_time = excluded.exhibition_time,
  start_timing = excluded.start_timing,
  ranking = excluded.ranking,
  fetched_at = excluded.fetched_at
`).run(raceId, entry.course, entry.exhibitionTime, entry.startTiming, entry.ranking, fetchedAt);
  }
}

export function getExhibitionData(db: DatabaseSync, raceId: string): ExhibitionEntry[] {
  const rows = db.prepare(`
SELECT course, exhibition_time, start_timing, ranking
FROM exhibition_data
WHERE race_id = ?
ORDER BY course
`).all(raceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    course: Number(row.course),
    exhibitionTime: row.exhibition_time == null ? null : Number(row.exhibition_time),
    startTiming: row.start_timing == null ? null : Number(row.start_timing),
    ranking: row.ranking == null ? null : Number(row.ranking),
  }));
}

export type RacerCourseStat = {
  course: number;
  races: number;
  wins: number;
  winRate: number | null;
  entryRate: number | null;
  top3Rate: number | null;
  avgSt: number | null;
  startOrder: number | null;
};

export type RacerProfile = {
  flyingCount: number | null;
  lateStartCount: number | null;
  top3Rate: number | null;
  avgSt: number | null;
  abilityIndex: number | null;
};

export function upsertRacerCourseStats(db: DatabaseSync, registrationNo: string, stats: RacerCourseStat[], fetchedAt: string): void {
  for (const stat of stats) {
    db.prepare(`
INSERT INTO racer_course_stats (registration_no, course, races, wins, win_rate, entry_rate, top3_rate, avg_st, start_order, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(registration_no, course) DO UPDATE SET
  races = excluded.races,
  wins = excluded.wins,
  win_rate = excluded.win_rate,
  entry_rate = excluded.entry_rate,
  top3_rate = excluded.top3_rate,
  avg_st = excluded.avg_st,
  start_order = excluded.start_order,
  fetched_at = excluded.fetched_at
`).run(registrationNo, stat.course, stat.races, stat.wins, stat.winRate, stat.entryRate, stat.top3Rate, stat.avgSt, stat.startOrder, fetchedAt);
  }
}

export function upsertRacerProfile(db: DatabaseSync, registrationNo: string, profile: RacerProfile, fetchedAt: string): void {
  db.prepare(`
INSERT INTO racer_profiles (registration_no, flying_count, late_start_count, top3_rate, avg_st, ability_index, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(registration_no) DO UPDATE SET
  flying_count = excluded.flying_count,
  late_start_count = excluded.late_start_count,
  top3_rate = excluded.top3_rate,
  avg_st = excluded.avg_st,
  ability_index = excluded.ability_index,
  fetched_at = excluded.fetched_at
`).run(registrationNo, profile.flyingCount, profile.lateStartCount, profile.top3Rate, profile.avgSt, profile.abilityIndex, fetchedAt);
}

export function getRacerCourseStats(db: DatabaseSync, registrationNo: string): RacerCourseStat[] {
  const rows = db.prepare(`
SELECT course, races, wins, win_rate, entry_rate, top3_rate, avg_st, start_order
FROM racer_course_stats
WHERE registration_no = ?
ORDER BY course
`).all(registrationNo) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    course: Number(row.course),
    races: Number(row.races),
    wins: Number(row.wins),
    winRate: row.win_rate == null ? null : Number(row.win_rate),
    entryRate: row.entry_rate == null ? null : Number(row.entry_rate),
    top3Rate: row.top3_rate == null ? null : Number(row.top3_rate),
    avgSt: row.avg_st == null ? null : Number(row.avg_st),
    startOrder: row.start_order == null ? null : Number(row.start_order),
  }));
}

export function getRacerProfile(db: DatabaseSync, registrationNo: string): RacerProfile | null {
  const row = db.prepare(`
SELECT flying_count, late_start_count, top3_rate, avg_st, ability_index
FROM racer_profiles WHERE registration_no = ?
`).get(registrationNo) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    flyingCount: row.flying_count == null ? null : Number(row.flying_count),
    lateStartCount: row.late_start_count == null ? null : Number(row.late_start_count),
    top3Rate: row.top3_rate == null ? null : Number(row.top3_rate),
    avgSt: row.avg_st == null ? null : Number(row.avg_st),
    abilityIndex: row.ability_index == null ? null : Number(row.ability_index),
  };
}

export function listAllRegistrationNos(db: DatabaseSync): Array<{ registrationNo: string; racerName: string }> {
  const rows = db.prepare(`
SELECT DISTINCT
  json_extract(boat.value, '$.registrationNo') AS registration_no,
  json_extract(boat.value, '$.racerName') AS racer_name
FROM official_programs, json_each(json_extract(raw_json, '$.boats')) AS boat
WHERE json_extract(boat.value, '$.registrationNo') IS NOT NULL
ORDER BY registration_no
`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    registrationNo: String(row.registration_no),
    racerName: row.racer_name ? String(row.racer_name) : "",
  }));
}

export function hasExhibitionData(db: DatabaseSync, raceId: string): boolean {
  const row = db.prepare(`SELECT 1 FROM exhibition_data WHERE race_id = ? LIMIT 1`).get(raceId);
  return row != null;
}

export function getRacerCourseStatsFetchedAt(db: DatabaseSync, registrationNo: string): string | null {
  const row = db.prepare(`
SELECT MAX(fetched_at) as fetched_at FROM racer_course_stats WHERE registration_no = ?
`).get(registrationNo) as Record<string, unknown> | undefined;
  return row?.fetched_at == null ? null : String(row.fetched_at);
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
