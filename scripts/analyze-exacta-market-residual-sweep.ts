/**
 * analyze-exacta-market-residual-sweep.ts — 読み取り専用 (DB write なし)
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標。購入推奨ではない。
 * historical closing odds は live/T-5/timeseries odds ではない。
 *
 * 目的: exacta closing odds 全30通りDBを使って market residual を区分別に計測する。
 *   新しい BUY ルールを作ることではなく、市場がどの条件でズレるかを発見すること。
 *
 * edge_pp = actual_rate - avg_normalized_implied (正ならその区分で市場が過小評価)
 * realized_roi = (当選時の払戻合計) / (全ベット × 100)
 * max1hit_excl_roi = 最大払戻1件を除いた realized_roi
 *
 * 探索軸:
 *   1. exacta combination 全30通り (どの組番が歪んでいるか)
 *   2. odds帯 (1-4 の closing odds 帯別)
 *   3. venue別
 *   4. race_no別
 *   5. venue × combination
 *   6. race_no × combination
 *   7. wind_speed帯 × combination
 *   8. 展示1号艇 exhibition_time ranking × combination
 *
 * 出力: reports/exacta-market-residual-sweep.{md,json}
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/exacta-market-residual-sweep.md";
const OUT_JSON = "reports/exacta-market-residual-sweep.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// 主評価: 通常6艇・F返還なし (exacta 30通り保存済み)
// 欠場あり (COUNT=20) は除外
const HELDOUT_END   = "2024-12-31";
const FORWARD_START = "2025-01-01";

const MIN_N = 30;  // 区分の最小レース数 (これ未満はスキップ)

console.log("=== exacta market residual sweep ===\n");
console.log("目的: 市場がどの条件でズレるかを発見する (新BUYルール作成ではない)\n");

// ─── ベースデータ取得 ─────────────────────────────────────────────────────────

// 各レース × 各組番 のレコードを取得
// overroundは race ごとに全組番 (odds>0) の sum(1/odds) で計算
type RaceComboRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  combo: string;             // この組番 (例: "1-4")
  odds: number;              // この組番の closing odds
  overround: number;         // レース全体の overround
  normalized_implied: number; // (1/odds) / overround
  is_winner: number;         // 1 if this combo won
  payout_yen: number | null; // 当選払戻 (winner のみ)
  wind_speed: number | null;
  exh1_ranking: number | null; // 1号艇の展示タイム順位 (1=最速)
};

// 重いのでメモリ上でやる: まずレース単位でデータを集め、TypeScriptで集計
type RaceBase = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  overround: number;
  winning_combo: string | null;
  payout_yen: number | null;
  wind_speed: number | null;
  exh1_ranking: number | null;
  is_f: number;
  combo_count: number;
};

type ComboOdds = { race_id: string; combo: string; odds: number };

console.log("データ取得中...");

// レース基本情報
const raceRows = db.prepare(`
  SELECT
    hao.race_id,
    hao.race_date as date,
    hao.venue,
    hao.race_no,
    SUM(CASE WHEN hao.odds > 0 THEN 1.0/hao.odds ELSE 0 END) as overround,
    COUNT(*) as combo_count,
    rp.combination as winning_combo,
    rp.payout_yen,
    rw.wind_speed_mps as wind_speed,
    ed1.ranking as exh1_ranking,
    COALESCE((
      SELECT COUNT(*) FROM race_entries re
      WHERE re.race_id = hao.race_id AND re.status_code='F'
    ), 0) as is_f
  FROM historical_alternative_odds hao
  LEFT JOIN race_payouts rp ON rp.race_id = hao.race_id AND rp.bet_type='exacta'
  LEFT JOIN race_weather rw ON rw.race_id = hao.race_id
  LEFT JOIN (
    SELECT race_id, ranking FROM exhibition_data WHERE course=1
  ) ed1 ON ed1.race_id = hao.race_id
  WHERE hao.bet_type='exacta'
  GROUP BY hao.race_id
  HAVING COUNT(*) = 30 AND COALESCE(is_f, 0) = 0
`).all() as RaceBase[];

// 各組番の odds
const comboRows = db.prepare(`
  SELECT hao.race_id, hao.combination as combo, hao.odds
  FROM historical_alternative_odds hao
  WHERE hao.bet_type='exacta'
`).all() as ComboOdds[];

// race_id → 組番→odds のマップ
const oddsMap = new Map<string, Map<string, number>>();
for (const row of comboRows) {
  if (!oddsMap.has(row.race_id)) oddsMap.set(row.race_id, new Map());
  oddsMap.get(row.race_id)!.set(row.combo, row.odds);
}

// 通常6艇レース (F返還なし, combo_count=30)
const normalRaces = raceRows.filter(r => r.combo_count === 30 && r.is_f === 0);
const heldoutRaces  = normalRaces.filter(r => r.date <= HELDOUT_END);
const forwardRaces  = normalRaces.filter(r => r.date >= FORWARD_START);

console.log(`通常レース: ${normalRaces.length}件 (held-out: ${heldoutRaces.length} / forward: ${forwardRaces.length})\n`);

// ─── 集計関数 ─────────────────────────────────────────────────────────────────

type SweepResult = {
  dimension: string;
  group: string;
  combo: string;
  n: number;
  hits: number;
  actual_rate: number;
  avg_normalized_implied: number;
  edge_pp: number;       // actual_rate - avg_normalized_implied (正 = 市場過小評価)
  realized_roi: number;  // (当選払戻合計) / (n * 100)
  max1hit_excl_roi: number; // 最大払戻1件除外
  avg_odds: number;
  period: string;
};

function sweep(
  races: RaceBase[],
  combo: string,
  dimension: string,
  groupFn: (r: RaceBase) => string | null,
  period: string
): SweepResult[] {
  const groups = new Map<string, RaceBase[]>();
  for (const r of races) {
    const g = groupFn(r);
    if (g === null) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  const results: SweepResult[] = [];
  for (const [group, groupRaces] of groups) {
    if (groupRaces.length < MIN_N) continue;

    let totalImplied = 0;
    let validImplied = 0;
    let hits = 0;
    let totalPayout = 0;
    let maxPayout = 0;
    let maxPayoutRace = "";
    let totalOdds = 0;

    for (const r of groupRaces) {
      const comboMap = oddsMap.get(r.race_id);
      const odds = comboMap?.get(combo);
      if (odds != null && odds > 0 && r.overround > 0) {
        totalImplied += (1.0 / odds) / r.overround;
        totalOdds += odds;
        validImplied++;
      }
      if (r.winning_combo === combo) {
        hits++;
        const payout = r.payout_yen ?? 0;
        totalPayout += payout;
        if (payout > maxPayout) { maxPayout = payout; maxPayoutRace = r.race_id; }
      }
    }

    const n = groupRaces.length;
    const actualRate = hits / n;
    const avgImplied = validImplied > 0 ? totalImplied / validImplied : 0;
    const edgePp    = (actualRate - avgImplied) * 100;
    const realizedRoi = totalPayout / (n * 100);
    const max1exclRoi = (totalPayout - maxPayout) / ((n - 1) * 100);

    results.push({
      dimension, group, combo, n, hits,
      actual_rate: actualRate,
      avg_normalized_implied: avgImplied,
      edge_pp: edgePp,
      realized_roi: realizedRoi,
      max1hit_excl_roi: max1exclRoi,
      avg_odds: validImplied > 0 ? totalOdds / validImplied : 0,
      period,
    });
  }
  return results.sort((a, b) => b.edge_pp - a.edge_pp);
}

// ─── wind 帯分類 ──────────────────────────────────────────────────────────────

function windBand(ws: number | null): string | null {
  if (ws == null) return null;
  if (ws < 1)  return "0-1m";
  if (ws < 2)  return "1-2m";
  if (ws < 3)  return "2-3m";
  if (ws < 4)  return "3-4m";
  if (ws < 6)  return "4-6m";
  return "6m+";
}

// odds帯分類 (1-4 の closing odds ベース)
function oddsBand(r: RaceBase, combo: string): string | null {
  const odds = oddsMap.get(r.race_id)?.get(combo);
  if (odds == null) return null;
  if (odds < 5)   return "01-05";
  if (odds < 10)  return "05-10";
  if (odds < 20)  return "10-20";
  if (odds < 30)  return "20-30";
  if (odds < 50)  return "30-50";
  return "50+";
}

// ─── 各次元の集計 ─────────────────────────────────────────────────────────────

const allResults: SweepResult[] = [];
const combos30 = [...new Set(comboRows.map(c => c.combo))].sort();
const h011Combos = ["1-2", "1-3", "1-4"] as const;

for (const period of ["all", "heldout", "forward"] as const) {
  const races = period === "heldout" ? heldoutRaces : period === "forward" ? forwardRaces : normalRaces;

  // 1. 全30通り (全体)
  for (const combo of combos30) {
    const r = sweep(races, combo, "combination", () => combo, period);
    allResults.push(...r);
  }

  // 2. H011対象 odds帯別
  for (const combo of h011Combos) {
    const r = sweep(races, combo, "odds_band", rr => oddsBand(rr, combo), period);
    allResults.push(...r);
  }

  // 3. venue別 × H011対象combo
  for (const combo of h011Combos) {
    const r = sweep(races, combo, "venue", rr => rr.venue, period);
    allResults.push(...r);
  }

  // 4. race_no別 × H011対象combo
  for (const combo of h011Combos) {
    const r = sweep(races, combo, "race_no", rr => String(rr.race_no), period);
    allResults.push(...r);
  }

  // 5. wind帯 × H011対象combo
  for (const combo of h011Combos) {
    const r = sweep(races, combo, "wind_band", rr => windBand(rr.wind_speed), period);
    allResults.push(...r);
  }

  // 6. exh1_ranking × H011対象combo
  for (const combo of h011Combos) {
    const r = sweep(races, combo, "exh1_rank", rr =>
      rr.exh1_ranking != null ? String(rr.exh1_ranking) : null, period);
    allResults.push(...r);
  }
}

// ─── 結果フィルタ & ソート ────────────────────────────────────────────────────

function filterStrong(rows: SweepResult[], minN = 50) {
  return rows.filter(r => r.edge_pp >= 3.0 && r.realized_roi >= 0.80 && r.max1hit_excl_roi >= 0.75 && r.n >= minN)
    .sort((a, b) => b.edge_pp - a.edge_pp);
}
function filterWatch(rows: SweepResult[], strong: SweepResult[], minN = 50) {
  return rows.filter(r =>
    r.edge_pp >= 2.0 && r.n >= minN &&
    !strong.some(s => s.dimension === r.dimension && s.group === r.group && s.combo === r.combo)
  ).sort((a, b) => b.edge_pp - a.edge_pp);
}

const allPeriod     = allResults.filter(r => r.period === "all");
const heldoutPeriod = allResults.filter(r => r.period === "heldout");
const forwardPeriod = allResults.filter(r => r.period === "forward");

const strong     = filterStrong(allPeriod);
const watch      = filterWatch(allPeriod, strong);
const fwStrong   = filterStrong(forwardPeriod, 30);
const fwWatch    = filterWatch(forwardPeriod, fwStrong, 30);
const hoStrong   = filterStrong(heldoutPeriod);
const hoWatch    = filterWatch(heldoutPeriod, hoStrong);
const heldoutProfitScreens = heldoutPeriod.filter(r =>
  r.edge_pp >= 2 && r.realized_roi >= 1 && r.max1hit_excl_roi >= 0.90 && r.n >= 100
);
const forwardByKey = new Map(forwardPeriod.map(r => [`${r.dimension}\0${r.group}\0${r.combo}`, r]));
const replicationChecks = heldoutProfitScreens.map(discovery => ({
  discovery,
  forward: forwardByKey.get(`${discovery.dimension}\0${discovery.group}\0${discovery.combo}`) ?? null,
}));
const replicatedProfitEdges = replicationChecks.filter(({ forward }) =>
  forward != null && forward.n >= 200 && forward.realized_roi >= 1 && forward.max1hit_excl_roi >= 1 && forward.edge_pp > 0
);

// combination次元のみ全結果
const comboAll = allPeriod
  .filter(r => r.dimension === "combination")
  .sort((a, b) => b.edge_pp - a.edge_pp);

// ─── 出力 ─────────────────────────────────────────────────────────────────────

const fmt = (v: number, d = 2) => v.toFixed(d);
const pct = (v: number) => (v * 100).toFixed(2) + "%";
const roi = (v: number) => (v * 100).toFixed(1) + "%";

console.log("=== 1. 全30通り combination × 全期間 (edge_pp 降順) ===\n");
console.log(`  combo  | n    | hits | actual | implied | edge_pp | roi   | roi_max1x | avg_odds`);
console.log(`  -------|------|------|--------|---------|---------|-------|-----------|----------`);
for (const r of comboAll.slice(0, 15)) {
  console.log(`  ${r.combo.padEnd(6)} | ${r.n} | ${r.hits.toString().padStart(4)} | ${pct(r.actual_rate).padStart(6)} | ${pct(r.avg_normalized_implied).padStart(7)} | ${fmt(r.edge_pp).padStart(5)}pt | ${roi(r.realized_roi).padStart(5)} | ${roi(r.max1hit_excl_roi).padStart(9)} | ${r.avg_odds.toFixed(1)}`);
}
console.log();

console.log("=== 2. 全期間post-hoc screen（採用禁止） ===\n");
if (strong.length === 0) {
  console.log("  (なし)\n");
} else {
  for (const r of strong.slice(0, 20)) {
    console.log(`  [${r.dimension}] ${r.group} / ${r.combo}: edge=${fmt(r.edge_pp)}pt roi=${roi(r.realized_roi)} max1x=${roi(r.max1hit_excl_roi)} n=${r.n}`);
  }
  console.log();
}

console.log("=== 3. 全期間post-hoc watch（採用禁止） ===\n");
if (watch.length === 0) {
  console.log("  (なし)\n");
} else {
  for (const r of watch.slice(0, 30)) {
    console.log(`  [${r.dimension}] ${r.group} / ${r.combo}: edge=${fmt(r.edge_pp)}pt roi=${roi(r.realized_roi)} max1x=${roi(r.max1hit_excl_roi)} n=${r.n}`);
  }
  console.log();
}

// H011対象3組番の次元別詳細
console.log("=== 4. forward期post-hoc screen（仮説生成専用） ===\n");
if (fwStrong.length === 0) {
  console.log("  (なし)\n");
} else {
  for (const r of fwStrong.slice(0, 20)) {
    console.log(`  [${r.dimension}] ${r.group} / ${r.combo}: edge=${fmt(r.edge_pp)}pt roi=${roi(r.realized_roi)} max1x=${roi(r.max1hit_excl_roi)} n=${r.n}`);
  }
  console.log();
}

console.log("=== 5. forward期post-hoc watch（仮説生成専用） ===\n");
if (fwWatch.length === 0) {
  console.log("  (なし)\n");
} else {
  for (const r of fwWatch.slice(0, 20)) {
    console.log(`  [${r.dimension}] ${r.group} / ${r.combo}: edge=${fmt(r.edge_pp)}pt roi=${roi(r.realized_roi)} max1x=${roi(r.max1hit_excl_roi)} n=${r.n}`);
  }
  console.log();
}

console.log("=== 6. heldout発見 → forward利益再現ゲート ===\n");
console.log(`  discovery screens=${heldoutProfitScreens.length} / replicated=${replicatedProfitEdges.length}`);
console.log("  gate: forward n>=200, ROI>=100%, max1hit-excl ROI>=100%, edge>0");
if (replicatedProfitEdges.length === 0) console.log("  verified edge: なし\n");
for (const { discovery, forward } of replicatedProfitEdges) {
  console.log(`  [${discovery.dimension}] ${discovery.group} / ${discovery.combo}: heldout=${roi(discovery.realized_roi)} n=${discovery.n} -> forward=${roi(forward!.realized_roi)} max1x=${roi(forward!.max1hit_excl_roi)} n=${forward!.n}`);
}
console.log();

console.log("=== 7. H011対象 (1-2/1-3/1-4) 次元別トップ（post-hoc） ===\n");
for (const combo of h011Combos) {
  const dims = ["odds_band", "venue", "race_no", "wind_band", "exh1_rank"] as const;
  console.log(`  [${combo}] 各次元 top3:`);
  for (const dim of dims) {
    const top = allPeriod
      .filter(r => r.combo === combo && r.dimension === dim && r.n >= MIN_N)
      .sort((a, b) => b.edge_pp - a.edge_pp)
      .slice(0, 3);
    if (top.length === 0) continue;
    console.log(`    ${dim}:`);
    for (const r of top) {
      console.log(`      ${r.group.padEnd(12)}: edge=${fmt(r.edge_pp)}pt roi=${roi(r.realized_roi)} max1x=${roi(r.max1hit_excl_roi)} n=${r.n}`);
    }
  }
  console.log();
}

// ─── レポート出力 ─────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];
lines.push(`# exacta market residual sweep`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(`> **保存済みexactaレースだけの分析であり、公式開催全体を代表しない。decision_history/BUYでは追加抽出しない。**`);
lines.push(`> **本分析は新BUYルール作成ではなく市場の歪み探索が目的。本番採用しない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 概要`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 分析対象 | 通常6艇・F返還なし / exacta全30通り保存済み |`);
lines.push(`| レース数 | ${normalRaces.length}件 (held-out ${heldoutRaces.length} / forward ${forwardRaces.length}) |`);
lines.push(`| edge_pp | actual_rate - avg_normalized_implied (正 = 市場過小評価) |`);
lines.push(`| realized_roi | (当選払戻合計) / (n × 100) |`);
lines.push(`| max1hit_excl_roi | 最大払戻1件除外後の realized_roi |`);
lines.push(`| MIN_N | ${MIN_N}件 (これ未満の区分はスキップ) |`);
lines.push(``);

lines.push(`## 1. 全30通り combination別 (全期間, edge_pp降順)`);
lines.push(``);
lines.push(`| combo | n | hits | actual_rate | implied | edge_pp | roi | max1hit_excl | avg_odds |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of comboAll) {
  lines.push(`| ${r.combo} | ${r.n} | ${r.hits} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${r.avg_odds.toFixed(1)} |`);
}
lines.push(``);

lines.push(`## 2. 全期間post-hoc screen（採用禁止）`);
lines.push(``);
if (strong.length === 0) {
  lines.push(`*strong候補なし*`);
} else {
  lines.push(`| dimension | group | combo | n | edge_pp | roi | max1hit_excl | actual | implied |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of strong.slice(0, 30)) {
    lines.push(`| ${r.dimension} | ${r.group} | ${r.combo} | ${r.n} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} |`);
  }
}
lines.push(``);

lines.push(`## 3. 全期間post-hoc watch（採用禁止）`);
lines.push(``);
if (watch.length === 0) {
  lines.push(`*watch候補なし*`);
} else {
  lines.push(`| dimension | group | combo | n | edge_pp | roi | max1hit_excl | actual | implied |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of watch.slice(0, 50)) {
    lines.push(`| ${r.dimension} | ${r.group} | ${r.combo} | ${r.n} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} |`);
  }
}
lines.push(``);

lines.push(`## 4. forward期post-hoc screen（仮説生成専用）`);
lines.push(``);
if (fwStrong.length === 0) {
  lines.push(`*forward期 strong候補なし*`);
} else {
  lines.push(`| dimension | group | combo | n | edge_pp | roi | max1hit_excl | actual | implied |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of fwStrong.slice(0, 30)) {
    lines.push(`| ${r.dimension} | ${r.group} | ${r.combo} | ${r.n} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} |`);
  }
}
lines.push(``);

lines.push(`## 5. forward期post-hoc watch（仮説生成専用）`);
lines.push(``);
if (fwWatch.length === 0) {
  lines.push(`*forward期 watch候補なし*`);
} else {
  lines.push(`| dimension | group | combo | n | edge_pp | roi | max1hit_excl | actual | implied |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of fwWatch.slice(0, 30)) {
    lines.push(`| ${r.dimension} | ${r.group} | ${r.combo} | ${r.n} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} |`);
  }
}
lines.push(``);

lines.push(`## 6. heldout発見 → forward利益再現ゲート`);
lines.push(``);
lines.push(`事前側screen: ${heldoutProfitScreens.length}件。採用ゲートは forward n≥200、ROI≥100%、最大1hit除外ROI≥100%、edge>0。`);
lines.push(``);
if (replicatedProfitEdges.length === 0) {
  lines.push(`**再現確認済みedgeなし。**`);
} else {
  lines.push(`| dimension | group | combo | heldout n / ROI | forward n / ROI / max1x |`);
  lines.push(`|---|---|---|---|---|`);
  for (const { discovery, forward } of replicatedProfitEdges) {
    lines.push(`| ${discovery.dimension} | ${discovery.group} | ${discovery.combo} | ${discovery.n} / ${roi(discovery.realized_roi)} | ${forward!.n} / ${roi(forward!.realized_roi)} / ${roi(forward!.max1hit_excl_roi)} |`);
  }
}
lines.push(``);

lines.push(`## 7. H011対象 (1-2/1-3/1-4) 次元別（post-hoc）`);
lines.push(``);
for (const combo of h011Combos) {
  lines.push(`### ${combo}`);
  lines.push(``);
  const dims = ["odds_band", "venue", "race_no", "wind_band", "exh1_rank"] as const;
  for (const dim of dims) {
    const rows = allPeriod
      .filter(r => r.combo === combo && r.dimension === dim && r.n >= MIN_N)
      .sort((a, b) => b.edge_pp - a.edge_pp);
    if (rows.length === 0) continue;
    lines.push(`#### ${dim}`);
    lines.push(``);
    lines.push(`| group | n | edge_pp | roi | max1hit_excl | actual | implied |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const r of rows) {
      lines.push(`| ${r.group} | ${r.n} | ${fmt(r.edge_pp)}pt | ${roi(r.realized_roi)} | ${roi(r.max1hit_excl_roi)} | ${pct(r.actual_rate)} | ${pct(r.avg_normalized_implied)} |`);
    }
    lines.push(``);
  }
}

lines.push(`---`);
lines.push(`*生成: analyze-exacta-market-residual-sweep.ts*`);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"), "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  normalRaceCount: normalRaces.length,
  heldoutCount: heldoutRaces.length,
  forwardCount: forwardRaces.length,
  strongCandidates: strong,
  watchCandidates: watch,
  forwardStrong: fwStrong,
  forwardWatch: fwWatch,
  heldoutStrong: hoStrong,
  heldoutWatch: hoWatch,
  replicationGate: {
    heldoutProfitScreens,
    checks: replicationChecks,
    replicatedProfitEdges,
  },
  allCombinations: comboAll,
  allResults: allResults,
}, null, 2), "utf-8");

console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
