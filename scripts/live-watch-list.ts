import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";

const DB_PATH = "data/boat.sqlite";
const DEFAULT_LIMIT = 20;

const today = todayJst();
const limit = parseLimit(process.argv);
const jsonMode = process.argv.includes("--json");
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  run();
} finally {
  db.close();
}

function run() {
  const report = buildReport();

  if (jsonMode) {
    console.log(JSON.stringify(report));
  } else {
    printReport(report);
  }
}

function buildReport() {
  const rows = db
    .prepare(
      `
SELECT
  race_id,
  venue,
  race_no,
  decision,
  selection,
  current_odds,
  required_odds,
  ev,
  sample_size,
  race_category
FROM decision_history
WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
ORDER BY
  CASE decision WHEN 'BUY' THEN 0 ELSE 1 END,
  race_id
LIMIT ?
`,
    )
    .all(today, LIVE_MONITOR_MODEL_VERSION, limit) as WatchRow[];

  const total = (
    db
      .prepare(
        `
SELECT COUNT(*) AS n
FROM decision_history
WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
`,
      )
      .get(today, LIVE_MONITOR_MODEL_VERSION) as { n: number }
  ).n;

  const countRows = db
    .prepare(
      `
SELECT decision, COUNT(*) AS n
FROM decision_history
WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
GROUP BY decision
`,
    )
    .all(today, LIVE_MONITOR_MODEL_VERSION) as Array<{ decision: "BUY" | "WATCH"; n: number }>;
  const counts = Object.fromEntries(countRows.map((row) => [row.decision, row.n])) as Partial<
    Record<"BUY" | "WATCH", number>
  >;

  return {
    date: today,
    model: LIVE_MONITOR_MODEL_VERSION,
    total,
    shown: rows.length,
    counts: {
      BUY: counts.BUY ?? 0,
      WATCH: counts.WATCH ?? 0,
    },
    candidates: rows,
    hidden: Math.max(0, total - rows.length),
    action: "observe only; do not purchase from this command",
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  console.log(`date: ${today}`);
  console.log(`model: ${LIVE_MONITOR_MODEL_VERSION}`);
  console.log(
    `watch_buy: total=${report.total} shown=${report.shown} BUY=${report.counts.BUY} WATCH=${report.counts.WATCH}`,
  );

  if (report.candidates.length === 0) {
    console.log("candidates: none");
    console.log("action: observe only");
    return;
  }

  for (const row of report.candidates) {
    console.log(formatRow(row));
  }

  if (report.hidden > 0) {
    console.log(`more: ${report.hidden} hidden; rerun with --limit ${report.total}`);
  }

  console.log(`action: ${report.action}`);
}

function formatRow(row: WatchRow) {
  const odds = formatNumber(row.current_odds, 1);
  const required = formatNumber(row.required_odds, 1);
  const ev = formatNumber(row.ev, 3);
  const sample = row.sample_size == null ? "-" : String(row.sample_size);
  const category = row.race_category ?? "-";
  return `${row.decision} ${row.race_id} ${row.venue}${padRaceNo(row.race_no)} ${row.selection} odds=${odds} req=${required} ev=${ev} sample=${sample} cat=${category}`;
}

function parseLimit(args: string[]) {
  const index = args.indexOf("--limit");
  if (index === -1) return DEFAULT_LIMIT;

  const parsed = Number(args[index + 1]);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;

  throw new Error("--limit must be a positive integer");
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function formatNumber(value: number | null, digits: number) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function padRaceNo(value: number) {
  return String(value).padStart(2, "0");
}

type WatchRow = {
  race_id: string;
  venue: string;
  race_no: number;
  decision: "BUY" | "WATCH";
  selection: string;
  current_odds: number | null;
  required_odds: number | null;
  ev: number | null;
  sample_size: number | null;
  race_category: string | null;
};
