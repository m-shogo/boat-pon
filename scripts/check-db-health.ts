import { existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

const DB_PATH = "data/boat.sqlite";
const UNUSED_DB_PATH = "data/boat-pon.db";

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const report = buildReport(db);
  printReport(report);
  if (!report.ok) process.exitCode = 1;
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const columns = tableColumns(db, "decision_history");
  const requiredColumns = ["raw_estimated_hit_rate", "conservative_hit_rate", "model_selection_score"];
  const missingColumns = requiredColumns.filter((column) => !columns.includes(column));
  const liveBuyByModel = db.prepare(`
SELECT COALESCE(model_version, '(null)') AS model_version, source, COUNT(*) AS n, MAX(date) AS latest_date
FROM decision_history
WHERE decision='BUY' AND date >= ?
GROUP BY model_version, source
ORDER BY n DESC
`).all(LIVE_MONITOR_FROM) as Array<{ model_version: string; source: string; n: number; latest_date: string | null }>;

  const liveV4ByDate = db.prepare(`
SELECT date, source, COUNT(*) AS n
FROM decision_history
WHERE date >= ? AND model_version = ?
GROUP BY date, source
HAVING COUNT(*) >= 100
ORDER BY date DESC, n DESC
LIMIT 20
`).all(LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION) as Array<{ date: string; source: string; n: number }>;

  const duplicateRaceDecisions = db.prepare(`
SELECT race_id, COUNT(*) AS n, GROUP_CONCAT(decision) AS decisions
FROM decision_history
WHERE decision IN ('BUY', 'WATCH')
GROUP BY race_id
HAVING COUNT(*) > 1
ORDER BY n DESC, race_id DESC
LIMIT 20
`).all() as Array<{ race_id: string; n: number; decisions: string }>;

  const unusedDb = existsSync(UNUSED_DB_PATH)
    ? { path: UNUSED_DB_PATH, bytes: statSync(UNUSED_DB_PATH).size }
    : null;

  return {
    ok: missingColumns.length === 0,
    requiredColumns,
    missingColumns,
    liveBuyByModel,
    liveV4ByDate,
    duplicateRaceDecisions,
    unusedDb,
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  console.log("Boat Pon DB health");
  console.log(`decision_history diagnostic columns: ${report.missingColumns.length === 0 ? "ok" : `missing ${report.missingColumns.join(", ")}`}`);
  if (report.unusedDb) {
    const note = report.unusedDb.bytes === 0 ? "使わないDB（0バイト）" : "注意: 使わないDBだが0バイトではない";
    console.log(`${report.unusedDb.path}: ${report.unusedDb.bytes} bytes - ${note}`);
  }
  console.log("2026 live BUY by model/source:");
  if (report.liveBuyByModel.length === 0) {
    console.log("  none");
  } else {
    for (const row of report.liveBuyByModel) {
      const mark = row.model_version === LIVE_MONITOR_MODEL_VERSION ? "target" : "excluded";
      console.log(`  ${mark}\t${row.model_version}\t${row.source}\tn=${row.n}\tlatest=${row.latest_date ?? "-"}`);
    }
  }
  console.log(`possible 2026 current-model bulk history rows (${LIVE_MONITOR_MODEL_VERSION}):`);
  if (report.liveV4ByDate.length === 0) {
    console.log("  none");
  } else {
    for (const row of report.liveV4ByDate) {
      console.log(`  ${row.date}\t${row.source}\tn=${row.n}`);
    }
  }
  console.log("duplicate BUY/WATCH race_id:");
  if (report.duplicateRaceDecisions.length === 0) {
    console.log("  none");
  } else {
    for (const row of report.duplicateRaceDecisions) {
      console.log(`  ${row.race_id}\tn=${row.n}\t${row.decisions}`);
    }
  }
}

function tableColumns(db: DatabaseSync, table: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}
