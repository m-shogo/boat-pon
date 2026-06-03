/**
 * decision_history の空の decision_reasons を既存カラムから補完する。
 *
 * 目的:
 * - 新しい保存接続が入る前の過去履歴でも、理由別レポートを使えるようにする
 * - 既存行の削除はしない
 * - 外部アクセスなし
 *
 * 注意:
 * - judgeCandidate の完全再現ではない
 * - 履歴分析用の近似理由
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(DB_PATH)) {
  console.error(`[fill-decision-reasons] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 10000");

try {
  ensureColumns();
  const rows = loadRows();
  const stmt = db.prepare("UPDATE decision_history SET decision_reasons = ? WHERE id = ?");

  let changed = 0;
  for (const row of rows) {
    const reasons = inferReasons(row);
    if (args.dryRun) {
      console.log(`[dry-run] id=${row.id} ${row.date} ${row.venue}${row.race_no}R ${row.decision}: ${reasons.join(" / ")}`);
    } else {
      stmt.run(JSON.stringify(reasons), row.id);
    }
    changed += 1;
  }

  console.log(`[fill-decision-reasons] rows=${rows.length} changed=${changed} dryRun=${args.dryRun}`);
} finally {
  db.close();
}

type Row = {
  id: number;
  date: string;
  venue: string;
  race_no: number;
  decision: string;
  current_odds: number | null;
  required_odds: number | null;
  ev: number | null;
  sample_size: number | null;
  run_kind: string | null;
  sharp_signal_drop: number | null;
  environment_risk_level: string | null;
  selection_popularity: number | null;
};

function loadRows(): Row[] {
  const where = ["1=1"];
  const params: Array<string | number> = [];

  if (!args.force) where.push("(decision_reasons IS NULL OR decision_reasons = '[]')");
  if (args.from) { where.push("date >= ?"); params.push(args.from); }
  if (args.to) { where.push("date <= ?"); params.push(args.to); }
  if (args.decision) { where.push("decision = ?"); params.push(args.decision); }
  params.push(args.limit);

  return db.prepare(`
SELECT id, date, venue, race_no, decision, current_odds, required_odds, ev,
       sample_size, run_kind, sharp_signal_drop, environment_risk_level, selection_popularity
FROM decision_history
WHERE ${where.join(" AND ")}
ORDER BY date ASC, id ASC
LIMIT ?
`).all(...params) as Row[];
}

function inferReasons(row: Row): string[] {
  const reasons: string[] = [];

  if (row.decision === "BUY") reasons.push("decision=BUY");
  else if (row.decision === "WATCH") reasons.push("decision=WATCH");
  else if (row.decision === "SKIP") reasons.push("decision=SKIP");
  else reasons.push(`decision=${row.decision}`);

  if (row.current_odds == null) reasons.push("odds:missing");
  if (row.sample_size != null && row.sample_size < 30) reasons.push("sample:small");
  if (row.current_odds != null && row.current_odds >= 100) reasons.push("odds:very-high");
  if (row.required_odds != null && row.required_odds >= 100) reasons.push("required-odds:very-high");

  if (row.current_odds != null && row.required_odds != null && row.required_odds > 0) {
    const ratio = row.current_odds / row.required_odds;
    if (ratio < 1) reasons.push("market:below-required");
    else if (ratio >= 2) reasons.push("market:two-times-required");
    else if (ratio >= 1.5) reasons.push("market:one-point-five-times-required");
  }

  if (row.ev != null && row.ev < 1) reasons.push("ev:below-1");
  else if (row.ev != null && row.ev < 1.25) reasons.push("ev:below-target");
  else if (row.ev != null) reasons.push("ev:target-or-higher");

  if (row.sharp_signal_drop != null && row.sharp_signal_drop >= 0.15) reasons.push("market:late-drop");
  if (row.environment_risk_level === "high") reasons.push("environment:high-risk");
  if (row.environment_risk_level === "medium") reasons.push("environment:medium-risk");
  if (row.selection_popularity != null && row.selection_popularity <= 3) reasons.push("popularity:top3");
  if (row.selection_popularity != null && row.selection_popularity >= 30) reasons.push("popularity:longshot");
  if (row.run_kind) reasons.push(`run:${row.run_kind}`);

  return [...new Set(reasons)];
}

function ensureColumns() {
  addColumn("decision_reasons", "TEXT NOT NULL DEFAULT '[]'");
}

function addColumn(column: string, definition: string) {
  if (columnExists(column)) return;
  db.exec(`ALTER TABLE decision_history ADD COLUMN ${column} ${definition}`);
  console.log(`[fill-decision-reasons] added column: ${column}`);
}

function columnExists(column: string): boolean {
  const rows = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function parseArgs(argv: string[]) {
  const parsed = {
    from: null as string | null,
    to: null as string | null,
    decision: null as string | null,
    limit: 100000,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--decision") { parsed.decision = String(value ?? "").toUpperCase(); i += 1; }
    else if (key === "--limit") { parsed.limit = Math.max(1, Number(value)); i += 1; }
    else if (key === "--dry-run") parsed.dryRun = true;
    else if (key === "--force") parsed.force = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }

  return parsed;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value ?? ""}`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/fill-decision-reasons.ts -- --dry-run
  pnpm exec tsx scripts/fill-decision-reasons.ts -- --from YYYY-MM-DD --to YYYY-MM-DD

Options:
  --dry-run      Show changes only
  --force        Recreate reasons even when decision_reasons already exists
  --decision X   BUY, WATCH, or SKIP
  --limit N      Max rows
`);
}
