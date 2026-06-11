/**
 * analyze-h011-implied-vs-frequency.ts — 読み取り専用 (DB write なし)
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標。購入推奨ではない。
 * historical closing odds は live/T-5/timeseries odds ではない。
 *
 * 目的: H011「1-4系 市場過小評価」の最終決着
 *
 * 背景:
 *   - H011 held-out検証 (b768c02) で「2着=4号艇の頻度の傾きは構造的」と確認
 *   - しかし全期間/held-out の ROI は 75〜83% で優位なし
 *   - 残る問いは「市場価格 (exacta closing odds) が頻度の傾きを织り込んでいるか」
 *
 * 分析:
 *   1. 各BUYレースの全30通りodsから overround = sum(1/odds_i) を計算
 *   2. 1-2/1-3/1-4 の normalized implied prob = (1/odds_1-X) / overround
 *   3. race_payouts から 1号艇1着時の 2着分布 (actual hit rate) を計算
 *   4. avg normalized_implied vs actual_rate を比較
 *      - implied < actual → 市場の過小評価 (H011 復活候補)
 *      - implied ≈ actual → 完全織り込み (H011 終了)
 *      - implied > actual → 市場の過大評価
 *   5. 2024 held-out / 2025+ forward で分けて比較
 *   6. F返還/欠場は通常レースと分離して表示
 *
 * 出力: reports/h011-implied-vs-frequency.{md,json}
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/h011-implied-vs-frequency.md";
const OUT_JSON = "reports/h011-implied-vs-frequency.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES  = [10, 11, 12];
const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

const HELDOUT_START  = "2024-01-01";
const HELDOUT_END    = "2024-12-31";
const FORWARD_START  = "2025-01-01";

console.log("=== H011 implied確率 vs 実頻度 分析 ===\n");
console.log("目的: 市場価格 (exacta closing odds) が 4号艇2着の頻度の傾きを織り込んでいるか\n");

// ─── データ取得 ───────────────────────────────────────────────────────────────

// BUY レースで exacta 全30通りが保存済み & F返還なし & 欠場なし (通常6艇レース)
// これが主評価の母数
type RaceRow = {
  race_id: string;
  date: string;
  period: "heldout" | "forward";
  // exacta odds (1号艇1着の6通り)
  odds_12: number | null; odds_13: number | null; odds_14: number | null;
  odds_15: number | null; odds_16: number | null;
  // overround (全30通り)
  overround: number;
  combo_count: number;
  // 実際の当選組番
  winning_combo: string | null;
  // F返還フラグ
  has_f: number;
};

// 全30通りが保存済みのレースについて overround を計算
const raceData = db.prepare(`
  SELECT
    hao_base.race_id,
    hao_base.race_date as date,
    CASE
      WHEN hao_base.race_date >= '${FORWARD_START}' THEN 'forward'
      ELSE 'heldout'
    END as period,
    -- 1号艇1着の各組番のodds
    MAX(CASE WHEN hao_base.combination='1-2' THEN hao_base.odds END) odds_12,
    MAX(CASE WHEN hao_base.combination='1-3' THEN hao_base.odds END) odds_13,
    MAX(CASE WHEN hao_base.combination='1-4' THEN hao_base.odds END) odds_14,
    MAX(CASE WHEN hao_base.combination='1-5' THEN hao_base.odds END) odds_15,
    MAX(CASE WHEN hao_base.combination='1-6' THEN hao_base.odds END) odds_16,
    -- overround = sum(1/odds) for all combinations in this race
    SUM(1.0 / hao_base.odds) as overround,
    COUNT(*) as combo_count,
    -- 実際の当選 exacta
    rp.combination as winning_combo,
    -- F返還フラグ
    COALESCE((
      SELECT COUNT(*) FROM race_entries re
      WHERE re.race_id = hao_base.race_id AND re.status_code = 'F'
    ), 0) as has_f
  FROM historical_alternative_odds hao_base
  INNER JOIN decision_history dh ON dh.race_id = hao_base.race_id
    AND dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${excl_v}) AND dh.race_no NOT IN (${excl_r})
    AND dh.date >= '${HELDOUT_START}'
  LEFT JOIN race_payouts rp ON rp.race_id = hao_base.race_id AND rp.bet_type = 'exacta'
  WHERE hao_base.bet_type = 'exacta'
  GROUP BY hao_base.race_id
  HAVING COUNT(*) >= 20
`).all() as RaceRow[];

console.log(`取得レース数: ${raceData.length}`);

// ─── 通常/特殊 を分離 ────────────────────────────────────────────────────────

const normalRaces  = raceData.filter(r => r.combo_count === 30 && r.has_f === 0);
const absentRaces  = raceData.filter(r => r.combo_count < 30);
const fRefundRaces = raceData.filter(r => r.has_f > 0 && r.combo_count === 30);

console.log(`  通常 (6艇・返還なし): ${normalRaces.length}件`);
console.log(`  欠場あり: ${absentRaces.length}件`);
console.log(`  F返還あり: ${fRefundRaces.length}件`);
console.log();

// ─── implied vs actual の計算 ────────────────────────────────────────────────

type ImpliedResult = {
  combination: string;
  period: string;
  n: number;
  // implied probability (overround正規化済み)
  avg_implied: number;
  median_implied: number;
  // actual hit rate (race_payouts から)
  actual_hits: number;
  actual_rate: number;
  // 差: implied - actual (正なら市場過大評価、負なら市場過小評価)
  gap: number;
  // 実際の avg odds
  avg_odds: number;
};

// races は呼び出し側で period フィルタ済みのものを渡す
function calcImplied(races: RaceRow[], combo: "1-2" | "1-3" | "1-4", period: string): ImpliedResult {
  const oddsKey = combo === "1-2" ? "odds_12" : combo === "1-3" ? "odds_13" : "odds_14";
  const validRaces = races.filter(r => r[oddsKey] != null && r.overround > 0);

  const impliedValues = validRaces.map(r => (1.0 / r[oddsKey]!) / r.overround);
  const oddsValues    = validRaces.map(r => r[oddsKey]!);

  const avgImplied = impliedValues.length > 0
    ? impliedValues.reduce((s, v) => s + v, 0) / impliedValues.length : 0;
  const sortedImp  = [...impliedValues].sort((a, b) => a - b);
  const medImplied = sortedImp.length > 0
    ? sortedImp[Math.floor(sortedImp.length / 2)] : 0;
  const avgOdds    = oddsValues.length > 0
    ? oddsValues.reduce((s, v) => s + v, 0) / oddsValues.length : 0;

  const hits       = races.filter(r => r.winning_combo === combo).length;
  const actualRate = races.length > 0 ? hits / races.length : 0;

  return {
    combination: combo, period, n: races.length,
    avg_implied: avgImplied, median_implied: medImplied,
    actual_hits: hits, actual_rate: actualRate,
    gap: avgImplied - actualRate, avg_odds: avgOdds,
  };
}

// 主評価: 通常レース (6艇・返還なし)
const periods = ["heldout", "forward", "all"] as const;
const combos  = ["1-2", "1-3", "1-4"] as const;

const results: ImpliedResult[] = [];
for (const period of periods) {
  // period フィルタを呼び出し側で適用してから calcImplied に渡す
  const rows = period === "all"
    ? normalRaces
    : normalRaces.filter(r => r.period === period);
  for (const combo of combos) {
    results.push(calcImplied(rows, combo, period));
  }
}

// ─── 結果出力 ────────────────────────────────────────────────────────────────

console.log("=== 主評価: 通常レース (6艇・F返還なし) ===\n");

const fmt = (v: number, pct = true) => pct ? (v * 100).toFixed(2) + "%" : v.toFixed(2);

for (const period of periods) {
  const periodLabel = period === "heldout" ? "2024 held-out" : period === "forward" ? "2025+ forward" : "全期間";
  const periodRows  = results.filter(r => r.period === period);
  if (periodRows.length === 0 || periodRows[0].n === 0) continue;

  console.log(`--- ${periodLabel} (n=${periodRows[0].n}レース) ---`);
  console.log(`  組番    | avg implied | actual rate | gap (impl-actual) | avg odds`);
  console.log(`  --------|-------------|-------------|-------------------|----------`);

  for (const r of periodRows) {
    const gapSign = r.gap > 0.005 ? "↑過大" : r.gap < -0.005 ? "↓過小(歪み?)" : "≈";
    console.log(`  ${r.combination.padEnd(7)} | ${fmt(r.avg_implied).padStart(11)} | ${fmt(r.actual_rate).padStart(11)} | ${fmt(r.gap).padStart(6)} ${gapSign.padEnd(10)} | ${r.avg_odds.toFixed(1)}`);
  }
  console.log();
}

// ─── H011 判定 ────────────────────────────────────────────────────────────────

const all14 = results.find(r => r.combination === "1-4" && r.period === "all");
const all12 = results.find(r => r.combination === "1-2" && r.period === "all");
const all13 = results.find(r => r.combination === "1-3" && r.period === "all");

console.log("=== H011 判定 ===\n");

if (all14) {
  const gap = all14.gap;
  let verdict = "";
  if (gap < -0.02) {
    verdict = `❓ H011 要再検討: 1-4 implied が actual を ${fmt(Math.abs(gap))} 下回る (市場の過小評価の可能性)`;
  } else if (gap > 0.02) {
    verdict = `✅ H011 終了: 1-4 implied が actual を ${fmt(gap)} 上回る (市場は既に1-4を過大評価)`;
  } else {
    verdict = `✅ H011 終了: 1-4 implied ≈ actual (gap=${fmt(gap)})。市場はほぼ正確に4号艇2着を織り込んでいる`;
  }
  console.log(verdict);
  console.log();
  console.log(`  1-4: avg_implied=${fmt(all14.avg_implied)} vs actual_rate=${fmt(all14.actual_rate)} (gap=${fmt(all14.gap)})`);
  if (all12) console.log(`  1-2: avg_implied=${fmt(all12.avg_implied)} vs actual_rate=${fmt(all12.actual_rate)} (gap=${fmt(all12.gap)})`);
  if (all13) console.log(`  1-3: avg_implied=${fmt(all13.avg_implied)} vs actual_rate=${fmt(all13.actual_rate)} (gap=${fmt(all13.gap)})`);
}
console.log();

// 参考: F返還・欠場レースの概要
if (fRefundRaces.length > 0 || absentRaces.length > 0) {
  console.log("=== 参考: 特殊レース (主評価から除外) ===");
  console.log(`  F返還 ${fRefundRaces.length}件: closing odds は有効だが払戻との検算は不一致 (pool再計算のため)`);
  console.log(`  欠場あり ${absentRaces.length}件: overround は20通りベースで計算可能だが主評価から分離`);
  console.log();
}

// ─── レポート出力 ─────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];
lines.push(`# H011 implied確率 vs 実頻度 分析`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 目的`);
lines.push(``);
lines.push(`H011 held-out検証 (b768c02) で「2着=4号艇の頻度の傾きは構造的・再現」を確認。`);
lines.push(`本分析では「市場価格が その傾きを既に織り込んでいるか」を直接測定する。`);
lines.push(``);
lines.push(`- **implied確率** = (1/odds_1-X) / sum(1/odds for all 30) — overround正規化済み`);
lines.push(`- **actual_rate** = race_payoutsの当選組番が1-Xである頻度`);
lines.push(`- **gap** = implied - actual: 正→市場過大評価、負→市場過小評価(歪み?)`);
lines.push(``);
lines.push(`## データ`);
lines.push(``);
lines.push(`| 区分 | 件数 |`);
lines.push(`|---|---|`);
lines.push(`| 通常 (主評価) | ${normalRaces.length}件 |`);
lines.push(`| 欠場あり | ${absentRaces.length}件 |`);
lines.push(`| F返還あり | ${fRefundRaces.length}件 |`);
lines.push(``);
lines.push(`## 主評価: implied vs actual (通常6艇・F返還なし)`);
lines.push(``);

for (const period of periods) {
  const periodLabel = period === "heldout" ? "### 2024 held-out" : period === "forward" ? "### 2025+ forward" : "### 全期間";
  const periodRows  = results.filter(r => r.period === period);
  if (periodRows.length === 0 || periodRows[0].n === 0) continue;

  lines.push(periodLabel + ` (n=${periodRows[0].n}レース)`);
  lines.push(``);
  lines.push(`| 組番 | avg implied | actual rate | gap (impl-actual) | avg odds | actual hits |`);
  lines.push(`|---|---:|---:|---:|---:|---|`);
  for (const r of periodRows) {
    const gapSign = r.gap > 0.005 ? "↑市場過大" : r.gap < -0.005 ? "↓市場過小" : "≈均衡";
    lines.push(`| ${r.combination} | ${fmt(r.avg_implied)} | ${fmt(r.actual_rate)} | ${fmt(r.gap)} (${gapSign}) | ${r.avg_odds.toFixed(1)} | ${r.actual_hits}/${r.n} |`);
  }
  lines.push(``);
}

lines.push(`## H011 最終判定`);
lines.push(``);
if (all14) {
  const gap = all14.gap;
  if (gap < -0.02) {
    lines.push(`**❓ H011 要再検討**: 1-4 implied が actual を ${fmt(Math.abs(gap))} 下回る`);
    lines.push(``);
    lines.push(`市場は4号艇2着の高頻度を**完全には織り込んでいない**可能性がある。`);
    lines.push(`ただし held-out ROI が 75.9% である点との整合が必要。`);
    lines.push(`implied と actual の差だけでは ROI 優位を保証しない。`);
  } else if (gap > 0.02) {
    lines.push(`**✅ H011 終了 (市場過大評価)**: 1-4 implied が actual を ${fmt(gap)} 上回る`);
    lines.push(``);
    lines.push(`市場は4号艇2着を**過大評価**しており、1-4は割高。`);
    lines.push(`H011 の「1-4系の優位」は存在しない。`);
  } else {
    lines.push(`**✅ H011 終了 (織り込み済み)**: 1-4 implied ≈ actual (gap=${fmt(gap)})`);
    lines.push(``);
    lines.push(`市場は4号艇2着の高頻度を**正確に価格に反映**している。`);
    lines.push(`implied と actual がほぼ一致 → 構造的な傾きはあるが価格優位なし。`);
    lines.push(`held-out ROI 75.9% と一致。H011 を採用する根拠なし。`);
  }
}
lines.push(``);
lines.push(`## 参考: 特殊レース`);
lines.push(``);
lines.push(`| 区分 | 件数 | 備考 |`);
lines.push(`|---|---|---|`);
lines.push(`| F返還 | ${fRefundRaces.length}件 | closing odds は有効。払戻との検算は pool 再計算により不一致 (正常) |`);
lines.push(`| 欠場1艇 | ${absentRaces.length}件 | overround は20通りベース。除外理由: 組番構造が異なる |`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: analyze-h011-implied-vs-frequency.ts*`);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"), "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  normalRaceCount: normalRaces.length,
  absentRaceCount: absentRaces.length,
  fRefundRaceCount: fRefundRaces.length,
  results,
  verdict: all14 ? (
    all14.gap < -0.02 ? "h011_requires_reinvestigation" :
    all14.gap > 0.02  ? "h011_closed_market_overprices_14" :
                        "h011_closed_market_priced_in"
  ) : "insufficient_data",
}, null, 2), "utf-8");

console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
