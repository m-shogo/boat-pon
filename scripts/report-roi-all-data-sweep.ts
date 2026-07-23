/**
 * report-roi-all-data-sweep.ts — 既存の読み取り専用探索結果を1枚に集約する。
 * DB・app_settings・本番判定は変更しない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const REPORT_DIR = "reports";
const OUT_MD = `${REPORT_DIR}/roi-all-data-sweep.md`;
const OUT_JSON = `${REPORT_DIR}/roi-all-data-sweep.json`;
const read = (name: string): any => existsSync(`${REPORT_DIR}/${name}`) ? JSON.parse(readFileSync(`${REPORT_DIR}/${name}`, "utf8")) : null;
const docs = [
  ["選手能力/モーターのpoint-in-time screen", "unconventional-feature-screen.json"],
  ["局所市場異常（会場・風・選手構成）", "local-market-anomaly-deep-dive.json"],
  ["選手関係proxy", "racer-relationship-market-screen.json"],
  ["開催イベント文脈", "event-selection-matrix.json"],
  ["開催ステージ", "event-stage-market-screen.json"],
  ["同日リズム", "same-day-rhythm-market-screen.json"],
  ["当日水面ムード", "track-mood-market-screen.json"],
  ["支部・年齢・身体情報", "human-profile-market-screen.json"],
  ["市場マイクロ構造", "market-microstructure-screen.json"],
  ["投票者attention", "market-attention-screen.json"],
  ["会場×風向×4号艇相対能力", "wind-direction-venue-screen.json"],
] as const;
const now = new Date().toISOString();
const sourceMeta = docs.map(([label, file]) => {
  const x = read(file);
  return { label, file, generatedAt: x?.generatedAt ?? null, stable: x?.stable?.length ?? null, robust: x?.robust?.length ?? null, matchedPositive: x?.matchedPositive?.length ?? null };
});

const lines = [
  "# 全データ横断 ROI探索サマリー",
  "",
  `生成日時: ${now}`,
  "",
  "> 選手・モーター・ボート・当地/全国成績・展示ST・開催・天候/風・同日結果・市場構造・attentionを横断した読み取り専用探索。exactaの一部はhistorical closing oddsであり、現行3連単BUYやT-5の利益証明ではない。",
  "",
  "## 探索結果の要約",
  "",
  "|領域|両期間で方向が揃った候補|頑健/採用可能|判断|",
  "|---|---|---:|---|",
  "|選手能力・モーター|能力断層、強選手×弱モーター、前走勝利、短期会場移動|—|勝率仮説。現行BUYの利益edge未確認|",
  "|会場・風・選手構成|風速2〜3m×南西風×4号艇相対能力上位|0|n=52/24、post-hoc・closing odds。紙検証候補止まり|",
  "|選手関係proxy|同走・直接対戦・登録番号近接|0|期間符号が揃わず、個人関係の推測は不使用|",
  "|開催/イベント/ステージ|ルーキー、周年、進入固定など|0|最大2的中除外ROIが両期100%のセルなし|",
  "|同日リズム/水面ムード|前走着順・当日外枠勝ち・F発生|0|2024/2025で反転または高配当依存|",
  "|人物属性|年齢、支部、体重、血液型placebo|0|placeboも残差を出すため採用不可|",
  "|市場構造/attention|人気順位、1号艇mass、締切集中|0|closing oddsで見つかるがT-5再現なし|",
  "",
  "## 最も重要な未解決点",
  "",
  "1. current_oddsは実払戻しより楽観的で、現行1-2-3の乖離は約14ポイント。",
  "2. v3-alpha15のBUY推定的中率は実績の約2倍。選手データを増やすだけでは解決しない。",
  "3. 会場別モーター値を特徴量では使う一方、maxMotorTop2Rateの除外判定は全国値側を参照する不整合がある。",
  "4. 選手course_statsは全体の3連対率カバレッジが90.6%、2026-07-20 BUYは100%だが、過去期間のpoint-in-time鮮度には制約が残る。",
  "5. 候補を本番BUYへ接続するには、T-5取得→実払戻し→時系列未使用テスト→最大2件除外→会場LOOを同時に通す必要がある。",
  "",
  "## 出典レポートの再生成状況",
  "",
  "|レポート|生成日時|stable|robust|matchedPositive|",
  "|---|---|---:|---:|---:|",
  ...sourceMeta.map(x => `|${x.label}|${x.generatedAt ?? "未生成"}|${x.stable ?? "—"}|${x.robust ?? "—"}|${x.matchedPositive ?? "—"}|`),
  "",
  "## 結論",
  "",
  "現時点で、選手などのデータを追加しても本番BUYを黒字化できると検証済みの条件はない。最有力の次段階は、風向を会場ごとの向かい風/追い風へ正規化し、4号艇相対能力との組合せを事前固定してT-5 paper-forwardで検証すること。ただし本番判定・自動購入へは接続しない。",
];

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(OUT_MD, `${lines.join("\n")}\n`, "utf8");
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: now, sources: sourceMeta, verdict: "no_production_candidate", next: "wind-direction-normalization-and-T5-paper-forward" }, null, 2) + "\n", "utf8");
console.log(`[all-data-sweep] 完了 → ${OUT_MD}`);
