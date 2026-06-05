import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Args = { from: string | null; to: string | null; windowDays: number; stepDays: number; minBuys: number; json: boolean };
type Row = { date: string; venue: string; race_no: number; decision: string; selection: string; result: string | null; returned: number; current_odds: number | null; ev: number | null };
type WindowSummary = { from: string; to: string; rows: number; buy: number; settledBuy: number; hits: number; hitRate: number | null; roi: number | null; avgEv: number | null; status: "pass" | "watch" | "fail" | "no_sample" };

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const range = resolveRange(db, args.from, args.to);
  const rows = listRows(db, range.from, range.to);
  const windows = buildWindows(rows, range.from, range.to, args.windowDays, args.stepDays, args.minBuys);
  const payload = { generatedAt: new Date().toISOString(), range, args, windows, verdict: verdict(windows) };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printReport(payload);
} finally {
  db.close();
}

function resolveRange(db: DatabaseSync, from: string | null, to: string | null) {
  const minMax = db.prepare("SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM decision_history").get() as { minDate: string | null; maxDate: string | null } | undefined;
  const end = to ?? minMax?.maxDate ?? todayTokyo();
  const start = from ?? addDays(end, -179);
  return { from: start, to: end };
}

function listRows(db: DatabaseSync, from: string, to: string): Row[] {
  if (!tableExists(db, "decision_history")) return [];
  return db.prepare(`
SELECT date, venue, race_no, decision, selection, result, returned, current_odds, ev
FROM decision_history
WHERE date >= ? AND date <= ?
ORDER BY date, venue, race_no
`).all(from, to) as Row[];
}

function buildWindows(rows: Row[], from: string, to: string, windowDays: number, stepDays: number, minBuys: number): WindowSummary[] {
  const result: WindowSummary[] = [];
  for (let start = from; start <= to; start = addDays(start, stepDays)) {
    const end = minDate(addDays(start, windowDays - 1), to);
    const windowRows = rows.filter((row) => row.date >= start && row.date <= end);
    result.push(summarizeWindow(start, end, windowRows, minBuys));
    if (end === to) break;
  }
  return result;
}

function summarizeWindow(from: string, to: string, rows: Row[], minBuys: number): WindowSummary {
  const buyRows = rows.filter((row) => row.decision === "BUY");
  const settled = buyRows.filter((row) => row.returned === 0 && row.result != null);
  const hits = settled.filter((row) => row.selection === row.result);
  const payoutOdds = hits.reduce((sum, row) => sum + (row.current_odds ?? 0), 0);
  const roi = settled.length ? payoutOdds / settled.length : null;
  const hitRate = settled.length ? hits.length / settled.length : null;
  const avgEv = average(buyRows.map((row) => row.ev));
  return { from, to, rows: rows.length, buy: buyRows.length, settledBuy: settled.length, hits: hits.length, hitRate, roi, avgEv, status: classify(settled.length, roi, hitRate, minBuys) };
}

function classify(settledBuy: number, roi: number | null, hitRate: number | null, minBuys: number): WindowSummary["status"] {
  if (settledBuy < minBuys) return "no_sample";
  if ((roi ?? 0) >= 1.05 && (hitRate ?? 0) > 0) return "pass";
  if ((roi ?? 0) >= 0.85) return "watch";
  return "fail";
}

function verdict(windows: WindowSummary[]) {
  const evaluated = windows.filter((row) => row.status !== "no_sample");
  const fail = evaluated.filter((row) => row.status === "fail").length;
  const pass = evaluated.filter((row) => row.status === "pass").length;
  const watch = evaluated.filter((row) => row.status === "watch").length;
  const avgRoi = average(evaluated.map((row) => row.roi));
  const message = evaluated.length === 0
    ? "サンプル不足。まず紙上観察を継続。"
    : fail > pass
      ? "期間別に崩れている。BUY条件を強めるか、弱い会場/レース番号をSKIP寄せ。"
      : "大きな崩れは限定的。弱いwindowだけ追加確認。";
  return { evaluatedWindows: evaluated.length, pass, watch, fail, avgRoi, message };
}

function printReport(payload: { generatedAt: string; range: { from: string; to: string }; args: Args; windows: WindowSummary[]; verdict: ReturnType<typeof verdict> }) {
  console.log("# Boat Pon walk-forward history report");
  console.log(`period: ${payload.range.from}..${payload.range.to}`);
  console.log(`windowDays=${payload.args.windowDays} stepDays=${payload.args.stepDays} minBuys=${payload.args.minBuys}`);
  console.log(`verdict: ${payload.verdict.message}`);
  console.log(`evaluated=${payload.verdict.evaluatedWindows} pass=${payload.verdict.pass} watch=${payload.verdict.watch} fail=${payload.verdict.fail} avgRoi=${fmt(payload.verdict.avgRoi)}`);
  console.log("\n| from | to | status | rows | BUY | settledBUY | hits | hitRate | ROI | avgEV |");
  console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of payload.windows) {
    console.log(`| ${row.from} | ${row.to} | ${row.status} | ${row.rows} | ${row.buy} | ${row.settledBuy} | ${row.hits} | ${pct(row.hitRate)} | ${fmt(row.roi)} | ${fmt(row.avgEv)} |`);
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { from: null, to: null, windowDays: 30, stepDays: 7, minBuys: 5, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { args.from = date(value); i += 1; }
    else if (key === "--to") { args.to = date(value); i += 1; }
    else if (key === "--window-days") { args.windowDays = positiveInt(value, key); i += 1; }
    else if (key === "--step-days") { args.stepDays = positiveInt(value, key); i += 1; }
    else if (key === "--min-buys") { args.minBuys = positiveInt(value, key); i += 1; }
    else if (key === "--json") args.json = true;
    else if (key === "--help" || key === "-h") { printUsage(); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return args;
}

function tableExists(db: DatabaseSync, table: string) { return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) != null; }
function average(values: Array<number | null>) { const finite = values.filter((value): value is number => value != null && Number.isFinite(value)); return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null; }
function date(value: string | undefined) { if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid date: ${value ?? ""}`); return value; }
function positiveInt(value: string | undefined, key: string) { const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be positive integer`); return n; }
function addDays(date: string, days: number) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
function minDate(a: string, b: string) { return a < b ? a : b; }
function todayTokyo() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function fmt(value: number | null) { return value == null ? "-" : value.toFixed(3); }
function pct(value: number | null) { return value == null ? "-" : `${(value * 100).toFixed(1)}%`; }
function printUsage() { console.log("Usage: npx tsx scripts/walk-forward-history.ts --from YYYY-MM-DD --to YYYY-MM-DD [--window-days 30] [--step-days 7] [--json]"); }
