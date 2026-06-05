/**
 * 買い方strategyのodds欠損を strict / conservative / available-only で評価する。
 * DB read-only。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-strategy-odds-coverage-review.md";
type Strategy = "original_single" | "second_third_reverse" | "first_second_third_flow" | "first_fixed_second_third_flow" | "top3_box" | "top4_box" | "box_only_when_order_uncertain";
type Mode = "available-only" | "strict" | "conservative";

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const rows = loadRows();
  const odds = loadOdds([...new Set(rows.map((r) => r.raceId))]);
  const strategies: Strategy[] = ["original_single", "second_third_reverse", "first_second_third_flow", "first_fixed_second_third_flow", "top3_box", "top4_box", "box_only_when_order_uncertain"];
  const modes: Mode[] = ["available-only", "strict", "conservative"];
  const summaries = strategies.flatMap((strategy) => modes.map((mode) => evaluate(rows, odds, strategy, mode)));
  const report = { generatedAt: new Date().toISOString(), summaries };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/bet-strategy-odds-coverage-review.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-bet-strategy-odds-coverage] wrote ${OUT_MD}`);
  console.log("[analyze-bet-strategy-odds-coverage] wrote reports/bet-strategy-odds-coverage-review.json");
} finally {
  db.close();
}

type Row = { raceId: string; selection: string; result: string; currentOdds: number; exhibitionRanks: Map<number, number> };

function loadRows(): Row[] {
  const rows = db.prepare(`
SELECT race_id, selection, result, current_odds
FROM decision_history
WHERE run_kind='historical-backfill'
  AND decision='BUY'
  AND current_odds IS NOT NULL
  AND result IS NOT NULL
`).all() as Array<{ race_id: string; selection: string; result: string; current_odds: number }>;
  const ranks = loadRanks([...new Set(rows.map((r) => r.race_id))]);
  return rows.map((r) => ({ raceId: r.race_id, selection: r.selection, result: r.result, currentOdds: Number(r.current_odds), exhibitionRanks: ranks.get(r.race_id) ?? new Map() }));
}

function evaluate(rows: Row[], odds: Map<string, number>, strategy: Strategy, mode: Mode) {
  let races = 0, generated = 0, available = 0, missing = 0, hits = 0, stake = 0, ret = 0;
  for (const row of rows) {
    const tickets = generateTickets(row, strategy);
    const withOdds = tickets.map((selection) => ({ selection, odds: selection === row.selection ? row.currentOdds : odds.get(`${row.raceId}/${selection}`) ?? null }));
    const missingCount = withOdds.filter((t) => t.odds == null).length;
    if (mode === "strict" && missingCount > 0) continue;
    races += 1;
    generated += tickets.length;
    available += withOdds.filter((t) => t.odds != null).length;
    missing += missingCount;
    const hit = withOdds.find((t) => t.selection === row.result);
    if (mode === "available-only") {
      const avail = withOdds.filter((t) => t.odds != null);
      stake += avail.length * 100;
      if (hit?.odds != null) { hits += 1; ret += hit.odds * 100; }
    } else if (mode === "conservative") {
      stake += tickets.length * 100;
      if (hit?.odds != null) { hits += 1; ret += hit.odds * 100; }
    } else {
      stake += tickets.length * 100;
      if (hit?.odds != null) { hits += 1; ret += hit.odds * 100; }
    }
  }
  return {
    strategy,
    mode,
    races,
    totalTickets: mode === "available-only" ? available : generated,
    generatedTickets: generated,
    missingTickets: missing,
    missingRate: generated ? missing / generated : 0,
    hitRaces: hits,
    hitRate: races ? hits / races : 0,
    roi: stake ? ret / stake : 0,
    stakeYen: stake,
    returnYen: ret,
    judgement: judge(mode, generated ? missing / generated : 0, stake ? ret / stake : 0),
  };
}

function judge(mode: Mode, missingRate: number, roi: number) {
  if (mode === "available-only") return "参考値。採用判断に使わない";
  if (missingRate > 0.3) return "欠損過多。本番採用不可";
  if (roi > 1) return "paper検証候補";
  return "採用不可";
}

function generateTickets(row: Row, strategy: Strategy) {
  const nums = parse(row.selection);
  const [a, b, c] = nums;
  const boats = [1, 2, 3, 4, 5, 6];
  if (strategy === "original_single") return [row.selection];
  if (strategy === "second_third_reverse") return uniq([row.selection, join([a, c, b])]);
  if (strategy === "first_second_third_flow") return uniq(boats.filter((x) => x !== a && x !== b).map((x) => join([a, b, x])));
  if (strategy === "first_fixed_second_third_flow") return uniq(boats.flatMap((s) => boats.map((t) => [a, s, t])).filter((x) => new Set(x).size === 3).map(join));
  if (strategy === "top3_box") return permutations(nums).map(join);
  if (strategy === "top4_box") {
    const next = nextBoat(row);
    return next == null ? [row.selection] : permutationsK([...nums, next], 3).map(join);
  }
  const ranks = nums.map((n) => row.exhibitionRanks.get(n)).filter((n): n is number => n != null);
  const uncertain = row.currentOdds >= 30 || (ranks.length === 3 && Math.max(...ranks) - Math.min(...ranks) <= 2);
  return uncertain ? permutations(nums).map(join) : [row.selection];
}

function loadOdds(raceIds: string[]) {
  const map = new Map<string, number>();
  for (const ids of chunks(raceIds, 500)) {
    const rows = db.prepare(`
WITH ranked AS (
  SELECT race_id, selection, odds,
         ROW_NUMBER() OVER (PARTITION BY race_id, selection ORDER BY is_final_like DESC, captured_at DESC, id DESC) AS rn
  FROM odds_snapshots
  WHERE race_id IN (${ids.map(() => "?").join(",")})
)
SELECT race_id, selection, odds FROM ranked WHERE rn=1
`).all(...ids) as Array<{ race_id: string; selection: string; odds: number }>;
    for (const row of rows) map.set(`${row.race_id}/${row.selection}`, Number(row.odds));
  }
  return map;
}

function loadRanks(raceIds: string[]) {
  const out = new Map<string, Map<number, number>>();
  for (const ids of chunks(raceIds, 500)) {
    const rows = db.prepare(`SELECT race_id, course, exhibition_time, ranking FROM exhibition_data WHERE race_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<Record<string, unknown>>;
    const byRace = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) byRace.set(String(row.race_id), [...(byRace.get(String(row.race_id)) ?? []), row]);
    for (const [raceId, rs] of byRace) {
      const ranked = rs.filter((r) => r.exhibition_time != null).sort((a, b) => Number(a.exhibition_time) - Number(b.exhibition_time));
      const m = new Map<number, number>();
      for (const r of rs) {
        const derived = ranked.findIndex((x) => Number(x.course) === Number(r.course));
        const rank = r.ranking == null ? (derived >= 0 ? derived + 1 : null) : Number(r.ranking);
        if (rank != null) m.set(Number(r.course), rank);
      }
      out.set(raceId, m);
    }
  }
  return out;
}

function renderMarkdown(report: { summaries: Array<ReturnType<typeof evaluate>> }) {
  const lines = [
    "# bet strategy odds coverage review",
    "",
    "## mode定義",
    "- strict: 必要ticketのoddsが1つでも欠損したraceは評価から除外",
    "- conservative: 欠損ticketも投資した扱い。的中してもodds不明なら回収0",
    "- available-only: oddsがあるticketだけ買った扱い。参考値で採用判断には使わない",
    "",
    "| strategy | mode | races | total_tickets | missing_rate | hit_rate | ROI | 判定 |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const s of report.summaries) lines.push(`| ${s.strategy} | ${s.mode} | ${s.races} | ${s.totalTickets} | ${pct(s.missingRate)} | ${pct(s.hitRate)} | ${fmt(s.roi)} | ${s.judgement} |`);
  lines.push("");
  lines.push("## 結論");
  lines.push("- available-onlyで微改善しても、strict/conservativeで崩れるなら本番採用不可。");
  lines.push("- odds_snapshotsが全120点を保持していない限り、BOX/流しのROI評価は過大評価される可能性があります。");
  return `${lines.join("\n")}\n`;
}

function parse(s: string) { return s.split("-").map(Number); }
function join(xs: number[]) { return xs.join("-"); }
function uniq<T>(xs: T[]) { return [...new Set(xs)]; }
function nextBoat(row: Row) {
  const used = new Set(parse(row.selection));
  const ranked = [...row.exhibitionRanks.entries()].filter(([b]) => !used.has(b)).sort((a, b) => a[1] - b[1]);
  return ranked[0]?.[0] ?? [1, 2, 3, 4, 5, 6].find((b) => !used.has(b)) ?? null;
}
function permutations(xs: number[]): number[][] { return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])); }
function permutationsK(xs: number[], k: number): number[][] { return k <= 0 ? [[]] : xs.flatMap((x, i) => permutationsK([...xs.slice(0, i), ...xs.slice(i + 1)], k - 1).map((p) => [x, ...p])); }
function chunks<T>(xs: T[], size: number) { const out: T[][] = []; for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size)); return out; }
function fmt(v: number) { return Number.isFinite(v) ? v.toFixed(3) : "-"; }
function pct(v: number) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "-"; }
