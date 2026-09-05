/**
 * report-paper-forward-candidates.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補であり購入指示ではない。ROI は検証指標であり購入推奨ではない。
 * 判断基準: race_payouts.payout_yen 実払戻ベース（current_odds は参考値のみ）
 *
 * 目的: payout_yen 基準に移行した後の paper-forward 監視候補を一本化した台帳を生成。
 *       switch候補・除外候補・残存候補・過信注意・forward判定ルールを整理する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD  = "reports/paper-forward-candidates.md";
const OUT_JSON = "reports/paper-forward-candidates.json";
const STAKE = 100;

const EXCLUDED_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const BASE_WHERE = `
  decision='BUY' AND run_kind='historical-backfill'
  AND result IS NOT NULL AND result != ''
  AND venue NOT IN (${EXCLUDED_VENUES.map(v => `'${v}'`).join(",")})
  AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`;

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

const BOAT2_FASTER = `EXISTS (
  SELECT 1 FROM race_entries re2
  JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course
  JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3
  JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course
  WHERE re2.race_id=dh.race_id AND re2.boat=2
    AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL
    AND ed2.exhibition_time < ed3.exhibition_time
)`;

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;

const EXH1_RANK23 = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
)`;

const EXH1_RANK4PLUS = `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) >= 3
)`;

// ─── 型 ──────────────────────────────────────────────────────────────────────

type NConfidence = "判定不可(n<30)" | "仮判定(n≥30)" | "要確認(n≥50)" | "継続/降格判断(n≥100)";
type PayoutVerdict = "strong(≥105%)" | "watch(100〜105%)" | "weak-watch(95〜100%)" | "reject(<95%)";

type SwitchCandidate = {
  id: string;
  label: string;
  from: string;
  to: string;
  n: number;
  currentRoi: number;
  payoutRoiFrom: number;
  payoutRoiTo: number;
  switchGain: number;
  nConfidence: NConfidence;
  payoutVerdict: PayoutVerdict;
  note?: string;
};

type ExcludeCandidate = {
  id: string;
  label: string;
  exclN: number;
  residualN: number;
  basePayoutRoi: number;
  residualPayoutRoi: number;
  improvPayout: number;
  payoutVerdict: PayoutVerdict;
  caution?: string;
};

type KeepCandidate = {
  id: string;
  label: string;
  n: number;
  currentRoi: number;
  payoutRoi: number;
  note: string;
};

type OverconfidentCondition = {
  label: string;
  currentRoi: number;
  payoutRoi: number;
  gap: number;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function nConf(n: number): NConfidence {
  if (n >= 100) return "継続/降格判断(n≥100)";
  if (n >= 50)  return "要確認(n≥50)";
  if (n >= 30)  return "仮判定(n≥30)";
  return "判定不可(n<30)";
}

function payoutVerdict(roi: number): PayoutVerdict {
  if (roi >= 105) return "strong(≥105%)";
  if (roi >= 100) return "watch(100〜105%)";
  if (roi >= 95)  return "weak-watch(95〜100%)";
  return "reject(<95%)";
}

function r100(v: number) { return Math.round(v * 100) / 100; }

function queryBoth(where: string, selFilter = "") {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const row = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${selW} ${condW}
  `).get() as { n: number; hits: number; cr: number; pr: number };
  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? r100(v / stake * 100) : 0;
  return { n, hits: row.hits ?? 0, currentRoi: roi(row.cr ?? 0), payoutRoi: roi(row.pr ?? 0) };
}

function querySwitch(where: string, selFilter = "") {
  const selW = selFilter ? `AND ${selFilter}` : "";
  const condW = where ? `AND (${where})` : "";
  const row = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as cr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination=dh.selection LIMIT 1), 0)) as pr,
      SUM(COALESCE((SELECT rp.payout_yen FROM race_payouts rp
        WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0)) as pr132
    FROM decision_history dh
    WHERE ${BASE_WHERE} ${selW} ${condW}
  `).get() as { n: number; cr: number; pr: number; pr132: number };
  const n = row.n ?? 0;
  const stake = n * STAKE;
  const roi = (v: number) => stake > 0 ? r100(v / stake * 100) : 0;
  return {
    n,
    currentRoi: roi(row.cr ?? 0),
    payoutRoiFrom: roi(row.pr ?? 0),
    payoutRoiTo:   roi(row.pr132 ?? 0),
    switchGain: r100(roi(row.pr132 ?? 0) - roi(row.pr ?? 0)),
  };
}

function queryResidual(excludeWhere: string, selFilter = "") {
  const base = queryBoth("", selFilter);
  const excl = queryBoth(excludeWhere, selFilter);
  const rest = queryBoth(`NOT (${excludeWhere})`, selFilter);
  return { base, excl, rest };
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

console.log("[paper-forward] 全候補を最新データで再集計中...");

const BASE = queryBoth("", "selection='1-2-3'");
console.log(`  ベースライン: n=${BASE.n} current=${BASE.currentRoi}% payout=${BASE.payoutRoi}%`);

// ── switch候補 ───────────────────────────────────────────────────────────────

const switchCandidates: SwitchCandidate[] = [];

const switchDefs = [
  { id: "sw_wind24_exh1",  label: "風速2〜4 × 1号艇展示1位", where: `(${WIND24}) AND (${EXH1_FASTEST})` },
  { id: "sw_suminoe_o40",  label: "住之江 × odds40〜49",      where: "venue='住之江' AND current_odds>=40 AND current_odds<50" },
  { id: "sw_suminoe_exh1", label: "住之江 × 1号艇展示1位",   where: `venue='住之江' AND (${EXH1_FASTEST})` },
  { id: "sw_suminoe_r5",   label: "住之江 × 5R",             where: "venue='住之江' AND race_no=5" },
];

for (const d of switchDefs) {
  const q = querySwitch(d.where, "selection='1-2-3'");
  const c: SwitchCandidate = {
    id: d.id,
    label: d.label,
    from: "3連単1-2-3",
    to:   "3連単1-3-2",
    n: q.n,
    currentRoi: q.currentRoi,
    payoutRoiFrom: q.payoutRoiFrom,
    payoutRoiTo:   q.payoutRoiTo,
    switchGain: q.switchGain,
    nConfidence: nConf(q.n),
    payoutVerdict: payoutVerdict(q.payoutRoiTo),
  };
  if (q.n < 50) c.note = "n<50 — forward で再現性確認必須";
  switchCandidates.push(c);
  console.log(`  switch: ${d.label} n=${q.n} payout1-3-2=${q.payoutRoiTo}% (${c.nConfidence})`);
}

// ── 除外候補 ─────────────────────────────────────────────────────────────────

const excludeCandidates: ExcludeCandidate[] = [];

const exclDefs = [
  { id: "ex_exh1",      label: "1号艇展示1位 除外",            where: EXH1_FASTEST },
  { id: "ex_boat3",     label: "3号艇が2号艇より展示速い 除外", where: BOAT3_FASTER },
  { id: "ex_race5",     label: "5R 除外",                      where: "race_no=5" },
  { id: "ex_odds80",    label: "odds 80以上 除外",              where: "current_odds>=80" },
  {
    id: "ex_wind24_caut",
    label: "風速2〜4m/s 除外（注意付き）",
    where: WIND24,
    caution: "switch候補「風速2〜4 × 1号艇展示1位」を含む。全除外ではなく switch 条件で別管理を推奨",
  },
];

for (const d of exclDefs) {
  const { base, excl, rest } = queryResidual(d.where, "selection='1-2-3'");
  const improv = r100(rest.payoutRoi - base.payoutRoi);
  const c: ExcludeCandidate = {
    id: d.id,
    label: d.label,
    exclN: excl.n,
    residualN: rest.n,
    basePayoutRoi: base.payoutRoi,
    residualPayoutRoi: rest.payoutRoi,
    improvPayout: improv,
    payoutVerdict: payoutVerdict(rest.payoutRoi),
    ...(d.caution ? { caution: d.caution } : {}),
  };
  excludeCandidates.push(c);
  console.log(`  excl: ${d.label} 残存payout=${rest.payoutRoi}% (+${improv}pt)`);
}

// ── 残すべき条件 ─────────────────────────────────────────────────────────────

const keepCandidates: KeepCandidate[] = [];

const keepDefs = [
  { id: "keep_suminoe_o25", label: "住之江 × odds25〜39", where: "venue='住之江' AND current_odds>=25 AND current_odds<40", sel: "selection='1-2-3'", note: "住之江全除外を行う場合も、この条件は除外しない" },
];

for (const d of keepDefs) {
  const q = queryBoth(d.where, d.sel);
  keepCandidates.push({
    id: d.id, label: d.label, n: q.n,
    currentRoi: q.currentRoi, payoutRoi: q.payoutRoi,
    note: d.note,
  });
  console.log(`  keep: ${d.label} n=${q.n} payout=${q.payoutRoi}%`);
}

// ── current_odds 過信注意 ─────────────────────────────────────────────────────

const overconfident: OverconfidentCondition[] = [];
const overconfDefs = [
  { label: "1号艇展示タイム4位以下", where: EXH1_RANK4PLUS, sel: "selection='1-2-3'" },
  { label: "2号艇が3号艇より展示速い", where: BOAT2_FASTER, sel: "selection='1-2-3'" },
  { label: "1号艇展示タイム2〜3位",   where: EXH1_RANK23,   sel: "selection='1-2-3'" },
];
for (const d of overconfDefs) {
  const q = queryBoth(d.where, d.sel);
  overconfident.push({ label: d.label, currentRoi: q.currentRoi, payoutRoi: q.payoutRoi, gap: r100(q.currentRoi - q.payoutRoi) });
  console.log(`  overconf: ${d.label} current=${q.currentRoi}% payout=${q.payoutRoi}%`);
}

// ─── forward判定ルール（固定定義） ──────────────────────────────────────────

const forwardRules = {
  nThresholds: [
    { n: 30,  label: "n≥30: 仮判定（forward開始可）" },
    { n: 50,  label: "n≥50: 要確認（結果の方向感をチェック）" },
    { n: 100, label: "n≥100: 継続 or 降格判断" },
  ],
  payoutBands: [
    { min: 105, label: "strong(≥105%): 継続観察" },
    { min: 100, label: "watch(100〜105%): 継続観察（週次確認）" },
    { min: 95,  label: "weak-watch(95〜100%): 条件付き継続" },
    { min: 0,   label: "reject(<95%): 降格候補" },
  ],
  recordingRules: [
    "switch候補: 実際の買い目（1-2-3）とswitch先（1-3-2）の両方のpayout_yenを記録",
    "除外候補: 除外対象が的中したか、除外後残存のROIが改善したかを追跡",
    "判断基準: race_payouts.payout_yen のみ（current_odds は参考値）",
    "app_settings変更禁止: forward観察のみ、本番ロジック変更は行わない",
  ],
  promotionCriteria: {
    switch: "n≥100 かつ forward payout ROI ≥ 100% で 3ヶ月継続",
    exclude: "除外後 forward payout ROI が baseline を +5pt 超で 3ヶ月継続",
    demotion: "forward payout ROI < 85% が 2ヶ月連続",
  },
};

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const confirmed = switchCandidates.filter(c => c.payoutRoiTo >= 100);
const pending    = switchCandidates.filter(c => c.payoutRoiTo < 100);

let md = `# paper-forward 候補台帳（payout_yen 基準）

生成日時: ${now}
DB: ${DB_PATH}

> **禁止事項**: app_settings変更 / DBへの書き込み / 本番decisionロジック変更 / 自動投票
> **ROI基準**: race_payouts.payout_yen 実払戻（current_odds は参考値のみ）
> BUYは検証候補、ROIは検証指標であり購入推奨ではない。

---

## 現時点のベースライン

| 対象 | n | current_odds ROI | **実払戻 ROI** | gap |
|---|---|---|---|---|
| 全体（除外後） | ${BASE.n} | ${BASE.currentRoi}% | **${BASE.payoutRoi}%** | ${r100(BASE.currentRoi - BASE.payoutRoi)}pt |

> 実払戻ベースで **${BASE.payoutRoi}%（黒字圏外）**。候補の採用・除外で引き上げを目指す。

---

## 分類 1: switch候補（最優先）
> 1-2-3 を 1-3-2 に変換すると実払戻ROIが向上する条件。
> **app_settings変更はしない。forward観察のみ。**

### backtest上のswitch候補（実払戻 1-3-2 >= 100%）
> backtest結果であり本採用確定ではない。forward で再現性確認後に判断。

| 優先 | 条件 | n | 変換 | 現行payout | **switch payout** | 改善 | 信頼度 |
|---|---|---|---|---|---|---|---|
${confirmed.map((c, i) =>
  `| ${i+1} | **${c.label}** | ${c.n} | ${c.from} → ${c.to} | ${c.payoutRoiFrom}% | **${c.payoutRoiTo}%** | +${c.switchGain}pt | ${c.nConfidence} |`
).join("\n")}

${confirmed.map(c => c.note ? `> ⚠️ **${c.label}**: ${c.note}` : "").filter(Boolean).join("\n")}

${pending.length > 0 ? `### 保留（改善あり、100%未満）

| 条件 | n | switch payout | 判定 |
|---|---|---|---|
${pending.map(c => `| ${c.label} | ${c.n} | ${c.payoutRoiTo}% | ${c.nConfidence} |`).join("\n")}
` : ""}
---

## 分類 2: 除外候補
> 除外後の残存 payout ROI がベースラインより改善する条件。
> 改善後も黒字（>=100%）に届いていない点に注意。

| 優先 | 条件 | 除外n | 残存n | **残存 payout ROI** | ベースから改善 | 注意 |
|---|---|---|---|---|---|---|
${excludeCandidates.map((c, i) =>
  `| ${i+1} | ${c.label} | ${c.exclN} | ${c.residualN} | **${c.residualPayoutRoi}%** | +${c.improvPayout}pt | ${c.caution ?? "—"} |`
).join("\n")}

> ベースライン: 実払戻 ${BASE.payoutRoi}%

---

## 分類 3: 残すべき条件（住之江全除外を行う場合でも保持）

| 条件 | n | current ROI | **実払戻 ROI** | 備考 |
|---|---|---|---|---|
${keepCandidates.map(c =>
  `| **${c.label}** | ${c.n} | ${c.currentRoi}% | **${c.payoutRoi}%** | ${c.note} |`
).join("\n")}

---

## 分類 4: current_odds 過信注意（実払戻 < 95%）

| 条件 | n | current ROI | **実払戻 ROI** | **gap** |
|---|---|---|---|---|
${overconfident.map(c =>
  `| ${c.label} | — | ${c.currentRoi}% | **${c.payoutRoi}%** | ${c.gap}pt |`
).join("\n")}

> これらの条件は current_odds ベースで有望に見えるが、実払戻では黒字圏外。
> 除外・スキップの根拠として使用するが、積極採用の根拠には使わない。

---

## forward 判定ルール

### n基準（サンプルサイズ）

| n | 判定レベル |
|---|---|
${forwardRules.nThresholds.map(t => `| ${t.n}+ | ${t.label} |`).join("\n")}

### 実払戻 ROI バンド

| ROI | 判定 |
|---|---|
${forwardRules.payoutBands.map(b => `| ${b.min}%+ | ${b.label} |`).join("\n")}

### 記録ルール
${forwardRules.recordingRules.map(r => `- ${r}`).join("\n")}

### 本採用・降格基準

| アクション | 条件 |
|---|---|
| switch本採用 | ${forwardRules.promotionCriteria.switch} |
| 除外本採用 | ${forwardRules.promotionCriteria.exclude} |
| 降格 | ${forwardRules.promotionCriteria.demotion} |

---

## 結論・次のアクション

### 現時点の方針
1. **app_settings変更なし** — forward 観察のみ
2. **switch候補 ${confirmed.length}件** を forward で実払戻追跡（現行1-2-3 vs switch先1-3-2）
3. **除外候補 ${excludeCandidates.filter(c => !c.caution).length}件 + 注意付き1件（風速2〜4）** を forward で残存ROI追跡
4. **風速2〜4は全除外せず** switch条件（風速2〜4 × 1号艇展示1位）として別管理
5. **住之江 × odds25〜39 は保持** — 住之江全除外を検討する場合も除外しない

### forward 優先順位
| 優先 | 候補 | 理由 |
|---|---|---|
| 1 | 風速2〜4 × 1号艇展示1位 → 1-3-2 | n=488 最大サンプル / payout 103.2% |
| 2 | 1号艇展示1位 除外 | +8.85pt 最大改善 |
| 3 | 住之江系 switch 3件 | payout 142〜211% だが n<60 で再現性要確認 |

> **ROI判断基準変更まとめ**
> 旧: current_odds * 100（暫定オッズ、楽観的）
> 新: race_payouts.payout_yen（実際払戻、保守的、14.94ptギャップ）
> gap >= 10pt の条件は current_odds 判断を信頼しない。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  baseline: BASE,
  switchCandidates,
  excludeCandidates,
  keepCandidates,
  overconfident,
  forwardRules,
}, null, 2), "utf-8");

console.log(`\n[paper-forward] 完了 → ${OUT_MD}`);
console.log(`\n【switch候補 確定 ${confirmed.length}件】`);
confirmed.forEach((c, i) => console.log(`  ${i+1}. ${c.label}: payout1-3-2=${c.payoutRoiTo}% n=${c.n} ${c.nConfidence}`));
console.log(`\n【除外候補 ${excludeCandidates.length}件（改善幅順）】`);
[...excludeCandidates].sort((a, b) => b.improvPayout - a.improvPayout).forEach((c, i) =>
  console.log(`  ${i+1}. ${c.label}: 残存payout=${c.residualPayoutRoi}% +${c.improvPayout}pt`)
);
console.log(`\n【残すべき条件 ${keepCandidates.length}件】`);
keepCandidates.forEach(c => console.log(`  ${c.label}: payout=${c.payoutRoi}% n=${c.n}`));
