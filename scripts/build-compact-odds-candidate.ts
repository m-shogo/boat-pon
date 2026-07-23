/**
 * 人間の保守作業専用。原本は読み取り専用backup sourceとして扱い、別候補DBだけをcompactする。
 * エージェントは実行しない。auto-oddsがunload済みでなければ拒否する。
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { backup, DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const sourceArg = valueOf("--source") ?? "data/boat.sqlite";
const candidateArg = valueOf("--candidate");
const from = valueOf("--from") ?? "2026-06-01";
const to = valueOf("--to") ?? "2026-07-20";
const confirmation = valueOf("--confirm");

if (!candidateArg) fail("--candidate <absolute path> is required");
if (!isAbsolute(candidateArg)) fail("--candidate must be an absolute path");
if (confirmation !== "BUILD_COMPACT_CANDIDATE_ONLY") {
  fail("refusing write: pass --confirm BUILD_COMPACT_CANDIDATE_ONLY");
}

const source = resolve(sourceArg);
const candidate = resolve(candidateArg);
if (!existsSync(source)) fail(`source DB not found: ${source}`);
if (existsSync(candidate)) fail(`candidate already exists: ${candidate}`);
if (source === candidate) fail("source and candidate must differ");
assertAutoOddsUnloaded();

console.log(`[compact] source=${source}`);
console.log(`[compact] candidate=${candidate}`);
console.log(`[compact] range=${from}..${to}`);
console.log("[compact] creating consistent SQLite backup; source is not modified");

const sourceDb = new DatabaseSync(source, { readOnly: true });
sourceDb.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  await backup(sourceDb, candidate, { rate: 256 });
} finally {
  sourceDb.close();
}

const candidateDb = new DatabaseSync(candidate);
candidateDb.exec("PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON; PRAGMA temp_store=FILE;");
try {
  const quick = String((candidateDb.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check);
  if (quick !== "ok") fail(`candidate quick_check failed before compact: ${quick}`);

  console.log("[compact] selecting retained captures in candidate DB");
  candidateDb.exec(`
    CREATE TEMP TABLE retained_odds_captures (
      race_id TEXT NOT NULL,
      checkpoint_label TEXT,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (race_id, checkpoint_label, captured_at)
    );
  `);
  candidateDb.prepare(`
    INSERT INTO retained_odds_captures (race_id, checkpoint_label, captured_at)
    WITH captures AS (
      SELECT race_id,checkpoint_label,captured_at,MIN(minutes_before_close) minutes_before_close,COUNT(DISTINCT selection) selection_count
      FROM odds_timeseries_snapshots
      WHERE race_id>=? AND race_id<?
      GROUP BY race_id,checkpoint_label,captured_at
    ), canonical_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY race_id,checkpoint_label ORDER BY
        ABS(COALESCE(minutes_before_close,9999)-CASE checkpoint_label WHEN 'T-30' THEN 30 WHEN 'T-20' THEN 20 WHEN 'T-10' THEN 12 WHEN 'T-5' THEN 5 ELSE 0 END),
        captured_at DESC
      ) rn
      FROM captures WHERE selection_count>=120
    ), latest_ranked AS (
      SELECT *,ROW_NUMBER() OVER(PARTITION BY race_id,checkpoint_label ORDER BY captured_at DESC) rn
      FROM captures
    )
    SELECT race_id,checkpoint_label,captured_at FROM canonical_ranked WHERE rn=1
    UNION
    SELECT race_id,checkpoint_label,captured_at FROM latest_ranked WHERE rn=1
  `).run(from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", ""));

  const before = Number((candidateDb.prepare("SELECT COUNT(*) n FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<?").get(from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", "")) as { n: number }).n);
  console.log(`[compact] candidate rows before=${before}`);

  // 候補DBだけの索引を一時的に外し、大量削除後に同一定義で再作成する。
  candidateDb.exec("DROP INDEX IF EXISTS idx_odds_timeseries_checkpoints;");
  candidateDb.prepare(`
    DELETE FROM odds_timeseries_snapshots
    WHERE race_id>=? AND race_id<?
      AND NOT EXISTS (
        SELECT 1 FROM retained_odds_captures r
        WHERE r.race_id=odds_timeseries_snapshots.race_id
          AND r.checkpoint_label IS odds_timeseries_snapshots.checkpoint_label
          AND r.captured_at=odds_timeseries_snapshots.captured_at
      )
  `).run(from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", ""));
  candidateDb.exec(`
    CREATE INDEX idx_odds_timeseries_checkpoints
    ON odds_timeseries_snapshots (race_id, selection, checkpoint_label, captured_at);
    ANALYZE odds_timeseries_snapshots;
  `);
  const after = Number((candidateDb.prepare("SELECT COUNT(*) n FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<?").get(from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", "")) as { n: number }).n);
  console.log(`[compact] candidate rows after=${after}; removed=${before - after}`);
  console.log("[compact] VACUUM candidate DB");
  candidateDb.exec("VACUUM;");
  const integrity = String((candidateDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check);
  if (integrity !== "ok") fail(`candidate integrity_check failed: ${integrity}`);
  console.log("[compact] candidate integrity_check=ok");
  console.log("[compact] source remains unchanged; run verify:odds-timeseries-compaction before any switch");
} finally {
  candidateDb.close();
}

function assertAutoOddsUnloaded() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid == null) fail("cannot determine uid for launchd safety check");
  const result = spawnSync("launchctl", ["print", `gui/${uid}/com.boatpon.auto-odds`], { encoding: "utf8" });
  if (result.status === 0) fail("auto-odds is still loaded; unload it before building a switch-ready candidate DB");
}

function valueOf(name: string) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] ?? null : null; }
function addDays(date: string, delta: number) { const value = new Date(`${date}T00:00:00+09:00`); value.setUTCDate(value.getUTCDate() + delta); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value); }
function fail(message: string): never { console.error(`[compact] ${message}`); process.exit(2); }
