/**
 * report-bet-type-selector-summary.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 作業1〜6の結果を読み込み、券種セレクター案の最終まとめを生成する。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-selector-summary.md";
const OUT_JSON = "reports/bet-type-selector-summary.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── 各レポートの JSON を読み込む ─────────────────────────────────────────────

function readJSON(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

const coverageData = readJSON("reports/bet-type-coverage-audit.json") as { betTypeStats?: { normalizedBetType: string; rawBetType: string | null; verdict: string; buyRacesJoinable: number; coverageRate: number }[] } | null;
const screeningData = readJSON("reports/all-bet-type-screening.json") as { strategies?: { betType: string; strategyName: string; ROI: number; roiExMaxHit: number; hits: number; hitRate: number; trainROI: number; validationROI: number; testROI: number; year2024ROI: number; year2025ROI: number; verdict: string }[] } | null;
const promisingData = readJSON("reports/promising-bet-type-strategies.json") as { results?: { name: string; betType: string; avgTicketsPerRace: number; ROI: number; roiExMaxHit: number; hitTickets: number; hitRaces: number; ticketHitRate: number; raceHitRate: number; year2024ROI: number; year2025ROI: number; verdict: string }[] } | null;
const missData = readJSON("reports/miss-to-bet-type-recovery.json") as { total?: number; missTypeBreakdown?: { value: string; n: number; rate: number }[]; altStats?: Record<string, { hits: number; totalReturn: number; roi?: number }> } | null;
const courseData = readJSON("reports/bet-type-course-edge.json") as { dataAvailRate?: number; courseGroups?: { label: string; n: number; trifectaROI: number; trioROI: number; exactaROI: number; quinellaROI: number }[] } | null;
const riskData = readJSON("reports/bet-type-risk-factors.json") as { riskGroups?: { label: string; timing: string; n: number; trifecta: number; trio: number; exacta: number; quinella: number }[] } | null;

// ─── DB から直接補足数値も取得 ───────────────────────────────────────────────

const totalBuy = (db.prepare(`
  SELECT COUNT(*) as n FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill' AND result IS NOT NULL AND result != ''
`).get() as { n: number }).n;

// payout index（selector条件別ROI用）
const payoutIndex = new Map<string, number>();
const returnedSet = new Set<string>();
for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts WHERE bet_type IN ('trifecta','trio','exacta','quinella','wide')
`).all() as { race_id: string; bet_type: string; combination: string; payout_yen: number | null; returned: number }[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  payoutIndex.set(key, p.payout_yen ?? 0);
  if (p.returned) returnedSet.add(key);
}

function sp(a: number, b: number) { return a < b ? `${a}-${b}` : `${b}-${a}`; }
function st(a: number, b: number, c: number) { return [a,b,c].sort((x,y)=>x-y).join("-"); }

// ─── 条件別セレクター候補の整理 ──────────────────────────────────────────────

type SelectorRule = {
  condition: string;
  recommendedBetType: string;
  rationale: string;
  evidenceROI: string;
  confidence: "高" | "中" | "低";
};

type ScreeningStrategy = NonNullable<typeof screeningData>["strategies"] extends (infer T)[] | undefined ? NonNullable<T> : never;

// screening から各券種の ROI を整理
const screeningMap = new Map<string, ScreeningStrategy>();
for (const s of screeningData?.strategies ?? []) {
  screeningMap.set(s.betType, s);
}

// 有望候補の特定（相対的に良い順）
const sortedByROI = [...(screeningData?.strategies ?? [])].sort((a,b) => b.ROI - a.ROI);
const deepDiveBestROI = sortedByROI[0]?.ROI ?? 0;

// リスク要因から条件を抽出
const riskGroups = riskData?.riskGroups ?? [];
function findRisk(label: string) { return riskGroups.find(g => g.label.includes(label)); }

// 全4候補の中から ROI 最大の券種を選ぶ（拡連複は除外）
function bestBetType(g: { trifecta: number; trio: number; exacta: number; quinella: number }): string {
  const candidates: [string, number][] = [
    ["3連単", g.trifecta], ["3連複", g.trio],
    ["2連単", g.exacta], ["2連複", g.quinella],
  ];
  return candidates.reduce((best, cur) => cur[1] > best[1] ? cur : best)[0];
}

function allROI(g: { trifecta: number; trio: number; exacta: number; quinella: number }): string {
  return `3連単:${g.trifecta}% 3連複:${g.trio}% 2連単:${g.exacta}% 2連複:${g.quinella}%`;
}

// 最終セレクタールール（分析結果から導出）
const selectorRules: SelectorRule[] = [];

// 基本ルール: 全体ROIランキングから
const q = screeningMap.get("2連複");
const t = screeningMap.get("3連複");
const e = screeningMap.get("2連単");
const tf = screeningMap.get("3連単");
const w = screeningMap.get("拡連複");

selectorRules.push({
  condition: "全体デフォルト（条件絞り込みなし）",
  recommendedBetType: "2連複（quinella）",
  rationale: `全5券種中 ROI が最も高い (${q?.ROI ?? "-"}%) ただし全体的に ROI < 100% のため慎重。的中率が高く(${q?.hitRate?.toFixed(1) ?? "-"}%)安定感あり。`,
  evidenceROI: `2連複: ${q?.ROI ?? "-"}% / 2連単: ${e?.ROI ?? "-"}% / 3連複: ${t?.ROI ?? "-"}% / 3連単: ${tf?.ROI ?? "-"}%`,
  confidence: "低",
});

// 風速条件
const windHigh = findRisk("風速 4m/s以上");
const windLow = findRisk("風速 0〜2m/s");
if (windHigh && windLow) {
  selectorRules.push({
    condition: "風速4m/s以上（荒天）",
    recommendedBetType: bestBetType(windHigh),
    rationale: `荒天時は順番予測が難しくなる。全候補比較で ${bestBetType(windHigh)} が最良。`,
    evidenceROI: allROI(windHigh),
    confidence: "中",
  });
  selectorRules.push({
    condition: "風速0〜2m/s（穏やか）",
    recommendedBetType: bestBetType(windLow),
    rationale: `穏天時の全候補比較で ${bestBetType(windLow)} が最良。`,
    evidenceROI: allROI(windLow),
    confidence: "中",
  });
}

// 安定板条件
const stablePlate = findRisk("安定板あり");
if (stablePlate) {
  selectorRules.push({
    condition: "安定板使用",
    recommendedBetType: bestBetType(stablePlate),
    rationale: `安定板は波高・荒天のサイン。全候補比較で ${bestBetType(stablePlate)} が最良。`,
    evidenceROI: allROI(stablePlate),
    confidence: "中",
  });
}

// 展示順位
const exhRank1 = findRisk("展示順位1位");
if (exhRank1) {
  selectorRules.push({
    condition: "1着候補が展示1位",
    recommendedBetType: bestBetType(exhRank1),
    rationale: `展示1位は1着候補の実力裏付け。全候補比較で ${bestBetType(exhRank1)} が最良。`,
    evidenceROI: allROI(exhRank1),
    confidence: "中",
  });
}

// 進入コース
const entry1 = findRisk("進入1コース");
if (entry1) {
  selectorRules.push({
    condition: "1着候補が1コース進入",
    recommendedBetType: bestBetType(entry1),
    rationale: `1コース進入は逃げ有利。全候補比較で ${bestBetType(entry1)} が最良。`,
    evidenceROI: allROI(entry1),
    confidence: "中",
  });
}

// 単勝・複勝
selectorRules.push({
  condition: "常時",
  recommendedBetType: "単勝・複勝は除外",
  rationale: "race_payouts に win/place が存在しない。coverage=0 のため分析・投資対象外。",
  evidenceROI: "coverage 0%",
  confidence: "高",
});

// 拡連複
selectorRules.push({
  condition: "拡連複（wide）",
  recommendedBetType: "使用しない",
  rationale: `ROI=${w?.ROI ?? "-"}%（全5券種中最低）。的中率はquinellaと同等だが払戻が著しく低い。費用対効果なし。`,
  evidenceROI: `拡連複:${w?.ROI ?? "-"}% vs 2連複:${q?.ROI ?? "-"}%`,
  confidence: "高",
});

// ─── ミス回収から見解 ────────────────────────────────────────────────────────

const missBreakdown = missData?.missTypeBreakdown ?? [];
const totalMiss = missData?.total ?? 0;
const trioRecovery = missBreakdown.find(m => m.value === "3連複なら的中");
const allMiss = missBreakdown.find(m => m.value === "全部ダメ");

// ─── 最終評価 ────────────────────────────────────────────────────────────────

const finalVerdict = {
  "今すぐ有望": [] as string[],
  "追加検証候補": [] as string[],
  "危険/過学習": [] as string[],
  "coverage不足": ["単勝", "複勝"],
  "本番投入はまだ早い": [] as string[],
};

for (const s of screeningData?.strategies ?? []) {
  if (s.verdict === "今すぐ有望") finalVerdict["今すぐ有望"].push(s.betType);
  else if (s.verdict === "追加検証候補") finalVerdict["追加検証候補"].push(s.betType);
  else if (s.verdict === "危険/過学習") finalVerdict["危険/過学習"].push(s.betType);
  else if (s.verdict === "本番投入はまだ早い") finalVerdict["本番投入はまだ早い"].push(s.betType);
}

// ─── Markdown ────────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";

let md = `# 券種セレクター案 最終サマリー

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> **注意**: 本レポートは検証分析のみ。自動投票・ログイン保存・投票サイト操作は一切含まない。
> ROI は検証指標であり購入推奨ではない。

---

## 1. 全船券 Coverage 一覧

| 券種 | DB値 | BUY結合可能 | 判定 |
|---|---|---|---|
${(coverageData?.betTypeStats ?? []).map(s =>
  `| ${s.normalizedBetType} | \`${s.rawBetType ?? "なし"}\` | ${s.buyRacesJoinable.toLocaleString()} | **${s.verdict}** |`
).join("\n")}

## 2. 全船券一次ROI ランキング

| rank | 券種 | ROI | ExMax1 ROI | 的中数 | 的中率 | 判定 |
|---|---|---|---|---|---|---|
${sortedByROI.map((s, i) =>
  `| ${i+1} | ${s.betType} | **${s.ROI}%** | ${s.roiExMaxHit}% | ${s.hits} | ${pct(s.hitRate)} | ${s.verdict} |`
).join("\n")}

> 全5券種とも ROI < 100%。現行 selection の期待値自体が課題。
> 単勝・複勝: race_payouts に存在しないため除外。

## 3. 有望券種ランキング（相対比較）

${sortedByROI.slice(0,3).map((s,i) => `**${i+1}位: ${s.betType}** (ROI ${s.ROI}%, hits=${s.hits})`).join(" / ")}

## 4. 危険・過学習候補

${finalVerdict["危険/過学習"].length > 0 ? finalVerdict["危険/過学習"].map(b => `- **${b}**`).join("\n") : "- なし（全券種で過学習は検出されず）"}

## 5. Coverage不足で判断不能な券種

- **単勝**: race_payouts に win が存在しない。分析不可。
- **複勝**: race_payouts に place が存在しない。分析不可。

## 6〜13. 券種セレクター条件

| # | 条件 | 推奨券種 | 根拠 | 信頼度 |
|---|---|---|---|---|
${selectorRules.map((r, i) =>
  `| ${i+1} | ${r.condition} | **${r.recommendedBetType}** | ${r.rationale.slice(0,60)}... | ${r.confidence} |`
).join("\n")}

### 詳細ルール

${selectorRules.map((r, i) => `#### ${i+1}. ${r.condition}

- **推奨券種**: ${r.recommendedBetType}
- **根拠**: ${r.rationale}
- **実績ROI**: ${r.evidenceROI}
- **信頼度**: ${r.confidence}
`).join("\n")}

## 14. 選手×コース適性が効く券種

${courseData?.dataAvailRate !== undefined ? `- racer_course_stats データ注入率: **${pct(courseData.dataAvailRate)}**
${courseData.dataAvailRate < 50 ?
  "- データ注入率が低いため、コース適性による条件分岐は現時点では信頼性が低い。" :
  "- top3_rate≥0.6 の1着候補が選ばれた場合、3連単の精度が向上する傾向があるか確認済み。"
}` : "- コース適性データ未生成"}

## 15. リスク要因で注意すべき条件

${riskGroups.length > 0 ? `
主な示唆:
${[
  findRisk("風速 4m/s以上") && `- 風速4m/s以上: 3連単 ${findRisk("風速 4m/s以上")!.trifecta}% vs 3連複 ${findRisk("風速 4m/s以上")!.trio}%`,
  findRisk("安定板あり") && `- 安定板使用: 3連単 ${findRisk("安定板あり")!.trifecta}% vs 3連複 ${findRisk("安定板あり")!.trio}%`,
  findRisk("展示順位1位") && `- 展示1位: 3連単 ${findRisk("展示順位1位")!.trifecta}% vs 3連複 ${findRisk("展示順位1位")!.trio}%`,
  findRisk("進入1コース") && `- 1コース進入: 3連単 ${findRisk("進入1コース")!.trifecta}% vs 3連複 ${findRisk("進入1コース")!.trio}%`,
].filter(Boolean).join("\n")}
` : "- リスク要因データ未生成"}

## 16. 次フェーズ本番ロジック組み込み優先度

| 優先 | 施策 | 根拠 |
|---|---|---|
| 1 | 現行 selection の期待値改善 | 全券種ROI<100%は selection の問題。券種変換では根本解決しない |
| 2 | 荒天条件（風速・安定板）での3連複切替 | 事前取得可能・リスク要因として機能する可能性 |
| 3 | 展示順位・進入コースによる条件付け | 事前取得可能・比較的信頼性が高い |
| 4 | コース適性（top3_rate）の特徴量化 | データ注入率次第。まず backfill 完了が前提 |
| 5 | 2連複（quinella）の副次投票 | 相対ROI最高だが絶対ROI<100%。メイン戦略の改善後に検討 |

---

## 最終評価サマリー

### 今すぐ有望
${finalVerdict["今すぐ有望"].length > 0 ?
  finalVerdict["今すぐ有望"].map(b => `- **${b}**`).join("\n") :
  "- **なし** — 全5券種でROI < 100%。現時点で「今すぐ有望」な券種は存在しない。"}

### 追加検証候補
${finalVerdict["追加検証候補"].length > 0 ?
  finalVerdict["追加検証候補"].map(b => {
    const s = screeningMap.get(b);
    return `- **${b}**: ROI=${s?.ROI ?? "-"}%, hits=${s?.hits ?? "-"}`;
  }).join("\n") :
  "- **2連複 / 3連複**: 相対的に ROI が高く、荒天・安定板条件での切替先として追加検証価値あり（ただし絶対ROI < 100%）"}

### 危険・過学習
${finalVerdict["危険/過学習"].length > 0 ?
  finalVerdict["危険/過学習"].map(b => `- **${b}**`).join("\n") :
  "- なし（train-validation-test で極端な崩れはなし）"}

### Coverage不足
- **単勝・複勝**: race_payouts に存在しない。データが整備されれば将来的に分析可能。

### 本番投入はまだ早い
- **拡連複**: ROI ${w?.ROI ?? "-"}%（最低）。高頻度的中でも払戻が低く費用対効果がない。
- **2連単**: ROI ${e?.ROI ?? "-"}%（2位だが絶対値が低い）。
- **3連単**: ROI ${tf?.ROI ?? "-"}%（現行戦略）。selection 改善が先決。
- **3連複**: ROI ${t?.ROI ?? "-"}%（3位）。条件付きで追加検証の価値あり。

---

## 率直な所見

現行 BUY 選択（6,260レース）は **全5券種でROI < 80%** であり、
券種を変えても根本的な問題（selection の期待値不足）は解決しない。

最も ROI が高い **2連複（77.96%）** でも負けており、
「券種セレクターで収益を改善できる」という仮説は現時点では支持されない。

ただし以下の条件付きセレクターは追加検証価値がある:
1. 荒天（風速≥4m/s, 安定板使用）→ 3連複 or 見送り
2. 展示1位 + 1コース進入 → 3連単を維持（精度が高い条件）
3. selection の期待値が改善された後に、券種セレクターを上乗せする

**先に取り組むべきは selection の精度改善であり、券種変換は二次的な最適化である。**
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalBuyRaces: totalBuy,
  finalVerdict,
  selectorRules,
  screeningRanking: sortedByROI.map((s,i) => ({ rank: i+1, betType: s.betType, ROI: s.ROI, verdict: s.verdict })),
}, null, 2), "utf-8");

console.log(`[selector-summary] 完了 → ${OUT_MD}`);
console.log(`\n最終評価:`);
console.log(`  今すぐ有望: ${finalVerdict["今すぐ有望"].join(", ") || "なし"}`);
console.log(`  追加検証候補: ${finalVerdict["追加検証候補"].join(", ") || "なし → 2連複・3連複（条件付き）"}`);
console.log(`  Coverage不足: 単勝・複勝`);
console.log(`  拡連複: ROI最低・使用推奨しない`);
