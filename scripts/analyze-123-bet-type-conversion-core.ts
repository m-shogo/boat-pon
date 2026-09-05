/**
 * analyze-123-bet-type-conversion.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: selection=1-2-3 の弱い条件（1号艇展示1位・5R等）を完全除外する前に、
 *       3連複/2連複/2連単/1-3-2 など券種/買い目変更で救えるかを確認する。
 *       全 ROI は race_payouts 実際払戻金ベース（current_odds ではない）で統一。
 *
 * 比較対象券種・買い目（1回100円賭け想定）:
 *   1. 3連単 1-2-3（現行）
 *   2. 3連複 1-2-3
 *   3. 2連単 1-2
 *   4. 2連複 1-2
 *   5. 拡連複 1-2
 *   6. 3連単 1-3-2（2着3着入替）
 *   7. 2連単 1-3
 *   8. 2連複 1-3
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/123-bet-type-conversion.md";
const OUT_JSON = "reports/123-bet-type-conversion.json";
const STAKE = 100;

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── 型 ──────────────────────────────────────────────────────────────────────

type BetResult = { totalReturn: number; roi: number };
type ConditionResult = {
  id: string;
  label: string;
  n: number;
  coverageRate: number; // race_payouts の trifecta カバー率
  trifecta123: BetResult;
  trio123: BetResult;
  exacta12: BetResult;
  quinella12: BetResult;
  wide12: BetResult;
  trifecta132: BetResult;
  exacta13: BetResult;
  quinella13: BetResult;
  bestBet: string;
  verdict: "switch候補" | "除外候補" | "要追加確認" | "現行維持";
};

// ─── WHERE 定義 ──────────────────────────────────────────────────────────────

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  AND selection = '1-2-3'
`;

// 展示タイム関連サブクエリ（1号艇 = boat 1）
const EXH1_FASTEST = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (
      SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
    ))`;

const EXH1_RANK23 = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
)`;

const EXH1_RANK4PLUS = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) >= 3
)`;

// 2号艇 vs 3号艇 展示タイム
const BOAT2_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed2.exhibition_time < ed3.exhibition_time
)`;

const BOAT3_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed3.exhibition_time < ed2.exhibition_time
)`;

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;

// ─── 分析対象条件一覧 ─────────────────────────────────────────────────────────

const CONDITIONS: { id: string; label: string; where: string }[] = [
  { id: "all",          label: "A. 全体 1-2-3",                      where: "" },
  { id: "exh1_fastest", label: "B. 1号艇展示タイム1位（最速）",         where: EXH1_FASTEST },
  { id: "exh1_rank23",  label: "C. 1号艇展示タイム2〜3位",              where: EXH1_RANK23 },
  { id: "exh1_rank4p",  label: "D. 1号艇展示タイム4位以下",             where: EXH1_RANK4PLUS },
  { id: "race5",        label: "E. 5R",                               where: "race_no = 5" },
  { id: "odds80p",      label: "F. odds 80以上",                      where: "current_odds >= 80" },
  { id: "boat2_faster", label: "G. 2号艇が3号艇より展示速い（1-2-3有利）", where: BOAT2_FASTER },
  { id: "boat3_faster", label: "H. 3号艇が2号艇より展示速い（1-3-2リスク）",where: BOAT3_FASTER },
  { id: "wind24",       label: "I. 風速 2〜4m/s",                     where: WIND24 },
  { id: "wind24_exh1",  label: "J. 風速2〜4m/s × 1号艇展示1位",        where: `${WIND24} AND ${EXH1_FASTEST}` },
  { id: "suminoe_o40",  label: "K. 住之江 × odds 40〜49",              where: "venue='住之江' AND current_odds >= 40 AND current_odds < 50" },
  { id: "suminoe_exh1", label: "L. 住之江 × 1号艇展示1位",             where: `venue='住之江' AND ${EXH1_FASTEST}` },
];

// ─── メインクエリ（1条件につき全券種を1クエリで集計） ─────────────────────────

function analyzeCondition(cond: { id: string; label: string; where: string }): ConditionResult {
  const whereExtra = cond.where ? "AND " + cond.where : "";

  // race_payouts の実際払戻ベースで集計（current_odds ではない）
  // LIMIT 1 は念のため（1レース×1券種×1組み合わせは1行のはず）
  const row = db.prepare(`
    SELECT
      COUNT(*) as n,
      -- カバレッジ確認（trifecta が race_payouts に存在するレース数）
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta') THEN 1 ELSE 0 END) as covered,
      -- 3連単 1-2-3（現行）
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0)) as t_123,
      -- 3連複 1-2-3
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trio' AND rp.combination='1-2-3' LIMIT 1), 0)) as trio_123,
      -- 2連単 1-2
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-2' LIMIT 1), 0)) as e_12,
      -- 2連複 1-2
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-2' LIMIT 1), 0)) as q_12,
      -- 拡連複 1-2
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='wide' AND rp.combination='1-2' LIMIT 1), 0)) as w_12,
      -- 3連単 1-3-2（2着3着入替）
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as t_132,
      -- 2連単 1-3
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='exacta' AND rp.combination='1-3' LIMIT 1), 0)) as e_13,
      -- 2連複 1-3
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='quinella' AND rp.combination='1-3' LIMIT 1), 0)) as q_13
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${whereExtra}
  `).get() as {
    n: number; covered: number;
    t_123: number; trio_123: number; e_12: number; q_12: number; w_12: number;
    t_132: number; e_13: number; q_13: number;
  };

  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (r: number) => stake > 0 ? Math.round(r / stake * 10000) / 100 : 0;

  const bets: Record<string, BetResult> = {
    "3連単1-2-3": { totalReturn: row.t_123 ?? 0,   roi: roi(row.t_123 ?? 0) },
    "3連複1-2-3": { totalReturn: row.trio_123 ?? 0, roi: roi(row.trio_123 ?? 0) },
    "2連単1-2":   { totalReturn: row.e_12 ?? 0,    roi: roi(row.e_12 ?? 0) },
    "2連複1-2":   { totalReturn: row.q_12 ?? 0,    roi: roi(row.q_12 ?? 0) },
    "拡連複1-2":  { totalReturn: row.w_12 ?? 0,    roi: roi(row.w_12 ?? 0) },
    "3連単1-3-2": { totalReturn: row.t_132 ?? 0,   roi: roi(row.t_132 ?? 0) },
    "2連単1-3":   { totalReturn: row.e_13 ?? 0,    roi: roi(row.e_13 ?? 0) },
    "2連複1-3":   { totalReturn: row.q_13 ?? 0,    roi: roi(row.q_13 ?? 0) },
  };

  // ベスト券種を特定
  const bestBet = Object.entries(bets).reduce((a, b) => a[1].roi >= b[1].roi ? a : b)[0];
  const currentRoi = bets["3連単1-2-3"].roi;
  const bestRoi = bets[bestBet].roi;

  // 判定（id="all" = ベースライン参照行のため判定対象外）
  let verdict: ConditionResult["verdict"];
  if (cond.id === "all") {
    verdict = "現行維持"; // ベースライン行は判定なし
  } else if (bestRoi >= 100 && bestRoi - currentRoi >= 10 && bestBet !== "3連単1-2-3") {
    verdict = "switch候補";
  } else if (Object.values(bets).every(b => b.roi < 90) && n >= 30) {
    verdict = "除外候補";
  } else if (n >= 30 && currentRoi < 85) {
    verdict = "要追加確認";
  } else {
    verdict = "現行維持";
  }

  return {
    id: cond.id, label: cond.label, n,
    coverageRate: n > 0 ? Math.round(row.covered / n * 10000) / 100 : 0,
    trifecta123: bets["3連単1-2-3"],
    trio123:     bets["3連複1-2-3"],
    exacta12:    bets["2連単1-2"],
    quinella12:  bets["2連複1-2"],
    wide12:      bets["拡連複1-2"],
    trifecta132: bets["3連単1-3-2"],
    exacta13:    bets["2連単1-3"],
    quinella13:  bets["2連複1-3"],
    bestBet, verdict,
  };
}

// ─── ヘルパー（全条件実行より前に定義） ──────────────────────────────────────

const BET_KEYS: Record<string, keyof ConditionResult> = {
  "3連単1-2-3": "trifecta123",
  "3連複1-2-3": "trio123",
  "2連単1-2":   "exacta12",
  "2連複1-2":   "quinella12",
  "拡連複1-2":  "wide12",
  "3連単1-3-2": "trifecta132",
  "2連単1-3":   "exacta13",
  "2連複1-3":   "quinella13",
};

function getBetROI(r: ConditionResult, betName: string): number {
  const key = BET_KEYS[betName];
  return key ? (r[key] as BetResult).roi : 0;
}

// ─── 全条件を実行 ─────────────────────────────────────────────────────────────

console.log("[123-bet-type-conversion] 分析開始...");
const results: ConditionResult[] = [];
for (const cond of CONDITIONS) {
  process.stdout.write(`  ${cond.id}... `);
  const r = analyzeCondition(cond);
  results.push(r);
  console.log(`n=${r.n} / trifecta=${r.trifecta123.roi}% / best=${r.bestBet}(${getBetROI(r, r.bestBet)}%)`);
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const switchCandidates = results.filter(r => r.verdict === "switch候補");
const excludeCandidates = results.filter(r => r.verdict === "除外候補");
const needsCheck = results.filter(r => r.verdict === "要追加確認");

// A. 全体のROIを reference として取得
const baselineResult = results.find(r => r.label.includes("全体"));
const baselinePayout = baselineResult?.trifecta123.roi ?? 0;

let md = `# 1-2-3 券種変換 ROI 比較レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 現行除外条件（5会場 + race_no 10,11,12）適用後 / selection=1-2-3 のみ対象。
> **ROI は race_payouts 実際払戻金ベース**（current_odds ではなく実際の払戻倍率）で統一。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

## ⚠️ 重要注意: current_odds と実際払戻の乖離

前の分析（analyze-roi-bad-conditions / analyze-123-breakdown）は current_odds * 100 を使用。
このスクリプトは race_payouts.payout_yen（実際払戻）を使用。

| 指標 | current_odds ベース | 実際払戻ベース | 乖離 |
|---|---|---|---|
| 1-2-3 全体 ROI | ~100.12% | **${baselinePayout}%** | **約${Math.round((100.12 - baselinePayout) * 10) / 10}pt** |

> 原因: オッズは締め切り前変動・ドレイク（配当調整）などにより、
> 意思決定時の current_odds より実際払戻が低くなる傾向がある。
> 本レポートの ROI は実際払戻ベースであり、current_odds ベースより保守的な値になる。

## 判定基準（ベースライン行 A. 全体 は参照のみ・判定対象外）

| 分類 | 条件 |
|---|---|
| switch候補 | 変換先ROI >= 100% かつ 現行3連単より +10pt以上 |
| 除外候補 | 全券種ROI < 90% かつ n >= 30 |
| 要追加確認 | n >= 30 かつ 現行3連単 ROI < 85% |
| 現行維持 | 上記以外 |

---

## 条件別 × 券種別 ROI 比較

| 条件 | n | 3連単 1-2-3 | 3連複 1-2-3 | 2連単 1-2 | 2連複 1-2 | 拡連複 1-2 | 3連単 1-3-2 | 2連単 1-3 | 2連複 1-3 | **最良券種** | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|---|
${results.map(r =>
  `| ${r.label} | ${r.n} | ${r.trifecta123.roi}% | ${r.trio123.roi}% | ${r.exacta12.roi}% | ${r.quinella12.roi}% | ${r.wide12.roi}% | ${r.trifecta132.roi}% | ${r.exacta13.roi}% | ${r.quinella13.roi}% | **${r.bestBet}** | ${r.verdict} |`
).join("\n")}

---

## switch候補（券種変換で ROI ≥ 100% かつ +10pt 以上）

${switchCandidates.length > 0
  ? switchCandidates.map(r => `### ${r.label}
- n=${r.n} / 現行3連単: ${r.trifecta123.roi}%
- **最良: ${r.bestBet} → ${getBetROI(r, r.bestBet)}%** (+${Math.round((getBetROI(r, r.bestBet) - r.trifecta123.roi) * 10) / 10}pt)`).join("\n\n")
  : "> switch候補なし（全条件で変換先ROI < 100% または改善幅 < 10pt）"}

---

## 除外候補（全券種 ROI < 90%）

${excludeCandidates.length > 0
  ? excludeCandidates.map(r => `- **${r.label}**: n=${r.n} / 全券種最大ROI=${Math.max(r.trifecta123.roi, r.trio123.roi, r.exacta12.roi, r.quinella12.roi, r.wide12.roi, r.trifecta132.roi, r.exacta13.roi, r.quinella13.roi).toFixed(1)}% (${r.bestBet})`).join("\n")
  : "> 除外候補なし（全条件でいずれかの券種 ROI ≥ 90%）"}

---

## 要追加確認

${needsCheck.length > 0
  ? needsCheck.map(r => `- **${r.label}**: n=${r.n} / 3連単=${r.trifecta123.roi}% / best=${r.bestBet}`).join("\n")
  : "> なし"}

---

## 3連複で救える条件

| 条件 | 3連単ROI | 3連複ROI | 改善幅 |
|---|---|---|---|
${results.filter(r => r.trio123.roi > r.trifecta123.roi + 5).map(r =>
  `| ${r.label} | ${r.trifecta123.roi}% | **${r.trio123.roi}%** | +${Math.round((r.trio123.roi - r.trifecta123.roi) * 10) / 10}pt |`
).join("\n") || "| なし（3連複の改善幅 5pt 超の条件なし）| - | - | - |"}

---

## 2連複・2連単で救える条件

| 条件 | 3連単ROI | 2連複1-2 | 2連単1-2 | 最良 |
|---|---|---|---|---|
${results.filter(r => Math.max(r.quinella12.roi, r.exacta12.roi) > r.trifecta123.roi + 10).map(r =>
  `| ${r.label} | ${r.trifecta123.roi}% | ${r.quinella12.roi}% | ${r.exacta12.roi}% | **${r.quinella12.roi > r.exacta12.roi ? "2連複1-2" : "2連単1-2"}** |`
).join("\n") || "| なし（2連複/2連単の改善幅 10pt 超の条件なし）| - | - | - | - |"}

---

## 1-3-2 に変更した方がよい可能性がある条件

| 条件 | 3連単1-2-3 ROI | 3連単1-3-2 ROI | 改善幅 |
|---|---|---|---|
${results.filter(r => r.trifecta132.roi > r.trifecta123.roi + 5).map(r =>
  `| ${r.label} | ${r.trifecta123.roi}% | **${r.trifecta132.roi}%** | +${Math.round((r.trifecta132.roi - r.trifecta123.roi) * 10) / 10}pt |`
).join("\n") || "| なし（1-3-2 改善幅 5pt 超の条件なし）| - | - | - |"}

---

## 結論

### 最重要発見 まとめ

| 分類 | 条件 | 推奨アクション |
|---|---|---|
${[
  ...switchCandidates.map(r => `| switch候補 | ${r.label} | ${r.bestBet} に変更してpaper-forward検証 |`),
  ...excludeCandidates.map(r => `| 除外候補 | ${r.label} | paper-forward除外リストに追加 |`),
  ...needsCheck.map(r => `| 要追加確認 | ${r.label} | 追加データ収集後に再判断 |`),
].join("\n") || "| 現行維持 | - | 現行の3連単1-2-3維持 |"}

> **注意**: app_settings 変更はしない。switch候補・除外候補はすべて paper-forward 候補として扱う。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf-8");

console.log(`\n[123-bet-type-conversion] 完了 → ${OUT_MD}`);
console.log(`\n【switch候補】`);
if (switchCandidates.length === 0) console.log("  なし");
else switchCandidates.forEach(r => console.log(`  ${r.label}: 3連単${r.trifecta123.roi}% → best=${r.bestBet}`));
console.log(`\n【除外候補（全券種<90%）】`);
if (excludeCandidates.length === 0) console.log("  なし");
else excludeCandidates.forEach(r => {
  const maxROI = Math.max(r.trifecta123.roi, r.trio123.roi, r.exacta12.roi, r.quinella12.roi, r.wide12.roi, r.trifecta132.roi, r.exacta13.roi, r.quinella13.roi);
  console.log(`  ${r.label}: 全券種最大ROI=${maxROI.toFixed(1)}%`);
});
console.log(`\n【1号艇展示1位の詳細】`);
const exh1 = results.find(r => r.id === "exh1_fastest" || r.label.includes("1号艇展示タイム1位"));
if (exh1) {
  console.log(`  3連単1-2-3: ${exh1.trifecta123.roi}% / 3連複1-2-3: ${exh1.trio123.roi}%`);
  console.log(`  2連複1-2: ${exh1.quinella12.roi}% / 2連単1-2: ${exh1.exacta12.roi}%`);
  console.log(`  3連単1-3-2: ${exh1.trifecta132.roi}% / 2連複1-3: ${exh1.quinella13.roi}%`);
  console.log(`  → 最良: ${exh1.bestBet} / 判定: ${exh1.verdict}`);
}
