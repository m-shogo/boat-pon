import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_APP_RULE } from "../src/domain/decision";
import { inferDecisionRunKind, type DecisionRunKind } from "../src/domain/liveRunKind";
import { extractProgramFeatures, type ProgramFeatureSnapshot } from "../src/domain/programFeatures";
import type { OddsSnapshot } from "../src/domain/oddsSnapshot";
import type { RaceCategory } from "../src/domain/programCategory";
import type { RaceEnvironment } from "../src/domain/raceEnvironment";
import type { ParsedResultDetail } from "../src/domain/officialResultDetailParser";
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
  sharp_signal_drop REAL,
  environment_risk_level TEXT,
  exhibition_st_residual_sum REAL,
  selection_popularity INTEGER,
  run_kind TEXT NOT NULL DEFAULT 'historical-backfill',
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

CREATE TABLE IF NOT EXISTS odds_timeseries_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  selection TEXT NOT NULL,
  odds REAL NOT NULL,
  popularity INTEGER,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  minutes_before_close INTEGER,
  checkpoint_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS motor_boat_stats (
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  course INTEGER NOT NULL,
  motor_no TEXT,
  motor_top2_rate REAL,
  boat_no TEXT,
  boat_top2_rate REAL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (race_id, course)
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
  source_type TEXT NOT NULL DEFAULT 'official_live',
  source_quality TEXT NOT NULL DEFAULT 'exact',
  PRIMARY KEY (race_id, course)
);

CREATE TABLE IF NOT EXISTS race_weather (
  race_id TEXT PRIMARY KEY,
  weather TEXT,
  wind_speed_mps REAL,
  wave_height_cm REAL,
  temperature_c REAL,
  water_temperature_c REAL,
  stable_plate INTEGER,
  shortened_laps INTEGER,
  fetched_at TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'official_live',
  source_quality TEXT NOT NULL DEFAULT 'exact'
);

CREATE TABLE IF NOT EXISTS race_equipment (
  race_id TEXT NOT NULL,
  course INTEGER NOT NULL,
  tilt_angle REAL,
  propeller_changed INTEGER NOT NULL DEFAULT 0,
  parts_changed TEXT NOT NULL DEFAULT '[]',
  parts_changed_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'official_live',
  source_quality TEXT NOT NULL DEFAULT 'exact',
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

-- 公式K結果アーカイブ(2000-)再パース用。全馬券種払戻。
CREATE TABLE IF NOT EXISTS race_payouts (
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  combination TEXT NOT NULL,
  payout_yen INTEGER,
  popularity INTEGER,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'official',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (race_id, bet_type, combination)
);

-- 各艇成績(着順/展示/進入/ST/タイム)。
CREATE TABLE IF NOT EXISTS race_entries (
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  boat INTEGER NOT NULL,
  finish_pos INTEGER,
  status_code TEXT,
  racer_reg TEXT,
  racer_name TEXT,
  motor_no INTEGER,
  boat_no INTEGER,
  exhibition_time REAL,
  entry_course INTEGER,
  st REAL,
  st_flying INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'official',
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (race_id, boat)
);

-- レース条件(気象/距離/決まり手)。
CREATE TABLE IF NOT EXISTS race_conditions (
  race_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  race_type TEXT,
  distance_m INTEGER,
  weather TEXT,
  wind_dir TEXT,
  wind_mps REAL,
  wave_cm REAL,
  kimarite TEXT,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'official',
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
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN sharp_signal_drop REAL");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN environment_risk_level TEXT");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN exhibition_st_residual_sum REAL");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN selection_popularity INTEGER");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'historical-backfill'");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN decision_reasons TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment REAL");
  } catch {
    // Existing databases already have this column.
  }
  try {
    db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment_breakdown TEXT");
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
CREATE INDEX IF NOT EXISTS idx_decision_history_race_selection ON decision_history (race_id, selection);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_race ON odds_snapshots (race_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_race_selection_final
ON odds_snapshots (race_id, selection, is_final_like, captured_at);
CREATE INDEX IF NOT EXISTS idx_odds_timeseries_checkpoints
ON odds_timeseries_snapshots (race_id, selection, checkpoint_label, captured_at);
CREATE INDEX IF NOT EXISTS idx_decision_history_run_kind_date
ON decision_history (run_kind, date, model_version, decision);
CREATE INDEX IF NOT EXISTS idx_motor_boat_stats_motor
ON motor_boat_stats (venue, motor_no, date);
CREATE INDEX IF NOT EXISTS idx_motor_boat_stats_boat
ON motor_boat_stats (venue, boat_no, date);
CREATE INDEX IF NOT EXISTS idx_race_equipment_race ON race_equipment (race_id);
CREATE INDEX IF NOT EXISTS idx_race_payouts_vd ON race_payouts (venue, date);
CREATE INDEX IF NOT EXISTS idx_race_payouts_type ON race_payouts (bet_type, date);
CREATE INDEX IF NOT EXISTS idx_race_entries_vd ON race_entries (venue, date);
CREATE INDEX IF NOT EXISTS idx_race_conditions_vd ON race_conditions (venue, date);
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

  // beforeinfo系テーブルへの source_type / source_quality 追加（既存DBのmigration）
  try { db.exec("ALTER TABLE exhibition_data ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_live'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE exhibition_data ADD COLUMN source_quality TEXT NOT NULL DEFAULT 'exact'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE race_weather ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_live'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE race_weather ADD COLUMN source_quality TEXT NOT NULL DEFAULT 'exact'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE race_equipment ADD COLUMN source_type TEXT NOT NULL DEFAULT 'official_live'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE race_equipment ADD COLUMN source_quality TEXT NOT NULL DEFAULT 'exact'"); } catch { /* Already exists. */ }

  // 判定理由・特徴量内訳の保存（既存DBのmigration）
  try { db.exec("ALTER TABLE decision_history ADD COLUMN decision_reasons TEXT NOT NULL DEFAULT '[]'"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment REAL"); } catch { /* Already exists. */ }
  try { db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment_breakdown TEXT"); } catch { /* Already exists. */ }

  // ジョブ管理テーブル
  db.exec(`
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_runs_unique
ON job_runs (app_name, job_name, target_date);

CREATE TABLE IF NOT EXISTS missing_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_missing_jobs_unique
ON missing_jobs (app_name, job_name, target_date);

CREATE TABLE IF NOT EXISTS job_locks (
  job_key TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL
);
`);
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

export function recordOddsTimeseriesSnapshot(db: DatabaseSync, snapshot: OddsSnapshot & {
  minutesBeforeClose?: number | null;
  checkpointLabel?: "T-30" | "T-20" | "T-10" | "T-5" | "ad-hoc" | null;
}) {
  db.prepare(`
INSERT INTO odds_timeseries_snapshots
(race_id, selection, odds, popularity, source, captured_at, minutes_before_close, checkpoint_label)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    snapshot.raceId,
    snapshot.selection,
    snapshot.odds,
    snapshot.popularity,
    snapshot.source,
    snapshot.capturedAt,
    snapshot.minutesBeforeClose ?? null,
    snapshot.checkpointLabel ?? null,
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

export function countOddsSnapshots(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM odds_snapshots").get() as { count: number };
  return Number(row.count);
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

/** racer_course_stats を全件ロードして Map<"registrationNo-course", {avgSt, top3Rate}> を返す */
function loadCourseStatsMap(db: DatabaseSync): Map<string, { avgSt: number | null; top3Rate: number | null }> {
  const rows = db.prepare(`
    SELECT registration_no, course, avg_st, top3_rate FROM racer_course_stats
  `).all() as Array<Record<string, unknown>>;
  const map = new Map<string, { avgSt: number | null; top3Rate: number | null }>();
  for (const row of rows) {
    const key = `${row.registration_no}-${row.course}`;
    map.set(key, {
      avgSt: row.avg_st == null ? null : Number(row.avg_st),
      top3Rate: row.top3_rate == null ? null : Number(row.top3_rate),
    });
  }
  return map;
}

/** racer_profiles を全件ロードして Map<registrationNo, {flyingCount, lateStartCount}> を返す */
function loadRacerProfilesMap(db: DatabaseSync): Map<string, { flyingCount: number | null; lateStartCount: number | null }> {
  const rows = db.prepare(`
    SELECT registration_no, flying_count, late_start_count FROM racer_profiles
    WHERE flying_count IS NOT NULL
  `).all() as Array<Record<string, unknown>>;
  const map = new Map<string, { flyingCount: number | null; lateStartCount: number | null }>();
  for (const row of rows) {
    map.set(String(row.registration_no), {
      flyingCount: row.flying_count == null ? null : Number(row.flying_count),
      lateStartCount: row.late_start_count == null ? null : Number(row.late_start_count),
    });
  }
  return map;
}

/** exhibition_data を全件ロードして Map<"race_id-course", start_timing> を返す
 *  有効な ST値（0.05〜0.4s）のみ保持。0 や null は欠損とみなす。 */
function loadExhibitionStMap(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(`
    SELECT race_id, course, start_timing FROM exhibition_data
    WHERE start_timing > 0.05 AND start_timing < 0.4
  `).all() as Array<Record<string, unknown>>;
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.race_id}-${row.course}`, Number(row.start_timing));
  }
  return map;
}

/** motor_boat_stats を race_id 別にロードして Map<"race_id-course", {motorTop2Rate, boatTop2Rate}> を返す */
function loadMotorBoatStatsMap(db: DatabaseSync): Map<string, { motorTop2Rate: number | null; boatTop2Rate: number | null }> {
  const rows = db.prepare(`
    SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats
    WHERE motor_top2_rate IS NOT NULL OR boat_top2_rate IS NOT NULL
  `).all() as Array<Record<string, unknown>>;
  const map = new Map<string, { motorTop2Rate: number | null; boatTop2Rate: number | null }>();
  for (const row of rows) {
    map.set(`${row.race_id}-${row.course}`, {
      motorTop2Rate: row.motor_top2_rate == null ? null : Number(row.motor_top2_rate),
      boatTop2Rate: row.boat_top2_rate == null ? null : Number(row.boat_top2_rate),
    });
  }
  return map;
}

/**
 * extractProgramFeatures の結果に racer_course_stats / racer_profiles / exhibition_data / motor_boat_stats の値を注入する。
 *
 * mode による live-only特徴量の制御:
 *   - "live": 全特徴量を注入（現在値スナップショットを使ってよい）
 *   - "historical" | "historical-readonly": live-only特徴量（courseAvgSt/courseTop3Rate/flyingCount/lateStartCount/exhibitionStResidual）は null にする
 *   - "report": 値の存在確認用。historical と同じく live-only は null にする
 *
 * historical mode で live-only を注入しないのは point-in-time leakage 防止のため。
 * racer_profiles / racer_course_stats は現在値スナップショット1世代のみで snapshot_date が race_date より後のため unsafe。
 */
function enrichFeatures(
  raceId: string,
  features: ProgramFeatureSnapshot,
  courseStatsMap: Map<string, { avgSt: number | null; top3Rate: number | null }>,
  profilesMap: Map<string, { flyingCount: number | null; lateStartCount: number | null }>,
  exhibitionStMap: Map<string, number>,
  motorBoatStatsMap: Map<string, { motorTop2Rate: number | null; boatTop2Rate: number | null }>,
  mode: import("../src/domain/programFeatureSafety").ProgramFeatureUsageMode,
): ProgramFeatureSnapshot {
  const isLive = mode === "live";
  return {
    boats: features.boats.map((boat) => {
      if (!boat.registrationNo) return boat;
      const motorBoatStat = motorBoatStatsMap.get(`${raceId}-${boat.course}`);
      if (!isLive) {
        // historical / historical-readonly / report: live-only特徴量は null。motor_boat_stats は race_id単位で安全。
        return {
          ...boat,
          courseAvgSt: null,
          courseTop3Rate: null,
          flyingCount: null,
          lateStartCount: null,
          exhibitionStResidual: null,
          venueMotorTop2Rate: motorBoatStat?.motorTop2Rate ?? null,
          venueBoatTop2Rate: motorBoatStat?.boatTop2Rate ?? null,
        };
      }
      // live mode: 現状どおり全特徴量を注入
      const stat = courseStatsMap.get(`${boat.registrationNo}-${boat.course}`);
      const profile = profilesMap.get(boat.registrationNo);
      const exhibitionSt = exhibitionStMap.get(`${raceId}-${boat.course}`) ?? null;
      const exhibitionStResidual =
        stat?.avgSt != null && exhibitionSt != null
          ? stat.avgSt - exhibitionSt
          : null;
      return {
        ...boat,
        courseAvgSt: stat?.avgSt ?? null,
        courseTop3Rate: stat?.top3Rate ?? null,
        flyingCount: profile?.flyingCount ?? null,
        lateStartCount: profile?.lateStartCount ?? null,
        exhibitionStResidual,
        venueMotorTop2Rate: motorBoatStat?.motorTop2Rate ?? null,
        venueBoatTop2Rate: motorBoatStat?.boatTop2Rate ?? null,
      };
    }),
  };
}

/** live runtime用（date指定なしは当日全レース）。live modeで全特徴量を注入する。 */
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
  const courseStatsMap = loadCourseStatsMap(db);
  const profilesMap = loadRacerProfilesMap(db);
  const exhibitionStMap = loadExhibitionStMap(db);
  const motorBoatStatsMap = loadMotorBoatStatsMap(db);
  const beforeInfoCompleteRaceIds = loadBeforeInfoCompleteRaceIds(db);
  return rows.map((row) => {
    const raceId = String(row.race_id);
    return {
      raceId,
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      closeAt: String(row.close_at),
      raceCategory: parseRaceCategory(row.raw_json),
      beforeInfoComplete: beforeInfoCompleteRaceIds.has(raceId),
      // live runtime: mode="live" で全特徴量を注入してよい
      features: enrichFeatures(raceId, extractProgramFeatures(parseRawJson(row.raw_json)), courseStatsMap, profilesMap, exhibitionStMap, motorBoatStatsMap, "live"),
    };
  });
}

/**
 * historical range 用。
 * modeは "historical"（DB書き込みパス）または "historical-readonly"（read-only評価）を指定。
 * live-only特徴量は mode に従い null にする。
 * デフォルト "historical-readonly" で安全側に倒す。
 */
export function listProgramInputsRange(
  db: DatabaseSync,
  from: string,
  to: string,
  limit: number,
  mode: import("../src/domain/programFeatureSafety").HistoricalProgramFeatureUsageMode = "historical-readonly",
) {
  const rows = db.prepare(`
SELECT race_id, date, venue, race_no, close_at, raw_json
FROM official_programs
WHERE date >= ? AND date <= ?
ORDER BY date ASC, venue ASC, race_no ASC
LIMIT ?
`).all(from, to, limit) as Array<Record<string, unknown>>;
  const motorBoatStatsMap = loadMotorBoatStatsMap(db);
  // HistoricalProgramFeatureUsageMode は "live" を含まないため live-only マップは常に空
  const courseStatsMap = new Map<string, never>();
  const profilesMap = new Map<string, never>();
  const exhibitionStMap = new Map<string, never>();
  return rows.map((row) => {
    const raceId = String(row.race_id);
    return {
      raceId,
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      closeAt: String(row.close_at),
      raceCategory: parseRaceCategory(row.raw_json),
      features: enrichFeatures(raceId, extractProgramFeatures(parseRawJson(row.raw_json)), courseStatsMap, profilesMap, exhibitionStMap, motorBoatStatsMap, mode),
      featureMode: mode,
    };
  });
}

/**
 * historical range（odds snapshot 付き）用。
 * デフォルト "historical" でDB書き込みパスを安全に保護する。
 */
export function listProgramInputsWithOddsSnapshotsRange(
  db: DatabaseSync,
  from: string,
  to: string,
  limit: number,
  mode: import("../src/domain/programFeatureSafety").HistoricalProgramFeatureUsageMode = "historical",
) {
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
  const motorBoatStatsMap = loadMotorBoatStatsMap(db);
  // HistoricalProgramFeatureUsageMode は "live" を含まないため live-only マップは常に空
  const courseStatsMap = new Map<string, never>();
  const profilesMap = new Map<string, never>();
  const exhibitionStMap = new Map<string, never>();
  return rows.map((row) => {
    const raceId = String(row.race_id);
    return {
      raceId,
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      closeAt: String(row.close_at),
      raceCategory: parseRaceCategory(row.raw_json),
      features: enrichFeatures(raceId, extractProgramFeatures(parseRawJson(row.raw_json)), courseStatsMap, profilesMap, exhibitionStMap, motorBoatStatsMap, mode),
      featureMode: mode,
    };
  });
}

function calcExhibitionStResidualSum(candidate: BetCandidate): number | null {
  const r1 = candidate.firstBoatFeature?.exhibitionStResidual;
  const r2 = candidate.secondBoatFeature?.exhibitionStResidual;
  const r3 = candidate.thirdBoatFeature?.exhibitionStResidual;
  if (r1 == null && r2 == null && r3 == null) return null;
  return (r1 ?? 0) + (r2 ?? 0) + (r3 ?? 0);
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
  upsertMotorBoatStats(db, row);
}

export function upsertMotorBoatStats(db: DatabaseSync, row: {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  raw: Record<string, unknown>;
}) {
  const boats = Array.isArray(row.raw.boats) ? row.raw.boats : [];
  const insert = db.prepare(`
INSERT OR REPLACE INTO motor_boat_stats
(race_id, date, venue, race_no, course, motor_no, motor_top2_rate, boat_no, boat_top2_rate, imported_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);
  for (const boat of boats) {
    if (!boat || typeof boat !== "object") continue;
    const b = boat as Record<string, unknown>;
    const course = toNullableNumber(b.course);
    if (course == null) continue;
    insert.run(
      row.raceId,
      row.date,
      row.venue,
      row.raceNo,
      course,
      toNullableText(b.motorNo),
      toNullableNumber(b.motorTop2Rate),
      toNullableText(b.boatNo),
      toNullableNumber(b.boatTop2Rate),
    );
  }
}

function toNullableText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function insertDecisionHistory(db: DatabaseSync, candidate: BetCandidate, decision: Decision, options: { replaceRace?: boolean; runKind?: DecisionRunKind } = {}) {
  const selection = candidate.selection.join("-");
  const runKind = options.runKind ?? inferDecisionRunKind(candidate);
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

  // 選択肢の人気順位を odds_snapshots から取得（データ収集のみ、フィルター変更なし）
  const selectionPopularityRow = db.prepare(
    "SELECT popularity FROM odds_snapshots WHERE race_id = ? AND selection = ? AND is_final_like = 1 ORDER BY captured_at DESC LIMIT 1"
  ).get(candidate.raceId, selection) as { popularity: number | null } | undefined;
  const selectionPopularity = selectionPopularityRow?.popularity ?? null;

  const decisionReasonsJson = JSON.stringify(decision.reasons ?? []);
  const featureAdjustmentBreakdownJson = candidate.featureAdjustmentBreakdown != null
    ? JSON.stringify(candidate.featureAdjustmentBreakdown)
    : null;

  if (existing) {
    db.prepare(`
UPDATE decision_history
SET selection = ?, estimated_hit_rate = ?, raw_estimated_hit_rate = ?, conservative_hit_rate = ?, model_selection_score = ?,
    required_odds = ?, current_odds = ?, ev = ?, decision = ?,
    result = ?, payout_yen = ?, popularity = ?, returned = ?, source = ?, fetched_at = ?,
    recommended_stake_yen = ?, sample_size = ?, model_version = ?, race_category = ?,
    sharp_signal_drop = ?, environment_risk_level = ?, exhibition_st_residual_sum = ?,
    selection_popularity = ?, run_kind = ?,
    decision_reasons = ?, feature_adjustment = ?, feature_adjustment_breakdown = ?
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
      candidate.sharpSignalDrop ?? null,
      candidate.environmentRiskLevel ?? null,
      calcExhibitionStResidualSum(candidate),
      selectionPopularity,
      runKind,
      decisionReasonsJson,
      candidate.featureAdjustment ?? null,
      featureAdjustmentBreakdownJson,
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
 model_version, race_category, sharp_signal_drop, environment_risk_level, exhibition_st_residual_sum, selection_popularity, run_kind,
 decision_reasons, feature_adjustment, feature_adjustment_breakdown)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    candidate.sharpSignalDrop ?? null,
    candidate.environmentRiskLevel ?? null,
    calcExhibitionStResidualSum(candidate),
    selectionPopularity,
    runKind,
    decisionReasonsJson,
    candidate.featureAdjustment ?? null,
    featureAdjustmentBreakdownJson,
  );
}

export function listDecisionHistory(db: DatabaseSync): import("../src/domain/backtest").DecisionHistoryRow[] {
  const rows = db.prepare(`
SELECT id, race_id, date, venue, race_no, selection, estimated_hit_rate, required_odds, current_odds,
       raw_estimated_hit_rate, conservative_hit_rate, model_selection_score,
       ev, decision, actually_bought, stake_yen, result, payout_yen, popularity, returned,
       source, fetched_at, recommended_stake_yen, sample_size, model_version, race_category,
       sharp_signal_drop, environment_risk_level, exhibition_st_residual_sum,
       selection_popularity, run_kind, created_at,
       decision_reasons, feature_adjustment, feature_adjustment_breakdown
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
    sharpSignalDrop: row.sharp_signal_drop == null ? null : Number(row.sharp_signal_drop),
    environmentRiskLevel: row.environment_risk_level == null ? null : String(row.environment_risk_level) as "low" | "medium" | "high",
    exhibitionStResidualSum: row.exhibition_st_residual_sum == null ? null : Number(row.exhibition_st_residual_sum),
    selectionPopularity: row.selection_popularity == null ? null : Number(row.selection_popularity),
    decisionReasons: row.decision_reasons == null ? [] : (() => { try { return JSON.parse(String(row.decision_reasons)) as string[]; } catch { return []; } })(),
    featureAdjustment: row.feature_adjustment == null ? null : Number(row.feature_adjustment),
    featureAdjustmentBreakdown: row.feature_adjustment_breakdown == null ? null : (() => { try { return JSON.parse(String(row.feature_adjustment_breakdown)) as import("../src/domain/programFeatures").FeatureAdjustmentBreakdown; } catch { return null; } })(),
    result: row.result == null ? null : String(row.result),
    payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
    popularity: row.popularity == null ? null : Number(row.popularity),
    returned: Boolean(row.returned),
    source: String(row.source),
    runKind: String(row.run_kind ?? "historical-backfill") as DecisionRunKind,
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
  const title = `[paper] 検証候補: ${candidate.venue} ${candidate.raceNo}R`;
  const body = [
    `候補: ${candidate.selection.join("-")}`,
    `推定的中率: ${(candidate.estimatedHitRate * 100).toFixed(1)}%`,
    candidate.rawEstimatedHitRate != null
      ? `保守化前推定: ${(candidate.rawEstimatedHitRate * 100).toFixed(1)}%`
      : null,
    `必要オッズ: ${decision.requiredOdds.toFixed(1)}倍以上`,
    `取得オッズ: ${candidate.currentOdds?.toFixed(1) ?? "未取得"}倍`,
    `EV: ${decision.ev?.toFixed(2) ?? "-"}`,
    "【paper観察モード】実購入なし。検証・反省用。",
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

export type RaceEquipmentEntry = {
  course: number;
  tiltAngle: number | null;
  propellerChanged: boolean;
  partsChanged: string[];
  partsChangedCount: number;
};

export function upsertExhibitionData(db: DatabaseSync, raceId: string, entries: ExhibitionEntry[], fetchedAt: string, sourceType = "official_live"): void {
  for (const entry of entries) {
    db.prepare(`
INSERT INTO exhibition_data (race_id, course, exhibition_time, start_timing, ranking, fetched_at, source_type)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id, course) DO UPDATE SET
  exhibition_time = excluded.exhibition_time,
  start_timing = excluded.start_timing,
  ranking = excluded.ranking,
  fetched_at = excluded.fetched_at,
  source_type = excluded.source_type
`).run(raceId, entry.course, entry.exhibitionTime, entry.startTiming, entry.ranking, fetchedAt, sourceType);
  }
}

// 公式K結果アーカイブの再パース結果(条件/各艇/全馬券種)を保存する。
// 大量再パース用に prepared statement を再利用。トランザクションは呼び出し側で。
export function saveResultDetail(db: DatabaseSync, parsed: ParsedResultDetail): void {
  const condStmt = db.prepare(`
INSERT INTO race_conditions (race_id, date, venue, race_no, race_type, distance_m, weather, wind_dir, wind_mps, wave_cm, kimarite, returned, source, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id) DO UPDATE SET
  race_type=excluded.race_type, distance_m=excluded.distance_m, weather=excluded.weather,
  wind_dir=excluded.wind_dir, wind_mps=excluded.wind_mps, wave_cm=excluded.wave_cm,
  kimarite=excluded.kimarite, returned=excluded.returned, source=excluded.source, fetched_at=excluded.fetched_at
`);
  const entStmt = db.prepare(`
INSERT INTO race_entries (race_id, date, venue, race_no, boat, finish_pos, status_code, racer_reg, racer_name, motor_no, boat_no, exhibition_time, entry_course, st, st_flying, source, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id, boat) DO UPDATE SET
  finish_pos=excluded.finish_pos, status_code=excluded.status_code, racer_reg=excluded.racer_reg,
  racer_name=excluded.racer_name, motor_no=excluded.motor_no, boat_no=excluded.boat_no,
  exhibition_time=excluded.exhibition_time, entry_course=excluded.entry_course, st=excluded.st,
  st_flying=excluded.st_flying, source=excluded.source, fetched_at=excluded.fetched_at
`);
  const payStmt = db.prepare(`
INSERT INTO race_payouts (race_id, date, venue, race_no, bet_type, combination, payout_yen, popularity, returned, source, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id, bet_type, combination) DO UPDATE SET
  payout_yen=excluded.payout_yen, popularity=excluded.popularity, returned=excluded.returned,
  source=excluded.source, fetched_at=excluded.fetched_at
`);
  for (const c of parsed.conditions) {
    condStmt.run(c.raceId, c.date, c.venue, c.raceNo, c.raceType, c.distanceM, c.weather, c.windDir, c.windMps, c.waveCm, c.kimarite, c.returned ? 1 : 0, c.source, c.fetchedAt);
  }
  for (const e of parsed.entries) {
    entStmt.run(e.raceId, e.date, e.venue, e.raceNo, e.boat, e.finishPos, e.statusCode, e.racerReg, e.racerName, e.motorNo, e.boatNo, e.exhibitionTime, e.entryCourse, e.st, e.stFlying ? 1 : 0, e.source, e.fetchedAt);
  }
  for (const p of parsed.payouts) {
    payStmt.run(p.raceId, p.date, p.venue, p.raceNo, p.betType, p.combination, p.payoutYen, p.popularity, p.returned ? 1 : 0, p.source, p.fetchedAt);
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

export function upsertRaceEquipment(db: DatabaseSync, raceId: string, entries: RaceEquipmentEntry[], fetchedAt: string, sourceType = "official_live"): void {
  for (const entry of entries) {
    const partsChanged = JSON.stringify(entry.partsChanged);
    db.prepare(`
INSERT INTO race_equipment (race_id, course, tilt_angle, propeller_changed, parts_changed, parts_changed_count, fetched_at, source_type)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id, course) DO UPDATE SET
  tilt_angle = excluded.tilt_angle,
  propeller_changed = excluded.propeller_changed,
  parts_changed = excluded.parts_changed,
  parts_changed_count = excluded.parts_changed_count,
  fetched_at = excluded.fetched_at,
  source_type = excluded.source_type
`).run(raceId, entry.course, entry.tiltAngle, entry.propellerChanged ? 1 : 0, partsChanged, entry.partsChangedCount, fetchedAt, sourceType);
  }
}

export function getRaceEquipment(db: DatabaseSync, raceId: string): RaceEquipmentEntry[] {
  const rows = db.prepare(`
SELECT course, tilt_angle, propeller_changed, parts_changed, parts_changed_count
FROM race_equipment
WHERE race_id = ?
ORDER BY course
`).all(raceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    course: Number(row.course),
    tiltAngle: row.tilt_angle == null ? null : Number(row.tilt_angle),
    propellerChanged: Boolean(row.propeller_changed),
    partsChanged: parsePartsChanged(row.parts_changed),
    partsChangedCount: Number(row.parts_changed_count ?? 0),
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

export function hasBeforeInfoData(db: DatabaseSync, raceId: string): boolean {
  const row = db.prepare(`
SELECT 1
FROM exhibition_data e
WHERE e.race_id = ?
  AND EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = e.race_id)
  AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = e.race_id)
LIMIT 1
`).get(raceId);
  return row != null;
}

function loadBeforeInfoCompleteRaceIds(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`
SELECT DISTINCT e.race_id
FROM exhibition_data e
WHERE EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = e.race_id)
  AND EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = e.race_id)
`).all() as Array<{ race_id: string }>;
  return new Set(rows.map((row) => String(row.race_id)));
}

export function getRacerCourseStatsFetchedAt(db: DatabaseSync, registrationNo: string): string | null {
  const row = db.prepare(`
SELECT MAX(fetched_at) as fetched_at FROM racer_course_stats WHERE registration_no = ?
`).get(registrationNo) as Record<string, unknown> | undefined;
  return row?.fetched_at == null ? null : String(row.fetched_at);
}

/** course_stats と profiles のどちらか新しい fetched_at を返す（引退選手のスキップ判定用） */
export function getRacerLastFetchedAt(db: DatabaseSync, registrationNo: string): string | null {
  const row = db.prepare(`
SELECT MAX(t) as fetched_at FROM (
  SELECT MAX(fetched_at) AS t FROM racer_course_stats WHERE registration_no = ?
  UNION ALL
  SELECT fetched_at AS t FROM racer_profiles WHERE registration_no = ?
)
`).get(registrationNo, registrationNo) as Record<string, unknown> | undefined;
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

export function upsertRaceWeather(db: DatabaseSync, raceId: string, env: RaceEnvironment, fetchedAt: string, sourceType = "official_live"): void {
  db.prepare(`
INSERT INTO race_weather (race_id, weather, wind_speed_mps, wave_height_cm, temperature_c, water_temperature_c, stable_plate, shortened_laps, fetched_at, source_type)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(race_id) DO UPDATE SET
  weather = excluded.weather,
  wind_speed_mps = excluded.wind_speed_mps,
  wave_height_cm = excluded.wave_height_cm,
  temperature_c = excluded.temperature_c,
  water_temperature_c = excluded.water_temperature_c,
  stable_plate = excluded.stable_plate,
  shortened_laps = excluded.shortened_laps,
  fetched_at = excluded.fetched_at,
  source_type = excluded.source_type
`).run(
    raceId,
    env.weather ?? null,
    env.windSpeedMps ?? null,
    env.waveHeightCm ?? null,
    env.temperatureC ?? null,
    env.waterTemperatureC ?? null,
    env.stablePlate ? 1 : 0,
    env.shortenedLaps ? 1 : 0,
    fetchedAt,
    sourceType,
  );
}

export function loadRaceWeatherMap(db: DatabaseSync): Map<string, RaceEnvironment> {
  const rows = db.prepare(`
SELECT race_id, weather, wind_speed_mps, wave_height_cm, temperature_c, water_temperature_c, stable_plate, shortened_laps
FROM race_weather
`).all() as Array<Record<string, unknown>>;
  return new Map(rows.map((row) => [
    String(row.race_id),
    {
      weather: row.weather == null ? null : String(row.weather),
      windSpeedMps: row.wind_speed_mps == null ? null : Number(row.wind_speed_mps),
      waveHeightCm: row.wave_height_cm == null ? null : Number(row.wave_height_cm),
      temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
      waterTemperatureC: row.water_temperature_c == null ? null : Number(row.water_temperature_c),
      stablePlate: Boolean(row.stable_plate),
      shortenedLaps: Boolean(row.shortened_laps),
    } satisfies RaceEnvironment,
  ]));
}

function parsePartsChanged(value: unknown): string[] {
  if (value == null) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map((part) => String(part)) : [];
  } catch {
    return String(value).split(/[、,\s/]+/).map((part) => part.trim()).filter(Boolean);
  }
}
