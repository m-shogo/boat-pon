import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Args = { date: string | null; json: boolean; minEv: number; maxRows: number };
type Row = { race_id: string; date: string; venue: string; race_no: number; decision: string; selection: string; current_odds: number | null; required_odds: number | null; ev: number | null; sample_size?: number | null; model_version?: string | null; created_at?: string | null };
type DryRunRow = Row & { level: "send" | "watch" | "skip"; reason: string; oddsRatio: number | null };

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));
const targetDate = args.date ?? todayTokyo();

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const rows = listRows(db, targetDate, args.maxRows).map((row) => classify(row, args.minEv));
  const summary = summarize(rows);
  const payload = { generatedAt: new Date().toISOString(), date: targetDate, minEv: args.minEv, summary, rows };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printReport(payload);
} finally {
  db.close();
}

function listRows(db: DatabaseSync, date: string, limit: number): Row[] {
  if (!tableExists(db, "decision_history")) return [];
  const sample = hasColumn(db, "decision_history", "sample_size") ? "sample_size" : "0 AS sample_size";
  const model = hasColumn(db, "decision_history", "model_version") ? "model_version" : "NULL AS model_version";
  const created = hasColumn(db, "decision_history", "created_at") ? "created_at" : "NULL AS created_at";
  return db.prepare(`
SELECT race_id, date, venue, race_no, decision, selection, current_odds, required_odds, ev, ${sample}, ${model}, ${created}
FROM decision_history
WHERE date = ? AND decision IN ('BUY', 'WATCH', 'SKIP')
ORDER BY CASE decision WHEN 'BUY' THEN 0 WHEN 'WATCH' THEN 1 ELSE 2 END, ev DESC, current_odds DESC
LIMIT ?
`).all(date, limit) as Row[];
}

function classify(row: Row, minEv: number): DryRunRow {
  const oddsRatio = row.current_odds != null && row.required_odds != null && row.required_odds > 0 ? row.current_odds / row.required_odds : null;
  if (row.decision !== "BUY") return { ...row, level: row.decision === "WATCH" ? "watch" : "skip", reason: row.decision, oddsRatio };
  if (row.current_odds == null || row.current_odds <= 0) return { ...row, level: "skip", reason: "BUYだがオッズ欠損", oddsRatio };
  if (row.ev == null || row.ev < minEv) return { ...row, level: "watch", reason: `EVがしきい値未満 (${fmt(row.ev)} < ${minEv})`, oddsRatio };
  if ((row.sample_size ?? 0) < 30) return { ...row, level: "watch", reason: "sample_size < 30", oddsRatio };
  return { ...row, level: "send", reason: "dry-run送信候補", oddsRatio };
}

function summarize(rows: DryRunRow[]) {
  return {
    total: rows.length,
    send: rows.filter((row) => row.level === "send").length,
    watch: rows.filter((row) => row.level === "watch").length,
    skip: rows.filter((row) => row.level === "skip").length,
    buy: rows.filter((row) => row.decision === "BUY").length,
    avgEvSend: average(rows.filter((row) => row.level === "send").map((row) => row.ev)),
  };
}

function printReport(payload: { generatedAt: string; date: string; minEv: number; summary: ReturnType<typeof summarize>; rows: DryRunRow[] }) {
  console.log("# Boat Pon decision dry-run");
  console.log(`date: ${payload.date}`);
  console.log(`minEv: ${payload.minEv}`);
  console.log(`summary: total=${payload.summary.total} send=${payload.summary.send} watch=${payload.summary.watch} skip=${payload.summary.skip} buy=${payload.summary.buy} avgEvSend=${fmt(payload.summary.avgEvSend)}`);
  console.log("\n| level | decision | race | selection | odds | req | ratio | EV | sample | reason |");
  console.log("|---|---|---|---|---:|---:|---:|---:|---:|---|");
  for (const row of payload.rows) {
    console.log(`| ${row.level} | ${row.decision} | ${row.venue}${row.race_no}R | ${row.selection} | ${fmt(row.current_odds)} | ${fmt(row.required_odds)} | ${fmt(row.oddsRatio)} | ${fmt(row.ev)} | ${row.sample_size ?? 0} | ${row.reason} |`);
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { date: null, json: false, minEv: 1.05, maxRows: 80 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--date") { args.date = date(value); i += 1; }
    else if (key === "--min-ev") { args.minEv = number(value, key); i += 1; }
    else if (key === "--max-rows") { args.maxRows = integer(value, key); i += 1; }
    else if (key === "--json") args.json = true;
    else if (key === "--help" || key === "-h") { printUsage(); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function tableExists(db: DatabaseSync, table: string) { return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) != null; }
function hasColumn(db: DatabaseSync, table: string, column: string) { return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column); }
function average(values: Array<number | null>) { const finite = values.filter((value): value is number => value != null && Number.isFinite(value)); return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null; }
function todayTokyo() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function date(value: string | undefined) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date: ${value ?? ""}`); return value; }
function number(value: string | undefined, key: string) { const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${key} must be number`); return n; }
function integer(value: string | undefined, key: string) { const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be positive integer`); return n; }
function fmt(value: number | null | undefined) { return value == null ? "-" : value.toFixed(3); }
function printUsage() { console.log("Usage: npx tsx scripts/decision-dry-run.ts [--date YYYY-MM-DD] [--min-ev 1.05] [--json]"); }
