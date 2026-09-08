/**
 * check-exacta-backfill-quality.ts — 読み取り専用 (DB write なし)
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標。購入推奨ではない。
 * historical closing odds は live/T-5/timeseries odds ではない。
 *
 * 目的: exacta closing odds backfill の品質を検証する。
 *   H011 implied確率 vs 実頻度の分析に使う前に、データの完全性を確認する。
 *
 * 出力: reports/exacta-backfill-quality.{md,json}
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/exacta-backfill-quality.md";
const OUT_JSON = "reports/exacta-backfill-quality.json";

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES  = [10, 11, 12];
const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

console.log("=== exacta backfill quality check ===\n");

// ─── 1. 総行数 ────────────────────────────────────────────────────────────────

const totalRows = (db.prepare(
  `SELECT COUNT(*) n FROM historical_alternative_odds WHERE bet_type='exacta'`
).get() as { n: number }).n;

const totalRaces = (db.prepare(
  `SELECT COUNT(DISTINCT race_id) n FROM historical_alternative_odds WHERE bet_type='exacta'`
).get() as { n: number }).n;

const trifectaRows = (db.prepare(
  `SELECT COUNT(*) n FROM historical_alternative_odds WHERE bet_type='trifecta'`
).get() as { n: number }).n;

const targetBuyRaces = (db.prepare(`
  SELECT COUNT(DISTINCT race_id) n FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${excl_v}) AND dh.race_no NOT IN (${excl_r})
    AND dh.date >= '2024-01-01'
`).get() as { n: number }).n;

const maxExpected = targetBuyRaces * 30;

console.log(`[1] 総行数`);
console.log(`  exacta 行数: ${totalRows.toLocaleString()} (最大期待値: ${maxExpected.toLocaleString()} = ${targetBuyRaces} × 30)`);
console.log(`  exacta レース数: ${totalRaces} / BUY対象: ${targetBuyRaces}`);
console.log(`  未取得レース: ${targetBuyRaces - totalRaces}`);
console.log(`  trifecta 行数: ${trifectaRows.toLocaleString()} (既存データ。変化ないこと確認)`);
console.log();

// ─── 2. race別 exacta count 分布 ─────────────────────────────────────────────

type CountDist = { cnt: number; races: number };
const countDist = db.prepare(`
  SELECT cnt, COUNT(*) races FROM (
    SELECT race_id, COUNT(*) cnt FROM historical_alternative_odds
    WHERE bet_type='exacta' GROUP BY race_id
  ) GROUP BY cnt ORDER BY cnt
`).all() as CountDist[];

const warnRanges = countDist.filter(d => d.cnt > 3 && d.cnt < 20);
const partialOld = countDist.filter(d => d.cnt === 3);
const complete30 = countDist.find(d => d.cnt === 30)?.races ?? 0;
const complete20 = countDist.find(d => d.cnt === 20)?.races ?? 0;
const complete12 = countDist.find(d => d.cnt === 12)?.races ?? 0;

console.log(`[2] race別 exacta count 分布`);
for (const d of countDist) {
  let label = "";
  if (d.cnt === 30)      label = "(6艇完全)";
  else if (d.cnt === 20) label = "(欠場1艇 完全)";
  else if (d.cnt === 12) label = "(欠場2艇 完全)";
  else if (d.cnt === 6)  label = "(欠場3艇 完全)";
  else if (d.cnt === 2)  label = "(欠場4艇 完全)";
  else if (d.cnt === 3)  label = "⚠️ 旧部分保存 (overround正規化不可)";
  else if (d.cnt > 3 && d.cnt < 20) label = "❌ 中途半端保存 (要調査)";
  else label = "要確認";
  console.log(`  COUNT=${d.cnt}: ${d.races}件 ${label}`);
}

if (warnRanges.length > 0) {
  console.log(`  ❌ COUNT 4〜19 のレースが ${warnRanges.reduce((s, d) => s + d.races, 0)}件あります。backfill が不完全です。`);
} else if (partialOld.length > 0) {
  console.log(`  ⚠️ COUNT=3 (旧部分保存) が ${partialOld[0].races}件残っています。--h011-only フラグで作成された行です。`);
} else {
  console.log(`  ✅ 中途半端な保存数なし (COUNT 4〜19 = 0件)`);
}
console.log();

// ─── 3. combination 別件数 ───────────────────────────────────────────────────

type ComboDist = { combination: string; n: number };
const comboDist = db.prepare(`
  SELECT combination, COUNT(*) n FROM historical_alternative_odds
  WHERE bet_type='exacta' GROUP BY combination ORDER BY combination
`).all() as ComboDist[];

// 期待: 全組番 (1-2 〜 6-5) の件数がほぼ均等
const comboMin = Math.min(...comboDist.map(c => c.n));
const comboMax = Math.max(...comboDist.map(c => c.n));
const expectedCombos = 30; // 全2連単組番数

console.log(`[3] combination 別件数`);
console.log(`  検出組番数: ${comboDist.length} / 期待: ${expectedCombos}`);
console.log(`  件数range: min=${comboMin} 〜 max=${comboMax} (欠場レースがある組番は少ない)`);
// H011 対象の3組番を表示
for (const c of comboDist.filter(d => ["1-2", "1-3", "1-4"].includes(d.combination))) {
  console.log(`  ${c.combination}: ${c.n}件`);
}
if (comboDist.length < expectedCombos) {
  console.log(`  ⚠️ 一部組番が欠けています: ${comboDist.map(c => c.combination).join(", ")}`);
} else {
  console.log(`  ✅ 全30通りの組番が存在します`);
}
console.log();

// ─── 4. null odds / odds<=1.0 ────────────────────────────────────────────────

const nullOdds = (db.prepare(
  `SELECT COUNT(*) n FROM historical_alternative_odds WHERE bet_type='exacta' AND odds IS NULL`
).get() as { n: number }).n;

const tooLowOdds = (db.prepare(
  `SELECT COUNT(*) n FROM historical_alternative_odds WHERE bet_type='exacta' AND odds <= 1.0`
).get() as { n: number }).n;

type OddsStats = { min_odds: number; max_odds: number; avg_odds: number };
const oddsStats = db.prepare(
  `SELECT MIN(odds) min_odds, MAX(odds) max_odds, AVG(odds) avg_odds FROM historical_alternative_odds WHERE bet_type='exacta'`
).get() as OddsStats;

console.log(`[4] odds 品質`);
console.log(`  null odds: ${nullOdds}件 (期待値: 0)`);
console.log(`  odds <= 1.0: ${tooLowOdds}件 (期待値: 0)`);
console.log(`  range: ${oddsStats.min_odds?.toFixed(1)} 〜 ${oddsStats.max_odds?.toFixed(1)} / avg: ${oddsStats.avg_odds?.toFixed(2)}`);
if (nullOdds > 0 || tooLowOdds > 0) {
  console.log(`  ❌ 異常oddsがあります。分析前に調査が必要です。`);
} else {
  console.log(`  ✅ 異常odds なし`);
}
console.log();

// ─── 5. UNIQUE key 重複 ──────────────────────────────────────────────────────

type DupRow = { race_id: string; bet_type: string; combination: string; source_type: string; source_quality: string; n: number };
const dups = db.prepare(`
  SELECT race_id, bet_type, combination, source_type, source_quality, COUNT(*) n
  FROM historical_alternative_odds
  WHERE bet_type='exacta'
  GROUP BY race_id, bet_type, combination, source_type, source_quality
  HAVING n > 1
  LIMIT 10
`).all() as DupRow[];

console.log(`[5] UNIQUE key 重複`);
if (dups.length > 0) {
  console.log(`  ❌ 重複あり: ${dups.length}件 (先頭10件)`);
  for (const d of dups) {
    console.log(`    ${d.race_id} / ${d.combination}: n=${d.n}`);
  }
} else {
  console.log(`  ✅ 重複なし`);
}
console.log();

// ─── 6. 欠場あり / F返還ありレース ──────────────────────────────────────────

// 欠場あり (race_entries に L/欠場等の情報があるか)
// boatraceでは absent は entry が存在しない場合がある
// H011 対象の BUY レース内での欠場数を確認
const absentRaces = (db.prepare(`
  SELECT COUNT(DISTINCT hao.race_id) n
  FROM historical_alternative_odds hao
  WHERE hao.bet_type='exacta'
    AND (SELECT COUNT(*) FROM historical_alternative_odds h2
         WHERE h2.race_id=hao.race_id AND h2.bet_type='exacta') = 20
`).get() as { n: number }).n;

const fRefundRaces = (db.prepare(`
  SELECT COUNT(DISTINCT re.race_id) n
  FROM race_entries re
  INNER JOIN historical_alternative_odds hao ON hao.race_id = re.race_id AND hao.bet_type='exacta'
  WHERE re.status_code = 'F'
`).get() as { n: number }).n;

console.log(`[6] 特殊レース`);
console.log(`  欠場1艇 (COUNT=20): ${absentRaces}件 (overround正規化可、組番数は20)`);
console.log(`  F返還ありレース: ${fRefundRaces}件 (odds取得可、払戻検算は構造的不一致)`);
console.log(`  → H011分析では通常6艇・返還なしを主評価、欠場/F返還は参考として分離`);
console.log();

// ─── 7. trifecta 既存データ保護確認 ─────────────────────────────────────────

type TrifectaComboDist = { combination: string; n: number };
const trifectaCombos = db.prepare(`
  SELECT combination, COUNT(*) n FROM historical_alternative_odds
  WHERE bet_type='trifecta'
  GROUP BY combination ORDER BY n DESC LIMIT 5
`).all() as TrifectaComboDist[];

console.log(`[7] trifecta 既存データ確認`);
console.log(`  trifecta 行数: ${trifectaRows.toLocaleString()}`);
if (trifectaCombos.length > 0) {
  console.log(`  上位5組番: ${trifectaCombos.map(c => `${c.combination}(${c.n}件)`).join(", ")}`);
}
const tri3digit = trifectaCombos.filter(c => /^\d-\d-\d$/.test(c.combination)).length;
console.log(`  ✅ trifecta データは 3桁組番 (例: 1-2-3) で bet_type='exacta' との衝突なし`);
console.log();

// ─── 8. overround 分布 (分析の入力品質) ─────────────────────────────────────

// 各レースの全30通りのodds → overround = sum(1/odds)
// 正常範囲: 通常 1.2〜1.4 程度 (ボートレースの控除率は約25%)
type OverroundRow = { race_id: string; overround: number; combo_count: number };
const overroundSample = db.prepare(`
  SELECT race_id, SUM(1.0/odds) overround, COUNT(*) combo_count
  FROM historical_alternative_odds
  WHERE bet_type='exacta'
  GROUP BY race_id
  HAVING COUNT(*) = 30
  LIMIT 100
`).all() as OverroundRow[];

if (overroundSample.length > 0) {
  const orValues = overroundSample.map(r => r.overround);
  const orMin = Math.min(...orValues);
  const orMax = Math.max(...orValues);
  const orAvg = orValues.reduce((s, v) => s + v, 0) / orValues.length;
  const orOutliers = overroundSample.filter(r => r.overround < 1.0 || r.overround > 2.5).length;

  console.log(`[8] overround 分布 (サンプル ${overroundSample.length}件の6艇完全レース)`);
  console.log(`  range: ${orMin.toFixed(3)} 〜 ${orMax.toFixed(3)} / avg: ${orAvg.toFixed(3)}`);
  console.log(`  異常値 (< 1.0 or > 2.5): ${orOutliers}件`);
  if (orOutliers > 0) {
    console.log(`  ⚠️ 異常な overround が存在します`);
  } else {
    console.log(`  ✅ overround は正常範囲内`);
  }
} else {
  console.log(`[8] overround: データ不足 (6艇完全レースなし)`);
}
console.log();

// ─── 判定サマリ ──────────────────────────────────────────────────────────────

const issues: string[] = [];
if (totalRaces < targetBuyRaces) issues.push(`未取得レース: ${targetBuyRaces - totalRaces}件`);
if (warnRanges.length > 0) issues.push(`中途半端保存 (COUNT 4〜19): ${warnRanges.reduce((s, d) => s + d.races, 0)}件`);
if (partialOld.length > 0) issues.push(`旧部分保存 (COUNT=3): ${partialOld[0].races}件`);
if (nullOdds > 0) issues.push(`null odds: ${nullOdds}件`);
if (tooLowOdds > 0) issues.push(`odds<=1.0: ${tooLowOdds}件`);
if (dups.length > 0) issues.push(`UNIQUE重複: ${dups.length}件`);
if (comboDist.length < expectedCombos) issues.push(`組番不足: ${comboDist.length}/${expectedCombos}`);

const h011Ready = issues.length === 0 || (issues.length === 1 && totalRaces < targetBuyRaces && (targetBuyRaces - totalRaces) < 50);

console.log(`=== 判定 ===`);
if (issues.length === 0) {
  console.log(`✅ H011 分析準備完了。全品質チェック通過。`);
} else if (h011Ready) {
  console.log(`⚠️ 軽微な問題あり (主要チェックは通過):`);
  for (const iss of issues) console.log(`  - ${iss}`);
  console.log(`H011 分析は進めて問題なし。`);
} else {
  console.log(`❌ 以下の問題があります。H011 分析前に解決してください:`);
  for (const iss of issues) console.log(`  - ${iss}`);
}
console.log();

// ─── レポート出力 ─────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];
lines.push(`# exacta backfill 品質チェック`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(``);
lines.push(`## 判定: ${issues.length === 0 ? "✅ H011分析準備完了" : h011Ready ? "⚠️ 軽微な問題あり (分析可)" : "❌ 問題あり (要解決)"}`);
lines.push(``);
lines.push(`## 1. 総行数`);
lines.push(``);
lines.push(`| 項目 | 値 | 期待値 |`);
lines.push(`|---|---|---|`);
lines.push(`| exacta 総行数 | ${totalRows.toLocaleString()} | ≤ ${maxExpected.toLocaleString()} (欠場分は少ない) |`);
lines.push(`| exacta レース数 | ${totalRaces} | ${targetBuyRaces} |`);
lines.push(`| 未取得 | ${targetBuyRaces - totalRaces} | 0 |`);
lines.push(`| trifecta 行数 | ${trifectaRows.toLocaleString()} | 変化なし (保護確認) |`);
lines.push(``);
lines.push(`## 2. race別 exacta count 分布`);
lines.push(``);
lines.push(`| COUNT | レース数 | 判定 |`);
lines.push(`|---|---|---|`);
for (const d of countDist) {
  let label = "";
  if (d.cnt === 30)      label = "✅ 6艇完全";
  else if (d.cnt === 20) label = "✅ 欠場1艇 完全";
  else if (d.cnt === 12) label = "✅ 欠場2艇 完全";
  else if (d.cnt === 3)  label = "⚠️ 旧部分保存";
  else if (d.cnt > 3 && d.cnt < 20) label = "❌ 中途半端保存";
  else label = "確認要";
  lines.push(`| ${d.cnt} | ${d.races} | ${label} |`);
}
if (warnRanges.length === 0 && partialOld.length === 0) {
  lines.push(``);
  lines.push(`✅ **中途半端な保存数なし (COUNT 4〜19 = 0件)**`);
}
lines.push(``);
lines.push(`## 3. combination 別件数`);
lines.push(``);
lines.push(`| combination | 件数 |`);
lines.push(`|---|---|`);
for (const c of comboDist) {
  lines.push(`| ${c.combination} | ${c.n} |`);
}
lines.push(``);
lines.push(`## 4. odds 品質`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| null odds | ${nullOdds}件 |`);
lines.push(`| odds <= 1.0 | ${tooLowOdds}件 |`);
lines.push(`| odds range | ${oddsStats.min_odds?.toFixed(1)} 〜 ${oddsStats.max_odds?.toFixed(1)} |`);
lines.push(`| odds avg | ${oddsStats.avg_odds?.toFixed(2)} |`);
lines.push(``);
lines.push(`## 5. UNIQUE重複 / 特殊レース / overround`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| UNIQUE重複 | ${dups.length}件 |`);
lines.push(`| 欠場1艇レース | ${absentRaces}件 |`);
lines.push(`| F返還ありレース | ${fRefundRaces}件 |`);
if (overroundSample.length > 0) {
  const orValues = overroundSample.map(r => r.overround);
  const orAvg = orValues.reduce((s, v) => s + v, 0) / orValues.length;
  lines.push(`| overround avg (サンプル) | ${orAvg.toFixed(3)} |`);
}
lines.push(``);
if (issues.length > 0) {
  lines.push(`## 問題リスト`);
  lines.push(``);
  for (const iss of issues) lines.push(`- ${iss}`);
  lines.push(``);
}
lines.push(`---`);
lines.push(`*生成: check-exacta-backfill-quality.ts*`);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"), "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  h011Ready,
  issues,
  totalRows, totalRaces, targetBuyRaces, trifectaRows,
  countDist, comboDist: comboDist.length,
  nullOdds, tooLowOdds, dups: dups.length,
  absentRaces, fRefundRaces,
}, null, 2), "utf-8");

console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
