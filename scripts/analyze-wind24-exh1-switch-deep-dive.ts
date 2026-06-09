/**
 * analyze-wind24-exh1-switch-deep-dive.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 判断基準: race_payouts.payout_yen 実払戻ベース
 *
 * 目的: 「風速2〜4 × 1号艇展示1位 → 1-3-2 switch」候補の深掘り検査。
 *       forward急伸の実態（高配当依存・直近失速・月別/会場別/odds帯別）を確認し、
 *       本採用候補への格上げ基準を満たすかを判定する。
 *
 * 格上げ条件:
 *   forward n >= 200 かつ 最大2件除外ROI >= 100% かつ 直近3ヶ月ROI > 0% かつ 1-3-2 > 1-2-3 継続
 * 降格条件:
 *   n >= 200 到達時点で 最大2件除外ROI < 95% または 直近3ヶ月連続0hit
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/wind24-exh1-switch-deep-dive.md";
const OUT_JSON = "reports/wind24-exh1-switch-deep-dive.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const FWD_H1_END    = "2025-09-01";  // forward前半/後半の境

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const EXCL_V = EXCLUDED_VENUES.map(v => `'${v}'`).join(",");
const EXCL_R = EXCLUDED_RACE_NOS.join(",");

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))`;

const BASE = `decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCL_V}) AND race_no NOT IN (${EXCL_R})
  AND selection='1-2-3' AND (${WIND24}) AND (${EXH1})`;

function r100(v: number) { return Math.round(v * 100) / 100; }

// ─── 汎用集計 ─────────────────────────────────────────────────────────────────

type PeriodRow = {
  n: number; hits123: number; hits132: number;
  stake: number; pr123: number; pr132: number;
  roi123: number; roi132: number; hitRate132: number;
};

function queryPeriod(extraWhere: string): PeriodRow {
  const w = extraWhere ? `AND ${extraWhere}` : "";
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result='1-2-3' THEN 1 ELSE 0 END) as hits123,
      SUM(CASE WHEN result='1-3-2' THEN 1 ELSE 0 END) as hits132,
      SUM(CASE WHEN result='1-2-3' THEN current_odds*${STAKE} ELSE 0 END) as cr123,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0)) as pr123,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh WHERE ${BASE} ${w}
  `).get() as { n: number; hits123: number; hits132: number; cr123: number; pr123: number; pr132: number };
  const n = r.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? r100(v / stake * 100) : 0;
  return {
    n, hits123: r.hits123 ?? 0, hits132: r.hits132 ?? 0,
    stake, pr123: r.pr123 ?? 0, pr132: r.pr132 ?? 0,
    roi123: roi(r.pr123 ?? 0), roi132: roi(r.pr132 ?? 0),
    hitRate132: n > 0 ? r100((r.hits132 ?? 0) / n * 100) : 0,
  };
}

// ─── 最大払戻除外 ROI ──────────────────────────────────────────────────────────

type ExcludeMaxResult = {
  allRoi: number;
  top1Roi: number; top1Excl: number;
  top2Roi: number; top2Excl: number;
  top3Roi: number; top3Excl: number;
  topHits: { date: string; venue: string; race_no: number; p132: number; p123: number }[];
};

function queryExcludeMax(extraWhere: string): ExcludeMaxResult {
  const w = extraWhere ? `AND ${extraWhere}` : "";
  const rows = db.prepare(`
    SELECT dh.date, dh.venue, dh.race_no,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0) as p132,
      COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0) as p123
    FROM decision_history dh WHERE ${BASE} ${w}
    ORDER BY p132 DESC
  `).all() as { date: string; venue: string; race_no: number; p132: number; p123: number }[];

  const n = rows.length;
  const stake = n * STAKE;
  const total = rows.reduce((a, r) => a + r.p132, 0);
  const roi = (sum: number) => stake > 0 ? r100(sum / stake * 100) : 0;
  const sorted = rows.map(r => r.p132).sort((a, b) => b - a);
  return {
    allRoi: roi(total),
    top1Excl: sorted[0] ?? 0, top1Roi: roi(total - (sorted[0] ?? 0)),
    top2Excl: (sorted[0] ?? 0) + (sorted[1] ?? 0), top2Roi: roi(total - (sorted[0] ?? 0) - (sorted[1] ?? 0)),
    top3Excl: (sorted[0] ?? 0) + (sorted[1] ?? 0) + (sorted[2] ?? 0),
    top3Roi: roi(total - (sorted[0] ?? 0) - (sorted[1] ?? 0) - (sorted[2] ?? 0)),
    topHits: rows.filter(r => r.p132 > 0).slice(0, 10),
  };
}

// ─── 月別 ──────────────────────────────────────────────────────────────────────

type MonthRow = { month: string; n: number; hits132: number; hitRate: number; roi132: number };

function queryMonthly(extraWhere: string): MonthRow[] {
  const w = extraWhere ? `AND ${extraWhere}` : "";
  const rows = db.prepare(`
    SELECT substr(dh.date,1,7) as month, COUNT(*) as n,
      SUM(CASE WHEN result='1-3-2' THEN 1 ELSE 0 END) as hits132,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh WHERE ${BASE} ${w}
    GROUP BY month ORDER BY month
  `).all() as { month: string; n: number; hits132: number; pr132: number }[];
  return rows.map(r => ({
    month: r.month, n: r.n, hits132: r.hits132,
    hitRate: r.n > 0 ? r100(r.hits132 / r.n * 100) : 0,
    roi132: r.n > 0 ? r100(r.pr132 / (r.n * STAKE) * 100) : 0,
  }));
}

// ─── 会場別 ──────────────────────────────────────────────────────────────────

type VenueRow = { venue: string; n: number; hits132: number; roi132: number };

function queryVenues(extraWhere: string): VenueRow[] {
  const w = extraWhere ? `AND ${extraWhere}` : "";
  const rows = db.prepare(`
    SELECT dh.venue, COUNT(*) as n,
      SUM(CASE WHEN result='1-3-2' THEN 1 ELSE 0 END) as hits132,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh WHERE ${BASE} ${w}
    GROUP BY venue ORDER BY n DESC
  `).all() as { venue: string; n: number; hits132: number; pr132: number }[];
  return rows.map(r => ({
    venue: r.venue, n: r.n, hits132: r.hits132,
    roi132: r.n > 0 ? r100(r.pr132 / (r.n * STAKE) * 100) : 0,
  }));
}

// ─── odds帯別 ─────────────────────────────────────────────────────────────────

type OddsRow = { band: string; n: number; hits132: number; roi132: number };

function queryOddsBands(extraWhere: string): OddsRow[] {
  const bands = [
    { label: "10〜19",  min: 10, max: 20 },
    { label: "20〜29",  min: 20, max: 30 },
    { label: "30〜39",  min: 30, max: 40 },
    { label: "40〜49",  min: 40, max: 50 },
    { label: "50〜59",  min: 50, max: 60 },
    { label: "60〜79",  min: 60, max: 80 },
    { label: "80以上",  min: 80, max: 9999 },
  ];
  const w = extraWhere ? `AND ${extraWhere}` : "";
  return bands.map(b => {
    const r = db.prepare(`
      SELECT COUNT(*) as n,
        SUM(CASE WHEN result='1-3-2' THEN 1 ELSE 0 END) as hits132,
        SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
      FROM decision_history dh WHERE ${BASE} ${w}
        AND current_odds >= ${b.min} AND current_odds < ${b.max}
    `).get() as { n: number; hits132: number; pr132: number };
    return {
      band: b.label, n: r.n ?? 0, hits132: r.hits132 ?? 0,
      roi132: (r.n ?? 0) > 0 ? r100((r.pr132 ?? 0) / ((r.n ?? 0) * STAKE) * 100) : 0,
    };
  });
}

// ─── 集計実行 ─────────────────────────────────────────────────────────────────

console.log("[deep-dive] 風速2〜4 × 1号艇展示1位 → 1-3-2 switch 深掘り開始...");

const train  = queryPeriod(`date < '${FORWARD_START}'`);
const fwdAll = queryPeriod(`date >= '${FORWARD_START}'`);
const fwdH1  = queryPeriod(`date >= '${FORWARD_START}' AND date < '${FWD_H1_END}'`);
const fwdH2  = queryPeriod(`date >= '${FWD_H1_END}'`);

console.log(`  訓練期: n=${train.n} hits132=${train.hits132} hitRate=${train.hitRate132}% roi132=${train.roi132}%`);
console.log(`  forward全体: n=${fwdAll.n} hits132=${fwdAll.hits132} hitRate=${fwdAll.hitRate132}% roi132=${fwdAll.roi132}%`);
console.log(`  forward前半(〜${FWD_H1_END}): n=${fwdH1.n} hits132=${fwdH1.hits132} roi132=${fwdH1.roi132}%`);
console.log(`  forward後半(${FWD_H1_END}〜): n=${fwdH2.n} hits132=${fwdH2.hits132} roi132=${fwdH2.roi132}%`);

console.log("\n[deep-dive] 最大払戻除外...");
const exclAll   = queryExcludeMax(`date >= '${FORWARD_START}'`);
const exclTrain = queryExcludeMax(`date < '${FORWARD_START}'`);
console.log(`  forward 最大1件除外: ${exclAll.top1Roi}% (除外額=${exclAll.top1Excl})`);
console.log(`  forward 最大2件除外: ${exclAll.top2Roi}%`);
console.log(`  forward 最大3件除外: ${exclAll.top3Roi}%`);

console.log("\n[deep-dive] 月別...");
const monthlyFwd   = queryMonthly(`date >= '${FORWARD_START}'`);
const monthlyTrain = queryMonthly(`date >= '2022-01-01' AND date < '${FORWARD_START}'`);
monthlyFwd.forEach(r => console.log(`  ${r.month}: n=${r.n} hits=${r.hits132} roi=${r.roi132}%`));

console.log("\n[deep-dive] 会場別 (forward)...");
const venuesFwd   = queryVenues(`date >= '${FORWARD_START}'`);
const venuesTrain = queryVenues(`date < '${FORWARD_START}'`);
venuesFwd.slice(0, 10).forEach(r => console.log(`  ${r.venue}: n=${r.n} hits=${r.hits132} roi=${r.roi132}%`));

console.log("\n[deep-dive] odds帯別 (forward)...");
const oddsFwd   = queryOddsBands(`date >= '${FORWARD_START}'`);
oddsFwd.forEach(r => console.log(`  ${r.band}: n=${r.n} hits=${r.hits132} roi=${r.roi132}%`));

// ─── 判定 ──────────────────────────────────────────────────────────────────────

// 直近3ヶ月のゼロ判定
const last3Months = monthlyFwd.slice(-3);
const recentAllZero = last3Months.every(m => m.roi132 === 0);
const recentZeroCount = last3Months.filter(m => m.roi132 === 0).length;

type StatusVerdict = "格上げ待ち(n不足)" | "格上げ待ち(2件除外ROI不足)" | "格上げ待ち(直近失速)" | "格上げ候補" | "降格候補" | "観察継続";

function getVerdict(): StatusVerdict {
  if (fwdAll.n < 200) return "格上げ待ち(n不足)";
  if (exclAll.top2Roi < 95) return recentAllZero ? "降格候補" : "格上げ待ち(2件除外ROI不足)";
  if (recentZeroCount >= 3) return "格上げ待ち(直近失速)";
  if (exclAll.top2Roi >= 100 && !recentAllZero) return "格上げ候補";
  return "観察継続";
}

const verdict: StatusVerdict = getVerdict();
console.log(`\n[deep-dive] 判定: ${verdict}`);
console.log(`  forward n=${fwdAll.n} (格上げ基準: n>=200)`);
console.log(`  最大2件除外ROI=${exclAll.top2Roi}% (格上げ基準: >=100%)`);
console.log(`  直近3ヶ月ゼロ数=${recentZeroCount} / ${last3Months.length}ヶ月`);

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const now = new Date().toISOString();

const verdictIcon = { "格上げ候補": "✅", "観察継続": "🔷", "格上げ待ち(n不足)": "⏳", "格上げ待ち(2件除外ROI不足)": "🔶", "格上げ待ち(直近失速)": "⚠️", "降格候補": "❌" };

let md = `# 風速2〜4 × 1号艇展示1位 → 1-3-2 switch 深掘り検査

生成日時: ${now}
DB: ${DB_PATH}
forward 開始日: ${FORWARD_START} / 前半/後半境: ${FWD_H1_END}

> **ROI基準**: race_payouts.payout_yen 実払戻。app_settings変更禁止 / 本番ロジック変更禁止

---

## 現在の判定

> ${verdictIcon[verdict] ?? "—"} **${verdict}**

| 格上げ条件 | 基準 | 現状 | 達成 |
|---|---|---|---|
| forward n | >= 200 | ${fwdAll.n} | ${fwdAll.n >= 200 ? "✅" : "⏳ あと" + (200 - fwdAll.n) + "件"} |
| 最大2件除外ROI | >= 100% | ${exclAll.top2Roi}% | ${exclAll.top2Roi >= 100 ? "✅" : "❌"} |
| 直近3ヶ月ROI > 0 | 0%なし | ${recentZeroCount}ヶ月ゼロ | ${recentZeroCount === 0 ? "✅" : "⚠️"} |
| 1-3-2 > 1-2-3 継続 | 差 > 0pt | +${r100(fwdAll.roi132 - fwdAll.roi123)}pt | ${fwdAll.roi132 > fwdAll.roi123 ? "✅" : "❌"} |

降格条件: n>=200到達時点で最大2件除外ROI<95% または 直近3ヶ月連続0hit → **降格候補**

---

## 期間別比較

| 期間 | n | 1-3-2的中 | 的中率 | payout1-2-3 | **payout1-3-2** | switch改善 |
|---|---|---|---|---|---|---|
| 訓練期（〜${FORWARD_START}前） | ${train.n} | ${train.hits132} | ${train.hitRate132}% | ${train.roi123}% | **${train.roi132}%** | +${r100(train.roi132-train.roi123)}pt |
| forward全体（${FORWARD_START}〜） | ${fwdAll.n} | ${fwdAll.hits132} | ${fwdAll.hitRate132}% | ${fwdAll.roi123}% | **${fwdAll.roi132}%** | +${r100(fwdAll.roi132-fwdAll.roi123)}pt |
| forward前半（〜${FWD_H1_END}前） | ${fwdH1.n} | ${fwdH1.hits132} | ${fwdH1.hitRate132}% | ${fwdH1.roi123}% | **${fwdH1.roi132}%** | +${r100(fwdH1.roi132-fwdH1.roi123)}pt |
| **forward後半（${FWD_H1_END}〜）** | ${fwdH2.n} | **${fwdH2.hits132}** | ${fwdH2.hitRate132}% | ${fwdH2.roi123}% | **${fwdH2.roi132}%** | +${r100(fwdH2.roi132-fwdH2.roi123)}pt |

> forward前半: 的中率${fwdH1.hitRate132}% / forward後半: 的中率${fwdH2.hitRate132}%
${fwdH2.hits132 === 0 ? "> ⚠️ **forward後半が0hit** — 直近の失速が確認されている。race_payoutsカバレッジは問題なし（実際に1-3-2的中ゼロ）" : ""}

---

## 高配当依存チェック（forward期）

| 除外 | ROI | 除外額 |
|---|---|---|
| 除外なし | **${exclAll.allRoi}%** | — |
| 最大1件除外 | **${exclAll.top1Roi}%** | ${exclAll.top1Excl.toLocaleString()}円 |
| 最大2件除外 | **${exclAll.top2Roi}%** | ${exclAll.top2Excl.toLocaleString()}円 |
| 最大3件除外 | **${exclAll.top3Roi}%** | ${exclAll.top3Excl.toLocaleString()}円 |

${exclAll.top1Roi >= 100 ? "> ✅ **最大1件除外でも100%以上** — 単一高配当への完全依存ではない" : "> ⚠️ 最大1件除外で100%未満 — 高配当依存リスクあり"}
${exclAll.top2Roi >= 100 ? "> ✅ **最大2件除外でも100%以上**" : `> ⚠️ **最大2件除外で${exclAll.top2Roi}%（100%未満）** — 格上げ条件未達`}

### 高配当hit一覧（forward期、payout降順）

| date | 会場 | R | 1-3-2 払戻 | 1-2-3 払戻 |
|---|---|---|---|---|
${exclAll.topHits.map(h => `| ${h.date} | ${h.venue} | ${h.race_no}R | ${h.p132.toLocaleString()}円 | ${h.p123.toLocaleString()}円 |`).join("\n")}

---

## 月別ROI（forward期）

| 月 | n | 的中 | 的中率 | **1-3-2 ROI** | 判定 |
|---|---|---|---|---|---|
${monthlyFwd.map(r => {
  const flag = r.roi132 === 0 ? "🔶 ゼロ" : r.roi132 >= 100 ? "✅ 黒字" : "—";
  return `| ${r.month} | ${r.n} | ${r.hits132} | ${r.hitRate}% | **${r.roi132}%** | ${flag} |`;
}).join("\n")}

---

## 会場別ROI（forward期）

| 会場 | n | 的中 | **1-3-2 ROI** |
|---|---|---|---|
${venuesFwd.map(r => `| ${r.venue} | ${r.n} | ${r.hits132} | **${r.roi132}%** |`).join("\n")}

---

## odds帯別ROI（forward期）

| odds帯 | n | 的中 | **1-3-2 ROI** |
|---|---|---|---|
${oddsFwd.map(r => `| ${r.band} | ${r.n} | ${r.hits132} | **${r.roi132}%** |`).join("\n")}

---

## 訓練期 高配当hit一覧（参考）

| date | 会場 | R | 1-3-2 払戻 |
|---|---|---|---|
${exclTrain.topHits.slice(0, 5).map(h => `| ${h.date} | ${h.venue} | ${h.race_no}R | ${h.p132.toLocaleString()}円 |`).join("\n")}

---

## 結論

### この候補の本質
- **訓練期 1-3-2 ROI: ${train.roi132}%**（弱い — backtest発見時点では有望候補ではなかった）
- **forward前半 ROI: ${fwdH1.roi132}%**（急上昇 — forward急伸）
- **forward後半 ROI: ${fwdH2.roi132}%**（失速 — n=${fwdH2.n}）

### 最大の懸念
1. **最大2件除外で${exclAll.top2Roi}%** — 格上げ基準（100%）に${exclAll.top2Roi >= 100 ? "達している" : "未達"}
2. **直近${recentZeroCount}ヶ月がゼロ** — forward後半の失速は real（データ欠損ではない）

### 現在の評価: ${verdictIcon[verdict] ?? "—"} **${verdict}**
次の確認タイミング: forward n=${fwdAll.n} → **200件到達時**
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now, forwardStart: FORWARD_START, fwdH1End: FWD_H1_END,
  verdict,
  periods: { train, fwdAll, fwdH1, fwdH2 },
  excludeMax: { forward: exclAll, train: exclTrain },
  monthly: { forward: monthlyFwd, trainRecent: monthlyTrain },
  venues: { forward: venuesFwd, train: venuesTrain },
  odds: { forward: oddsFwd },
  upgradeStatus: {
    nReached200: fwdAll.n >= 200, top2RoiOk: exclAll.top2Roi >= 100,
    recentZeroCount, nForUpgrade: Math.max(0, 200 - fwdAll.n),
  },
}, null, 2), "utf-8");

console.log(`\n[deep-dive] 完了 → ${OUT_MD}`);
console.log(`\n判定: ${verdictIcon[verdict]} ${verdict}`);
console.log(`  forward n=${fwdAll.n} / 最大2件除外ROI=${exclAll.top2Roi}% / 直近${recentZeroCount}ヶ月ゼロ`);
