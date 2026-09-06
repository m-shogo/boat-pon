/**
 * 現行BUYの確率を、同一母集団・時系列分割・実払戻で再較正する。
 * 読み取り専用。decision/app_settings/DBは変更しない。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/canonical-calibration.md";
const OUT_JSON = "reports/canonical-calibration.json";
const MODEL = "boatpon-v3-alpha15";
const BOUNDARY = "2025-01-01";
const TARGET_EV = 1.25;

type Row = {
  id: number; date: string; venue: string; race_id: string; selection: string;
  estimated_hit_rate: number; current_odds: number | null; required_odds: number | null;
  result: string | null; payout_yen: number | null; returned: number;
};
type Summary = {
  n: number; settled: number; hits: number; actualHitRate: number | null;
  avgEstimatedHitRate: number | null; calibrationFactor: number | null;
  payoutRoi: number | null; avgCurrentOdds: number | null;
};

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const rows = db.prepare(`
    SELECT id, date, venue, race_id, selection, estimated_hit_rate,
      current_odds, required_odds, result, payout_yen, returned
    FROM decision_history
    WHERE decision='BUY'
      AND run_kind='historical-backfill'
      AND model_version=?
      AND bet_type='3連単'
      AND result IS NOT NULL AND result!=''
      AND returned=0
      AND current_odds IS NOT NULL
    ORDER BY date, id
  `).all(MODEL) as Row[];

  assertPayoutCompleteness(rows);

  const train = rows.filter((r) => r.date < BOUNDARY);
  const forward = rows.filter((r) => r.date >= BOUNDARY);
  const trainSummary = summary(train);
  const forwardSummary = summary(forward);
  const trainFactor = trainSummary.calibrationFactor ?? 1;

  const replayRows = forward.map((r) => {
    const calibrated = Math.min(0.8, Math.max(0.0001, r.estimated_hit_rate * trainFactor));
    const odds = r.current_odds;
    const ev = odds == null ? null : calibrated * odds;
    return { ...r, calibrated, ev, selected: ev != null && ev >= TARGET_EV && odds != null && odds <= 80 };
  });
  const replaySummary = summary(replayRows.filter((r) => r.selected));

  const bands = [
    [0, 0.02, "<2%"], [0.02, 0.03, "2-3%"], [0.03, 0.04, "3-4%"],
    [0.04, 0.05, "4-5%"], [0.05, Infinity, "5%+"],
  ] as const;
  const bandRows = bands.map(([min, max, label]) => ({
    label,
    ...summary(rows.filter((r) => r.estimated_hit_rate >= min && r.estimated_hit_rate < max)),
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    safety: { readOnly: true, dbWrites: false, productionConnected: false, productionChanged: false },
    contract: {
      model: MODEL, betType: "3連単", decision: "BUY", runKind: "historical-backfill",
      boundary: BOUNDARY, payoutBasis: "decision_history.payout_yen / 100円", currentOddsOnlyForReplay: true,
    },
    cohorts: { all: summary(rows), train: trainSummary, forward: forwardSummary, replaySelected: replaySummary },
    trainFactor,
    bands: bandRows,
    caveats: [
      "historical-backfillのBUY台帳を同じrace_id集合で評価した監査であり、モデル再学習ではない",
      "train係数をforwardへ一度だけ適用した再生。replaySelectedは本番導入根拠ではない",
      "current_oddsは暫定値なので、ROI判定はpayout_yenを主とする",
      "返還(returned=1)と未確定(result=NULL)は母集団から除外",
    ],
  };

  const lines = [
    "# 現行BUY canonical calibration", "", `生成日時: ${report.generatedAt}`, "",
    "> 読み取り専用。実払戻ベース。BUY通知・本番判定・DBは変更していない。", "",
    "## 評価契約", "",
    `- model: ${MODEL} / bet_type: 3連単 / decision: BUY / run_kind: historical-backfill`,
    `- train: 2024年（${BOUNDARY}未満） / forward: ${BOUNDARY}以降`,
    "- 主評価: payout_yen。current_oddsは再生条件の補助値のみ。", "",
    "## 同一母集団の結果", "",
    "| 期間 | n | 的中 | 的中率 | 平均推定 | 較正係数(実績/推定) | 実払戻ROI | 平均current_odds |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    `| 全体 | ${report.cohorts.all.n} | ${report.cohorts.all.hits} | ${pct(report.cohorts.all.actualHitRate)} | ${pct(report.cohorts.all.avgEstimatedHitRate)} | ${num(report.cohorts.all.calibrationFactor)} | ${pct(report.cohorts.all.payoutRoi)} | ${num(report.cohorts.all.avgCurrentOdds)} |`,
    `| train | ${trainSummary.n} | ${trainSummary.hits} | ${pct(trainSummary.actualHitRate)} | ${pct(trainSummary.avgEstimatedHitRate)} | ${num(trainSummary.calibrationFactor)} | ${pct(trainSummary.payoutRoi)} | ${num(trainSummary.avgCurrentOdds)} |`,
    `| forward | ${forwardSummary.n} | ${forwardSummary.hits} | ${pct(forwardSummary.actualHitRate)} | ${pct(forwardSummary.avgEstimatedHitRate)} | ${num(forwardSummary.calibrationFactor)} | ${pct(forwardSummary.payoutRoi)} | ${num(forwardSummary.avgCurrentOdds)} |`,
    "", "## 推定確率帯別（全期間）", "",
    "| 推定帯 | n | 的中 | 実績的中率 | 平均推定 | 較正係数 | 実払戻ROI |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...bandRows.map((r) => `| ${r.label} | ${r.n} | ${r.hits} | ${pct(r.actualHitRate)} | ${pct(r.avgEstimatedHitRate)} | ${num(r.calibrationFactor)} | ${pct(r.payoutRoi)} |`),
    "", "## train係数をforwardへ適用した再生", "",
    `- train係数: **${num(trainFactor)}**（推定確率を一律 ${(trainFactor * 100).toFixed(1)}% に縮小）`,
    `- forward既存BUY: ${forwardSummary.n}件 → EV再計算で残る候補: ${replaySummary.n}件`,
    `- 残る候補の実績: ${replaySummary.hits}的中 / ${pct(replaySummary.actualHitRate)} / 実払戻ROI ${pct(replaySummary.payoutRoi)}`,
    "", "## 判定", "",
    "- 確率は全体として過大評価されている。学習期の係数をforwardへ持ち込むとBUY候補数は減る。",
    "- ただし、再生結果だけで本番の閾値や係数を決めない。次は月次・会場LOO・最大払戻除外を含む固定forwardで再検証する。",
    "- 新しい特徴量追加は、較正と時点整合性の検証が終わるまで停止する。",
  ];

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, `${lines.join("\n")}\n`);
  console.log(`[canonical-calibration] wrote ${OUT_MD} / ${OUT_JSON}`);
} finally {
  db.close();
}

function assertPayoutCompleteness(rows: Row[]): void {
  const byPeriod = Object.fromEntries(["train", "forward"].map((period) => {
    const periodRows = rows.filter((row) => period === "train" ? row.date < BOUNDARY : row.date >= BOUNDARY);
    const hits = periodRows.filter((row) => row.result === row.selection);
    const paidHits = hits.filter((row) => row.payout_yen != null && row.payout_yen > 0);
    return [period, { total: periodRows.length, hits: hits.length, paidHits: paidHits.length, missingHitPayouts: hits.length - paidHits.length }];
  }));
  const invalid = ["train", "forward"].some((period) => {
    const value = byPeriod[period];
    return value.total <= 0 || value.hits <= 0 || value.paidHits !== value.hits || value.missingHitPayouts !== 0;
  });
  if (invalid) throw new Error(`CANONICAL_CALIBRATION_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
}

function summary(input: Row[]): Summary {
  const settled = input.filter((r) => r.result != null);
  const hits = settled.filter((r) => r.result === r.selection);
  const actual = settled.length ? hits.length / settled.length : null;
  const estimated = settled.length ? mean(settled.map((r) => r.estimated_hit_rate)) : null;
  const payout = settled.length
    ? settled.reduce((sum, row) => sum + (row.result === row.selection ? requiredHitPayout(row) : 0), 0) / (settled.length * 100)
    : null;
  return {
    n: input.length, settled: settled.length, hits: hits.length,
    actualHitRate: actual, avgEstimatedHitRate: estimated,
    calibrationFactor: actual != null && estimated ? actual / estimated : null,
    payoutRoi: payout,
    avgCurrentOdds: settled.length ? mean(settled.map((r) => r.current_odds ?? 0)) : null,
  };
}
function requiredHitPayout(row: Row): number {
  if (row.payout_yen == null || row.payout_yen <= 0) throw new Error(`CANONICAL_CALIBRATION_HIT_PAYOUT_MISSING race=${row.race_id}`);
  return row.payout_yen;
}
function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function pct(value: number | null) { return value == null ? "-" : `${(value * 100).toFixed(2)}%`; }
function num(value: number | null) { return value == null ? "-" : value.toFixed(3); }
