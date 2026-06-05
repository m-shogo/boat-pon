import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  type AuditRow = {
    run_kind: string; model_version: string; buy_n: number;
    settled_n: number; pending_n: number; hits: number;
    hit_rate: number | null; roi: number | null;
    max_hit_odds: number; latest_date: string | null;
  };
  const rows = db.prepare(`
SELECT
  COALESCE(run_kind, '(null)') AS run_kind,
  COALESCE(model_version, '(null)') AS model_version,
  COUNT(*) AS buy_n,
  SUM(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
  SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) AS pending_n,
  SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
  ROUND(1.0 * SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END), 0), 4) AS hit_rate,
  ROUND(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi,
  MAX(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) AS max_hit_odds,
  MAX(date) AS latest_date
FROM decision_history
WHERE decision = 'BUY'
  AND (? = 'all' OR run_kind = ?)
  AND (? = 'all' OR model_version = ?)
GROUP BY run_kind, model_version
ORDER BY run_kind, model_version
`).all(args.runKind, args.runKind, args.modelVersion, args.modelVersion) as AuditRow[];

  const withExMax = rows.map((row) => {
    const settled = Number(row.settled_n ?? 0);
    const roi = nullableNumber(row.roi);
    const maxHitOdds = Number(row.max_hit_odds ?? 0);
    const roiExMax = roi != null && settled > 0 && maxHitOdds > 0
      ? Math.round((roi - maxHitOdds / settled) * 1000) / 1000
      : null;
    return { ...row, roi_ex_max: roiExMax };
  });

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), runKind: args.runKind, modelVersion: args.modelVersion, rows: withExMax, note: reportNote(args.runKind) }, null, 2));
  } else {
    console.log("# Boat Pon decision audit");
    console.log(`runKind=${args.runKind} modelVersion=${args.modelVersion}`);
    console.log(`Note: ${reportNote(args.runKind)}`);
    console.log("| run_kind | model_version | n | settled | pending | hits | hitRate | ROI | roiExMax | maxHitOdds | latestDate |");
    console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const row of withExMax) {
      console.log(`| ${row.run_kind} | ${row.model_version} | ${row.buy_n} | ${row.settled_n} | ${row.pending_n} | ${row.hits} | ${fmt(row.hit_rate)} | ${fmt(row.roi)} | ${fmt(row.roi_ex_max)} | ${fmt(row.max_hit_odds)} | ${row.latest_date ?? "-"} |`);
    }
  }
} finally {
  db.close();
}

function parseArgs(argv: string[]) {
  const parsed = { runKind: "paper-live", modelVersion: LIVE_MONITOR_MODEL_VERSION, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--run-kind") { parsed.runKind = runKind(value); i += 1; }
    else if (key === "--model-version") { parsed.modelVersion = modelVersion(value); i += 1; }
    else if (key === "--json") parsed.json = true;
    else if (key === "--help") { console.log("Usage: npm run report:buy-audit -- [--run-kind paper-live|historical-backfill|manual-test|sample|all] [--model-version VERSION|all] [--json]"); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}
function runKind(value: string | undefined) {
  if (value === "paper-live" || value === "historical-backfill" || value === "manual-test" || value === "sample" || value === "all") return value;
  throw new Error(`invalid --run-kind: ${value ?? ""}`);
}
function modelVersion(value: string | undefined) {
  if (!value) throw new Error("--model-version requires a value");
  return value;
}
function nullableNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function fmt(value: unknown) {
  const n = nullableNumber(value);
  return n == null ? "-" : n.toFixed(3);
}
function reportNote(runKind: string) {
  if (runKind === "paper-live") return "paper-live only: use this for live observation metrics.";
  if (runKind === "historical-backfill") return "historical-backfill only: research/backfill metrics, not live observation.";
  return "mixed run_kind: diagnostic only.";
}
