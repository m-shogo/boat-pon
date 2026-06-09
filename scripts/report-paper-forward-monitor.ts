/**
 * report-paper-forward-monitor.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 判断基準: race_payouts.payout_yen 実払戻ベース
 *
 * 目的: paper-forward 台帳に記載した switch候補・除外候補が、
 *       forward 期間（backtest 発見後の新規データ）でも再現しているかを追跡する。
 *
 * forward 期間の定義:
 *   FORWARD_START_DATE 環境変数で指定（デフォルト: 2025-01-01）
 *   全データは run_kind='historical-backfill' のみ。日付で訓練/forward を分割する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/paper-forward-monitor.md";
const OUT_JSON = "reports/paper-forward-monitor.json";
const FORWARD_START = process.env.FORWARD_START_DATE ?? "2025-01-01";
const STAKE = 100;

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const BASE_WHERE_ALL = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

const BASE_WHERE_TRAIN   = `${BASE_WHERE_ALL} AND date < '${FORWARD_START}'`;
const BASE_WHERE_FORWARD = `${BASE_WHERE_ALL} AND date >= '${FORWARD_START}'`;

// ─── WHERE スニペット ──────────────────────────────────────────────────────────

const EXH1_FASTEST = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (
      SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
    ))`;

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

// ─── 型 ──────────────────────────────────────────────────────────────────────

type PeriodStat = {
  n: number;
  hits: number;
  currentRoi: number;
  payoutRoi: number;
};

type SwitchPeriodStat = PeriodStat & { payoutRoi132: number; switchGain: number };

type MilestoneStatus = {
  reached30: boolean;
  reached50: boolean;
  reached100: boolean;
  nextMilestone: number | null;
  nConf: string;
};

type SwitchMonitor = {
  id: string;
  label: string;
  from: string;
  to: string;
  train: SwitchPeriodStat;
  forward: SwitchPeriodStat;
  milestone: MilestoneStatus;
  verdict: "strong" | "watch" | "weak-watch" | "reject" | "data-insufficient";
  trend: "再現" | "forward急伸" | "方向一致" | "弱い" | "逆転" | "データ不足";
};

type ExcludeMonitor = {
  id: string;
  label: string;
  caution?: string;
  trainResidualPayoutRoi: number;
  trainExclN: number;
  forward: {
    exclN: number;
    residualN: number;
    residualPayoutRoi: number;
    basePayoutRoi: number;
    improvPayout: number;
  };
  milestone: MilestoneStatus;
  verdict: "strong" | "watch" | "weak-watch" | "reject" | "data-insufficient";
  trend: "再現" | "方向一致" | "弱い" | "逆転" | "データ不足";
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function r100(v: number) { return Math.round(v * 100) / 100; }

function milestoneStatus(n: number): MilestoneStatus {
  const reached30  = n >= 30;
  const reached50  = n >= 50;
  const reached100 = n >= 100;
  const next = !reached30 ? 30 : !reached50 ? 50 : !reached100 ? 100 : null;
  const nConf = reached100 ? "継続/降格判断(n≥100)" : reached50 ? "要確認(n≥50)" : reached30 ? "仮判定(n≥30)" : "判定不可(n<30)";
  return { reached30, reached50, reached100, nextMilestone: next, nConf };
}

function switchVerdict(fwd: SwitchPeriodStat, fwdN: number): SwitchMonitor["verdict"] {
  if (fwdN < 30) return "data-insufficient";
  if (fwd.payoutRoi132 >= 105) return "strong";
  if (fwd.payoutRoi132 >= 100) return "watch";
  if (fwd.payoutRoi132 >= 95)  return "weak-watch";
  return "reject";
}

function switchTrend(train: SwitchPeriodStat, fwd: SwitchPeriodStat, fwdN: number): SwitchMonitor["trend"] {
  if (fwdN < 30) return "データ不足";
  // 訓練期100%未満 → forward100%以上: 訓練期では弱かったが forward で強く出た
  if (train.payoutRoi132 < 100 && fwd.payoutRoi132 >= 100) return "forward急伸";
  // 訓練期も forward も 100%以上: 真の再現
  if (train.payoutRoi132 >= 100 && fwd.payoutRoi132 >= 100) return "再現";
  if (fwd.payoutRoi132 > fwd.payoutRoi) return "方向一致";
  if (fwd.payoutRoi132 > train.payoutRoi132 * 0.7) return "弱い";
  return "逆転";
}

function exclVerdict(fwdResidualRoi: number, fwdN: number): ExcludeMonitor["verdict"] {
  if (fwdN < 10) return "data-insufficient";
  if (fwdResidualRoi >= 105) return "strong";
  if (fwdResidualRoi >= 100) return "watch";
  if (fwdResidualRoi >= 95)  return "weak-watch";
  return "reject";
}

function exclTrend(trainResidual: number, fwdImprov: number, fwdN: number): ExcludeMonitor["trend"] {
  if (fwdN < 10) return "データ不足";
  if (fwdImprov > 5) return "再現";
  if (fwdImprov > 0) return "方向一致";
  if (fwdImprov > -5) return "弱い";
  return "逆転";
}

function querySwitchBoth(baseWhere: string, where: string, selFilter = ""): SwitchPeriodStat {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const row = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh
    WHERE ${baseWhere} ${selW} ${condW}
  `).get() as { n: number; hits: number; cr: number; pr: number; pr132: number };
  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? r100(v / stake * 100) : 0;
  return {
    n, hits: row.hits ?? 0,
    currentRoi: roi(row.cr ?? 0),
    payoutRoi: roi(row.pr ?? 0),
    payoutRoi132: roi(row.pr132 ?? 0),
    switchGain: r100(roi(row.pr132 ?? 0) - roi(row.pr ?? 0)),
  };
}

function queryStatBoth(baseWhere: string, where: string, selFilter = ""): PeriodStat {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const row = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr
    FROM decision_history dh
    WHERE ${baseWhere} ${selW} ${condW}
  `).get() as { n: number; hits: number; cr: number; pr: number };
  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? r100(v / stake * 100) : 0;
  return { n, hits: row.hits ?? 0, currentRoi: roi(row.cr ?? 0), payoutRoi: roi(row.pr ?? 0) };
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

console.log(`[monitor] forward 期間: ${FORWARD_START} 以降`);
console.log("[monitor] ベースライン...");

const trainBase = queryStatBoth(BASE_WHERE_TRAIN, "", "selection='1-2-3'");
const fwdBase   = queryStatBoth(BASE_WHERE_FORWARD, "", "selection='1-2-3'");
console.log(`  訓練 n=${trainBase.n} payout=${trainBase.payoutRoi}%`);
console.log(`  forward n=${fwdBase.n} payout=${fwdBase.payoutRoi}%`);

// ── switch候補モニタ ─────────────────────────────────────────────────────────

console.log("\n[monitor] switch候補...");
const SWITCH_DEFS = [
  { id: "sw_wind24_exh1",  label: "風速2〜4 × 1号艇展示1位",  where: `(${WIND24}) AND (${EXH1_FASTEST})`, sel: "selection='1-2-3'" },
  { id: "sw_suminoe_o40",  label: "住之江 × odds40〜49",       where: "venue='住之江' AND current_odds>=40 AND current_odds<50", sel: "selection='1-2-3'" },
  { id: "sw_suminoe_exh1", label: "住之江 × 1号艇展示1位",    where: `venue='住之江' AND (${EXH1_FASTEST})`, sel: "selection='1-2-3'" },
  { id: "sw_suminoe_r5",   label: "住之江 × 5R",              where: "venue='住之江' AND race_no=5", sel: "selection='1-2-3'" },
];

const switchMonitors: SwitchMonitor[] = [];
for (const d of SWITCH_DEFS) {
  const train = querySwitchBoth(BASE_WHERE_TRAIN, d.where, d.sel);
  const fwd   = querySwitchBoth(BASE_WHERE_FORWARD, d.where, d.sel);
  const milestone = milestoneStatus(fwd.n);
  const verdict = switchVerdict(fwd, fwd.n);
  const trend = switchTrend(train, fwd, fwd.n);
  switchMonitors.push({ id: d.id, label: d.label, from: "3連単1-2-3", to: "3連単1-3-2", train, forward: fwd, milestone, verdict, trend });
  console.log(`  ${d.label}: fwd n=${fwd.n} payout1-3-2=${fwd.payoutRoi132}% [${trend}] (${milestone.nConf})`);
}

// ── 除外候補モニタ ────────────────────────────────────────────────────────────

console.log("\n[monitor] 除外候補...");
const EXCL_DEFS = [
  { id: "ex_exh1",        label: "1号艇展示1位 除外",            where: EXH1_FASTEST,                                            sel: "selection='1-2-3'" },
  { id: "ex_boat3",       label: "3号艇が2号艇より展示速い 除外", where: BOAT3_FASTER,                                           sel: "selection='1-2-3'" },
  { id: "ex_race5",       label: "5R 除外",                       where: "race_no=5",                                            sel: "selection='1-2-3'" },
  { id: "ex_odds80",      label: "odds 80以上 除外",              where: "current_odds>=80",                                     sel: "selection='1-2-3'" },
  { id: "ex_wind24_caut", label: "風速2〜4m/s 除外（注意付き）",  where: WIND24,                                                 sel: "selection='1-2-3'", caution: "switch候補と競合" },
];

const exclMonitors: ExcludeMonitor[] = [];
for (const d of EXCL_DEFS) {
  const trainExcl = queryStatBoth(BASE_WHERE_TRAIN, d.where, d.sel);
  const trainRest = queryStatBoth(BASE_WHERE_TRAIN, `NOT (${d.where})`, d.sel);
  const fwdExcl   = queryStatBoth(BASE_WHERE_FORWARD, d.where, d.sel);
  const fwdRest   = queryStatBoth(BASE_WHERE_FORWARD, `NOT (${d.where})`, d.sel);
  const fwdImprov = r100(fwdRest.payoutRoi - fwdBase.payoutRoi);
  const milestone = milestoneStatus(fwdRest.n);
  const verdict = exclVerdict(fwdRest.payoutRoi, fwdRest.n);
  const trend = exclTrend(trainRest.payoutRoi, fwdImprov, fwdRest.n);
  exclMonitors.push({
    id: d.id, label: d.label,
    ...(d.caution ? { caution: d.caution } : {}),
    trainResidualPayoutRoi: trainRest.payoutRoi,
    trainExclN: trainExcl.n,
    forward: { exclN: fwdExcl.n, residualN: fwdRest.n, residualPayoutRoi: fwdRest.payoutRoi, basePayoutRoi: fwdBase.payoutRoi, improvPayout: fwdImprov },
    milestone, verdict, trend,
  });
  console.log(`  ${d.label}: fwd残存 n=${fwdRest.n} payout=${fwdRest.payoutRoi}% (+${fwdImprov}pt) [${trend}]`);
}

// ─── forward 週次サマリ（直近4週間）──────────────────────────────────────────

console.log("\n[monitor] 直近4週間サマリ...");
const last4w = db.prepare(`
  SELECT COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
      WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr
  FROM decision_history dh
  WHERE ${BASE_WHERE_ALL} AND selection='1-2-3'
    AND date >= date((SELECT MAX(date) FROM decision_history WHERE run_kind='historical-backfill'), '-28 days')
`).get() as { n: number; hits: number; pr: number };
const l4wStake = (last4w.n ?? 0) * STAKE;
const l4wPayout = l4wStake > 0 ? r100((last4w.pr ?? 0) / l4wStake * 100) : 0;
console.log(`  直近4週 n=${last4w.n} hits=${last4w.hits} payout=${l4wPayout}%`);

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const verdictIcon = (v: string): string => ({ strong: "✅", watch: "🔷", "weak-watch": "🔶", reject: "❌", "data-insufficient": "⏳" })[v] ?? "—";
const trendIcon   = (t: string): string => ({ "再現": "✅", "forward急伸": "🚀", "方向一致": "🔷", "弱い": "🔶", "逆転": "❌", "データ不足": "⏳" })[t] ?? "—";

let md = `# paper-forward モニターレポート

生成日時: ${now}
DB: ${DB_PATH}
forward 開始日: **${FORWARD_START}**（それ以前を訓練期、以降を forward 期とする）

> **ROI基準**: race_payouts.payout_yen 実払戻（current_odds は参考値のみ）
> app_settings変更禁止 / 本番ロジック変更禁止 / DBへの書き込み禁止

---

## ベースライン比較

| 期間 | n | 実払戻 ROI | 備考 |
|---|---|---|---|
| 訓練期（〜${FORWARD_START}前） | ${trainBase.n} | ${trainBase.payoutRoi}% | backtest 発見期間 |
| forward 期（${FORWARD_START}〜） | ${fwdBase.n} | **${fwdBase.payoutRoi}%** | 候補の再現性検証期間 |

> forward 期ベースラインが訓練期と大きく乖離している場合は全体傾向の変化に注意。

---

## switch候補モニター（1-2-3 → 1-3-2）

| 条件 | 訓練1-3-2 | fwd n | **fwd 1-3-2** | fwd改善 | 信頼度 | 判定 | トレンド |
|---|---|---|---|---|---|---|---|
${switchMonitors.map(m =>
  `| ${m.label} | ${m.train.payoutRoi132}% | ${m.forward.n} | **${m.forward.payoutRoi132}%** | +${m.forward.switchGain}pt | ${m.milestone.nConf} | ${verdictIcon(m.verdict)} ${m.verdict} | ${trendIcon(m.trend)} ${m.trend} |`
).join("\n")}

### 詳細

${switchMonitors.map(m => {
  const nLeft = m.milestone.nextMilestone
    ? `次のマイルストーンまで: **${m.milestone.nextMilestone - m.forward.n} 件**（目標 n=${m.milestone.nextMilestone}）`
    : "n≥100 到達済み — 継続/降格判断フェーズ";
  const extraNote = m.trend === "forward急伸"
    ? `\n> ⚠️ **forward急伸注意**: 訓練期 1-3-2=${m.train.payoutRoi132}%（100%未満）だったが forward で急上昇。高配当1〜2件への依存がないか hit数・最大払戻除外ROI・月別ROIで要確認。`
    : m.verdict === "data-insufficient"
      ? `\n> ⏳ **データ不足（n<30）**: forward 期のサンプルが少なすぎるため判定不可。reject ではない。n=30 到達後に再判定。`
      : "";
  return `#### ${m.label}
- 訓練: n=${m.train.n} / 1-2-3=${m.train.payoutRoi}% / **1-3-2=${m.train.payoutRoi132}%**
- forward: n=${m.forward.n} / 1-2-3=${m.forward.payoutRoi}% / **1-3-2=${m.forward.payoutRoi132}%** (+${m.forward.switchGain}pt)
- ${nLeft}
- 判定: ${verdictIcon(m.verdict)} **${m.verdict}** / トレンド: ${trendIcon(m.trend)} ${m.trend}
${extraNote}`;
}).join("\n")}

---

## 除外候補モニター

| 条件 | 訓練残存 | fwd 除外n | fwd 残存n | **fwd 残存 payout** | fwd 改善 | 判定 | トレンド |
|---|---|---|---|---|---|---|---|
${exclMonitors.map(m =>
  `| ${m.label}${m.caution ? " ⚠️" : ""} | ${m.trainResidualPayoutRoi}% | ${m.forward.exclN} | ${m.forward.residualN} | **${m.forward.residualPayoutRoi}%** | +${m.forward.improvPayout}pt | ${verdictIcon(m.verdict)} ${m.verdict} | ${trendIcon(m.trend)} ${m.trend} |`
).join("\n")}

> forward ベースライン: ${fwdBase.payoutRoi}%

${exclMonitors.filter(m => m.caution).map(m => `> ⚠️ **${m.label}**: ${m.caution}`).join("\n")}

---

## 直近4週間サマリ（全体）

| 期間 | n | hits | 実払戻 ROI |
|---|---|---|---|
| 直近4週間 | ${last4w.n ?? 0} | ${last4w.hits ?? 0} | **${l4wPayout}%** |

---

## 判定基準（参照用）

| payout ROI | 判定 |
|---|---|
| ≥105% | ✅ strong — 継続観察 |
| 100〜105% | 🔷 watch — 継続（週次確認） |
| 95〜100% | 🔶 weak-watch — 条件付き継続 |
| <95% | ❌ reject — 降格候補 |

| n | 信頼度 |
|---|---|
| <30 | ⏳ **判定不可** — データ不足。reject ではない |
| ≥30 | 仮判定 |
| ≥50 | 要確認 |
| ≥100 | 継続/降格判断 |

| トレンド | 意味 |
|---|---|
| ✅ 再現 | 訓練期も forward も 1-3-2 >= 100% |
| 🚀 forward急伸 | 訓練期 < 100% だった候補が forward で >= 100% に急上昇。高配当依存の可能性あり、要深掘り |
| 🔷 方向一致 | forward が 100% 未満でも switch で改善 |
| 🔶 弱い | 改善幅が小さい |
| ❌ 逆転 | forward で switch による改善が消えている |
| ⏳ データ不足 | n<30 のため判定不可 |

### 昇格・降格ルール
- **switch本採用**: n≥100 かつ forward payout 1-3-2 ≥ 100% で3ヶ月継続
- **除外本採用**: 除外後 forward payout ≥ baseline+5pt で3ヶ月継続
- **降格**: forward payout < 85% が2ヶ月連続 → 降格候補

> **最重要**: app_settings変更は行わない。本レポートは観察・記録のみ。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  forwardStart: FORWARD_START,
  baseline: { train: trainBase, forward: fwdBase },
  switchMonitors,
  exclMonitors,
  last4weeks: { n: last4w.n, hits: last4w.hits, payoutRoi: l4wPayout },
}, null, 2), "utf-8");

console.log(`\n[monitor] 完了 → ${OUT_MD}`);
console.log(`\n【forward 判定サマリ】`);
console.log(`  ベースライン: 訓練=${trainBase.payoutRoi}% / forward=${fwdBase.payoutRoi}%`);
console.log(`\n  switch候補:`);
switchMonitors.forEach(m => console.log(`    ${trendIcon(m.trend)} ${m.label}: fwd1-3-2=${m.forward.payoutRoi132}% (n=${m.forward.n}) [${m.verdict}]`));
console.log(`\n  除外候補:`);
exclMonitors.forEach(m => console.log(`    ${trendIcon(m.trend)} ${m.label}: fwd残存=${m.forward.residualPayoutRoi}% +${m.forward.improvPayout}pt [${m.verdict}]`));
