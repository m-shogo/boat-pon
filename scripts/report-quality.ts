import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Row = { date: string; venue: string; race_no: number; decision: string; selection: string; result: string | null; returned: number; current_odds: number | null; required_odds: number | null; ev: number | null; sample_size?: number | null };
type Summary = { rows: number; buy: number; watch: number; skip: number; settledBuy: number; hits: number; hitRate: number | null; roi: number | null; avgEv: number | null; avgOddsRatio: number | null };
type Group = Summary & { key: string };
type WeakSignal = { key: string; settledBuy: number; roi: number | null; reason: string };

type QualityReport = {
  rows: number;
  summary: Summary;
  byBand: Group[];
  byVenue: Group[];
  byRaceNo: Group[];
  weakSignals: WeakSignal[];
  ruleSuggestions: string[];
};

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const parsed = parseArgs(process.argv.slice(2));
const to = parsed.to ?? todayTokyo();
const from = parsed.from ?? addDays(to, -(parsed.days - 1));

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
try {
  const rows = listRows(db, from, to);
  const report = buildReport(rows);
  if (parsed.json) console.log(JSON.stringify({ generatedAt: new Date().toISOString(), from, to, ...report }, null, 2));
  else printReport(from, to, report);
} finally {
  db.close();
}

function listRows(db: DatabaseSync, from: string, to: string): Row[] {
  if (!tableExists(db, "decision_history")) return [];
  const sample = hasColumn(db, "decision_history", "sample_size") ? "sample_size" : "0 AS sample_size";
  return db.prepare(`
SELECT date, venue, race_no, decision, selection, result, returned, current_odds, required_odds, ev, ${sample}
FROM decision_history
WHERE date >= ? AND date <= ?
ORDER BY date, venue, race_no
`).all(from, to) as Row[];
}

function buildReport(rows: Row[]): QualityReport {
  const byBand = groups(rows, signalBand).sort((a, b) => bandOrder(a.key) - bandOrder(b.key));
  const byVenue = groups(rows, (r) => r.venue).sort((a, b) => b.settledBuy - a.settledBuy || (a.roi ?? 999) - (b.roi ?? 999)).slice(0, 24);
  const byRaceNo = groups(rows, (r) => `${r.race_no}R`).sort((a, b) => Number.parseInt(a.key) - Number.parseInt(b.key));
  const weakSignals = [...byBand, ...byVenue, ...byRaceNo]
    .filter((g) => g.settledBuy >= 5 && (g.roi == null || g.roi < 1 || g.hitRate === 0))
    .sort((a, b) => (a.roi ?? -1) - (b.roi ?? -1))
    .slice(0, 8)
    .map((g) => ({ key: g.key, settledBuy: g.settledBuy, roi: g.roi, reason: g.hitRate === 0 ? "zero hit" : "ROI below 1" }));
  const draftReport = { rows: rows.length, summary: summarize(rows), byBand, byVenue, byRaceNo, weakSignals };
  return { ...draftReport, ruleSuggestions: buildRuleSuggestions(draftReport) };
}

function signalBand(row: Row) {
  if (row.decision === "BUY") {
    const ratio = oddsRatio(row) ?? 0;
    const sample = Number(row.sample_size ?? 0);
    if (sample >= 100 && ((row.ev ?? 0) >= 1.25 || ratio >= 1.5)) return "S";
    if (sample >= 50 && ((row.ev ?? 0) >= 1.1 || ratio >= 1.2)) return "A";
    return "B";
  }
  if (row.decision === "WATCH") return "C/WATCH";
  if (row.decision === "SKIP") return "SKIP";
  return row.decision || "UNKNOWN";
}

function groups(rows: Row[], keyFor: (row: Row) => string): Group[] {
  const map = new Map<string, Row[]>();
  for (const row of rows) map.set(keyFor(row), [...(map.get(keyFor(row)) ?? []), row]);
  return [...map.entries()].map(([key, value]) => ({ key, ...summarize(value) }));
}

function summarize(rows: Row[]): Summary {
  const buyRows = rows.filter((r) => r.decision === "BUY");
  const settled = buyRows.filter((r) => r.returned === 0 && r.result != null);
  const hits = settled.filter((r) => r.selection === r.result);
  const payoutOdds = hits.reduce((sum, r) => sum + (r.current_odds ?? 0), 0);
  return {
    rows: rows.length,
    buy: buyRows.length,
    watch: rows.filter((r) => r.decision === "WATCH").length,
    skip: rows.filter((r) => r.decision === "SKIP").length,
    settledBuy: settled.length,
    hits: hits.length,
    hitRate: settled.length ? hits.length / settled.length : null,
    roi: settled.length ? payoutOdds / settled.length : null,
    avgEv: avg(rows.map((r) => r.ev)),
    avgOddsRatio: avg(rows.map(oddsRatio)),
  };
}

function buildRuleSuggestions(report: Omit<QualityReport, "ruleSuggestions">) {
  const suggestions = new Set<string>();

  for (const signal of report.weakSignals) {
    if (signal.key === "B") {
      suggestions.add("B帯は通知対象外候補。WATCH以下に寄せる。");
      continue;
    }
    if (signal.key === "A") {
      suggestions.add("A帯はdry-run継続候補。S帯との差を週次・月次で再確認する。");
      continue;
    }
    if (signal.key === "S") {
      suggestions.add("S帯が弱い。S条件の過学習、オッズ閾値、sample_size条件を再確認する。");
      continue;
    }
    if (/^\d+R$/.test(signal.key)) {
      suggestions.add(`${signal.key} はWATCH止まり候補。レース番号別で再確認する。`);
      continue;
    }
    if (signal.key === "C/WATCH" || signal.key === "SKIP") {
      suggestions.add(`${signal.key} は通知対象外を維持。BUYへ昇格しない。`);
      continue;
    }
    suggestions.add(`${signal.key} はS条件のみ通知候補。A/Bは通知対象外に寄せる。`);
  }

  const b = report.byBand.find((row) => row.key === "B");
  if (b && b.settledBuy >= 5 && (b.roi == null || b.roi < 1)) {
    suggestions.add("B帯はROIが弱いため、通知ではなくWATCHまたはSKIP寄せを検討する。");
  }

  const s = report.byBand.find((row) => row.key === "S");
  const a = report.byBand.find((row) => row.key === "A");
  if (s?.roi != null && a?.roi != null && s.settledBuy >= 5 && a.settledBuy >= 5 && s.roi < a.roi) {
    suggestions.add("S帯がA帯より弱い。S条件が狭すぎて過学習していないか確認する。");
  }

  if (report.summary.settledBuy < 20) {
    suggestions.add("確定BUYが20件未満。ルール変更は急がず、紙上観察を継続する。");
  }

  if (suggestions.size === 0) {
    suggestions.add("大きな弱点は未検出。サンプルが増えるまで現行ルールを維持する。");
  }

  return [...suggestions];
}

function printReport(from: string, to: string, report: QualityReport) {
  console.log("# Boat Pon quality report");
  console.log(`period: ${from}..${to}`);
  console.log(line("overall", report.summary));
  printTable("By signal band", report.byBand);
  printTable("By venue", report.byVenue);
  printTable("By race number", report.byRaceNo);
  console.log("\n## Weak signals");
  if (report.weakSignals.length === 0) console.log("- No obvious weak signals yet. Recheck after sample size grows.");
  for (const s of report.weakSignals) console.log(`- ${s.key}: ${s.reason} settledBUY=${s.settledBuy} ROI=${fmt(s.roi)}`);
  console.log("\n## Rule suggestions");
  for (const suggestion of report.ruleSuggestions) console.log(`- ${suggestion}`);
}

function printTable(title: string, rows: Group[]) {
  console.log(`\n## ${title}`);
  console.log("| key | rows | BUY | WATCH | SKIP | settledBUY | hits | hitRate | ROI | avgEV | avgOddsRatio |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) console.log(`| ${r.key} | ${r.rows} | ${r.buy} | ${r.watch} | ${r.skip} | ${r.settledBuy} | ${r.hits} | ${pct(r.hitRate)} | ${fmt(r.roi)} | ${fmt(r.avgEv)} | ${fmt(r.avgOddsRatio)} |`);
}

function line(label: string, s: Summary) {
  return `${label}: rows=${s.rows} BUY=${s.buy} WATCH=${s.watch} SKIP=${s.skip} settledBUY=${s.settledBuy} hits=${s.hits} hitRate=${pct(s.hitRate)} ROI=${fmt(s.roi)} avgEV=${fmt(s.avgEv)} avgOddsRatio=${fmt(s.avgOddsRatio)}`;
}
function oddsRatio(row: Row) { return row.current_odds != null && row.required_odds != null && row.required_odds > 0 ? row.current_odds / row.required_odds : null; }
function avg(values: Array<number | null>) { const v = values.filter((n): n is number => n != null && Number.isFinite(n)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function fmt(n: number | null) { return n == null ? "-" : n.toFixed(3); }
function pct(n: number | null) { return n == null ? "-" : `${(n * 100).toFixed(1)}%`; }
function bandOrder(key: string) { const order = ["S", "A", "B", "C/WATCH", "SKIP"]; const i = order.indexOf(key); return i === -1 ? 99 : i; }
function tableExists(db: DatabaseSync, table: string) { return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) != null; }
function hasColumn(db: DatabaseSync, table: string, column: string) { return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((r) => r.name === column); }
function todayTokyo() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function addDays(date: string, days: number) { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
function parseArgs(argv: string[]) { const parsed = { from: null as string | null, to: null as string | null, days: 7, json: false }; for (let i = 0; i < argv.length; i += 1) { const k = argv[i], v = argv[i + 1]; if (k === "--from") { parsed.from = date(v); i += 1; } else if (k === "--to") { parsed.to = date(v); i += 1; } else if (k === "--days") { parsed.days = Number(v); i += 1; } else if (k === "--json") parsed.json = true; else if (k === "--help") { console.log("Usage: npm run report:quality -- --from YYYY-MM-DD --to YYYY-MM-DD [--json]"); process.exit(0); } else throw new Error(`unknown option: ${k}`); } return parsed; }
function date(v: string | undefined) { if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`invalid date: ${v ?? ""}`); return v; }
