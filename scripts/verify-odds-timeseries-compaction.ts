/** compact前後DBの保持対象時系列をfingerprint比較する。両DBとも読み取り専用。 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const SOURCE = valueOf("--source") ?? "data/boat.sqlite";
const CANDIDATE = valueOf("--candidate");
const FROM = valueOf("--from") ?? "2026-06-01";
const TO = valueOf("--to") ?? todayJst();
if (!CANDIDATE) throw new Error("--candidate <compact DB path> is required");
for (const path of [SOURCE, CANDIDATE]) if (!existsSync(path)) throw new Error(`DB not found: ${path}`);

const source = inspect(SOURCE);
const candidate = inspect(CANDIDATE);
const checks = {
  candidateIntegrity: candidate.integrity === "ok",
  retainedRowsEqual: source.retainedRows === candidate.retainedRows,
  retainedFingerprintEqual: source.fingerprint === candidate.fingerprint,
  completeGroupsEqual: source.completeGroups === candidate.completeGroups,
  candidateContainsOnlyRetainedRows: candidate.totalRows === candidate.retainedRows,
};
const passed = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ safety: { readOnly: true, dbWrites: false }, window: { from: FROM, to: TO }, source, candidate, checks, passed }, null, 2));
if (!passed) process.exitCode = 2;

function inspect(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000; PRAGMA temp_store=MEMORY;");
  const integrity = String((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check);
  const bounds = [FROM.replaceAll("-", ""), addDays(TO, 1).replaceAll("-", "")];
  const totalRows = Number((db.prepare("SELECT COUNT(*) n FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<?").get(...bounds) as { n: number }).n);
  const completeGroups = Number((db.prepare(`
    SELECT COUNT(*) n FROM (
      SELECT race_id,checkpoint_label FROM (
        SELECT race_id,checkpoint_label,captured_at
        FROM odds_timeseries_snapshots
        WHERE race_id>=? AND race_id<?
        GROUP BY race_id,checkpoint_label,captured_at
        HAVING COUNT(DISTINCT selection)>=120
      )
      GROUP BY race_id,checkpoint_label
    )
  `).get(...bounds) as { n: number }).n);
  const hash = createHash("sha256");
  let retainedRows = 0;
  const sql = `
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
    ), retained AS (
      SELECT race_id,checkpoint_label,captured_at FROM canonical_ranked WHERE rn=1
      UNION
      SELECT race_id,checkpoint_label,captured_at FROM latest_ranked WHERE rn=1
    )
    SELECT o.race_id,o.checkpoint_label,o.captured_at,o.selection,o.odds,o.minutes_before_close
    FROM odds_timeseries_snapshots o
    JOIN retained r ON r.race_id=o.race_id AND r.checkpoint_label IS o.checkpoint_label AND r.captured_at=o.captured_at
    ORDER BY o.race_id,o.checkpoint_label,o.captured_at,o.selection,o.id
  `;
  for (const row of db.prepare(sql).iterate(...bounds) as Iterable<Record<string, unknown>>) {
    hash.update(`${row.race_id}\t${row.checkpoint_label}\t${row.captured_at}\t${row.selection}\t${row.odds}\t${row.minutes_before_close}\n`);
    retainedRows += 1;
  }
  db.close();
  return { path, integrity, totalRows, retainedRows, completeGroups, fingerprint: hash.digest("hex") };
}

function valueOf(name: string) { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] ?? null : null; }
function addDays(date: string, delta: number) { const value = new Date(`${date}T00:00:00+09:00`); value.setUTCDate(value.getUTCDate() + delta); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value); }
function todayJst() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()); }
