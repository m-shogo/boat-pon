/**
 * 2023-2024だけで3着順のPlackett-Luce型モデルを学習し、2025/2026を固定forward評価する。
 * 当時の番組情報と展示タイムだけを使用し、ST・着順・決まり手・将来統計は特徴量にしない。
 * 読み取り専用。本番判定・DB・app_settingsは変更しない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const EPOCHS = Number(process.env.BOAT_PON_RANKING_EPOCHS ?? 12);
const OUT_MD = "reports/historical-ranking-forward.md";
const OUT_JSON = "reports/historical-ranking-forward.json";
const OUT_MODEL = "reports/historical-ranking-model.json";
if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

type ProgramBoat = {
  course: number;
  className?: string | null;
  nationalWinRate?: number | null;
  nationalTop2Rate?: number | null;
  localWinRate?: number | null;
  localTop2Rate?: number | null;
  motorTop2Rate?: number | null;
  boatTop2Rate?: number | null;
};
type Program = { boats?: ProgramBoat[] };
type SourceRow = {
  race_id: string;
  date: string;
  raw_json: string;
  trifecta: string;
  payout_yen: number;
  payout_source: string;
};
type ExhibitionRow = { race_id: string; boat: number; exhibition_time: number };
type Boat = ProgramBoat & { exhibitionScore: number };
type Race = { raceId: string; date: string; order: number[]; payoutYen: number; payoutSource: string; boats: Boat[] };
type FeatureSet = { id: string; label: string; dimensions: number; vector: (boat: Boat) => number[] };
type RankingModel = { featureSet: FeatureSet; weights: number[][] };

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
const sourceRows = db.prepare(`
  SELECT
    programs.race_id,
    programs.date,
    programs.raw_json,
    results.trifecta,
    COALESCE(payouts.payout_yen, results.payout_yen) AS payout_yen,
    CASE WHEN payouts.payout_yen IS NOT NULL THEN 'race_payouts' ELSE 'race_results' END AS payout_source
  FROM official_programs programs
  JOIN race_results results ON results.race_id = programs.race_id
  LEFT JOIN race_payouts payouts
    ON payouts.race_id = results.race_id
   AND payouts.bet_type = 'trifecta'
   AND payouts.combination = results.trifecta
  WHERE programs.date >= '2023-01-01'
    AND programs.date <= '2026-12-31'
    AND results.returned = 0
    AND results.trifecta IS NOT NULL
    AND COALESCE(payouts.payout_yen, results.payout_yen) IS NOT NULL
  ORDER BY programs.date, programs.race_id
`).all() as SourceRow[];
const exhibitionRows = db.prepare(`
  SELECT race_id, boat, exhibition_time
  FROM race_entries
  WHERE date >= '2023-01-01' AND date <= '2026-12-31'
    AND exhibition_time IS NOT NULL
  ORDER BY race_id, boat
`).all() as ExhibitionRow[];
db.close();

const exhibitionByRace = new Map<string, Map<number, number>>();
for (const row of exhibitionRows) {
  const values = exhibitionByRace.get(row.race_id) ?? new Map<number, number>();
  values.set(row.boat, row.exhibition_time);
  exhibitionByRace.set(row.race_id, values);
}

let rejectedProgram = 0;
let rejectedExhibition = 0;
const races: Race[] = [];
for (const row of sourceRows) {
  let program: Program;
  try { program = JSON.parse(row.raw_json) as Program; } catch { rejectedProgram += 1; continue; }
  const sourceBoats = [...(program.boats ?? [])].sort((a, b) => a.course - b.course);
  const order = row.trifecta.split("-").map(Number);
  if (sourceBoats.length !== 6 || sourceBoats.some((boat, index) => boat.course !== index + 1)
    || order.length !== 3 || new Set(order).size !== 3 || order.some((course) => course < 1 || course > 6)) {
    rejectedProgram += 1;
    continue;
  }
  const exhibition = exhibitionByRace.get(row.race_id);
  if (!exhibition || sourceBoats.some((boat) => !Number.isFinite(exhibition.get(boat.course)))) {
    rejectedExhibition += 1;
    continue;
  }
  const ranked = sourceBoats
    .map((boat) => ({ course: boat.course, time: exhibition.get(boat.course)! }))
    .sort((a, b) => a.time - b.time || a.course - b.course);
  const rankByCourse = new Map(ranked.map((value, index) => [value.course, index]));
  races.push({
    raceId: row.race_id,
    date: row.date,
    order,
    payoutYen: row.payout_yen,
    payoutSource: row.payout_source,
    boats: sourceBoats.map((boat) => ({ ...boat, exhibitionScore: 1 - (rankByCourse.get(boat.course) ?? 5) / 5 })),
  });
}

const train = races.filter((race) => race.date < "2025-01-01");
const validation = races.filter((race) => race.date >= "2025-01-01" && race.date < "2026-01-01");
const test = races.filter((race) => race.date >= "2026-01-01");
const courseOnly: FeatureSet = {
  id: "course-only",
  label: "コースのみ",
  dimensions: 6,
  vector: (boat) => oneHotCourse(boat.course),
};
const programExhibition: FeatureSet = {
  id: "program-exhibition",
  label: "番組能力＋モーター/ボート＋展示",
  dimensions: 14,
  vector: (boat) => [
    ...oneHotCourse(boat.course),
    classScore(boat.className),
    scaled(boat.nationalWinRate, 10),
    scaled(boat.nationalTop2Rate, 100),
    scaled(boat.localWinRate, 10),
    scaled(boat.localTop2Rate, 100),
    scaled(boat.motorTop2Rate, 100),
    scaled(boat.boatTop2Rate, 100),
    boat.exhibitionScore,
  ],
};

const models = [courseOnly, programExhibition].map((featureSet) => trainModel(train, featureSet));
const periods = [
  { id: "train", label: "2023-2024 train", races: train },
  { id: "validation", label: "2025 validation", races: validation },
  { id: "test", label: "2026 test", races: test },
];
const metrics = models.map((model) => ({
  id: model.featureSet.id,
  label: model.featureSet.label,
  periods: Object.fromEntries(periods.map((period) => [period.id, evaluate(period.races, model)])),
}));
const fixed123 = Object.fromEntries(periods.map((period) => [period.id, evaluateFixed123(period.races)]));
const courseMetrics = metrics.find((row) => row.id === "course-only")!.periods;
const candidateMetrics = metrics.find((row) => row.id === "program-exhibition")!.periods;
const checks = {
  validationLogLoss: candidateMetrics.validation.logLoss < courseMetrics.validation.logLoss,
  validationBrier: candidateMetrics.validation.brier < courseMetrics.validation.brier,
  testLogLoss: candidateMetrics.test.logLoss < courseMetrics.test.logLoss,
  testBrier: candidateMetrics.test.brier < courseMetrics.test.brier,
  validationPayoutRoi: candidateMetrics.validation.payoutRoi >= 1,
  validationPayoutRoiExTop2: candidateMetrics.validation.payoutRoiExTop2 >= 1,
  testPayoutRoi: candidateMetrics.test.payoutRoi >= 1,
  testPayoutRoiExTop2: candidateMetrics.test.payoutRoiExTop2 >= 1,
};
const report = {
  generatedAt: new Date().toISOString(),
  safety: { readOnly: true, dbWrites: false, productionChanged: false, automaticWagering: false },
  contract: {
    train: "2023-01-01..2024-12-31",
    validation: "2025-01-01..2025-12-31",
    test: "2026-01-01..2026-12-31 (available official_programs only)",
    featurePolicy: "official program snapshot and exhibition time only",
    excludedLeakage: ["finish_pos", "actual ST", "kimarite", "future racer aggregates", "2025/2026 refit"],
    selection: "one trifecta ticket per race",
    stakeYen: 100,
  },
  coverage: {
    sourceRows: sourceRows.length,
    evaluated: races.length,
    train: train.length,
    validation: validation.length,
    test: test.length,
    rejectedProgram,
    rejectedExhibition,
    payoutSources: countBy(races, (race) => race.payoutSource),
  },
  fit: { epochs: EPOCHS, learningRate: 0.35, l2: 0.002 },
  metrics,
  fixed123,
  gate: { passed: Object.values(checks).every(Boolean), checks },
  caveats: [
    "完全なhistorical market oddsが無いため、市場確率を上回るかは判定できない",
    "2026はofficial_programsが存在する2026-05-20以降が中心",
    "この分析は純粋な着順モデルであり、positive EVの購入戦略ではない",
    "2025/2026を見て特徴量・epoch・閾値を変更しない",
  ],
};

const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const dec = (value: number) => Number.isFinite(value) ? value.toFixed(4) : "-";
const money = (value: number) => `¥${Math.round(value).toLocaleString()}`;
const lines = [
  "# 2023-2024学習 → 2025/2026 着順forward評価",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 当時番組と展示だけを使用した読み取り専用分析。BUY・購入指示ではない。",
  "",
  `- 評価可能: ${races.length}（train ${train.length} / validation ${validation.length} / test ${test.length}）`,
  `- 除外: 番組不正 ${rejectedProgram} / 展示不完全 ${rejectedExhibition}`,
  "",
  "| モデル | 期間 | n | 的中 | 的中率 | 実払戻ROI | 最大2的中除外ROI | logloss | Brier | 最大DD |",
  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...metrics.flatMap((model) => periods.map((period) => {
    const value = model.periods[period.id];
    return `| ${model.label} | ${period.label} | ${value.n} | ${value.hits} | ${pct(value.hitRate)} | ${pct(value.payoutRoi)} | ${pct(value.payoutRoiExTop2)} | ${dec(value.logLoss)} | ${dec(value.brier)} | ${money(value.maxDrawdownYen)} |`;
  })),
  ...periods.map((period) => {
    const value = fixed123[period.id];
    return `| 固定1-2-3 | ${period.label} | ${value.n} | ${value.hits} | ${pct(value.hitRate)} | ${pct(value.payoutRoi)} | ${pct(value.payoutRoiExTop2)} | - | - | ${money(value.maxDrawdownYen)} |`;
  }),
  "",
  "## Gate",
  "",
  ...Object.entries(checks).map(([key, passed]) => `- ${passed ? "PASS" : "FAIL"}: ${key}`),
  `- 最終判定: **${report.gate.passed ? "PASS" : "FAIL"}**`,
  "",
  "## 解釈",
  "",
  "- logloss/Brierがコースのみを両forward期間で上回るかと、実払戻ROIを別々に判定する。",
  "- 市場オッズが揃わないため、着順予測が改善しても収益edgeとは断定しない。",
  "- gate不通過なら特徴量を追加せず、この最小仮説を棄却する。",
];
mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, `${lines.join("\n")}\n`);
const selectedModel = models.find((model) => model.featureSet.id === "program-exhibition");
if (!selectedModel) throw new Error("program-exhibition model was not trained");
writeFileSync(OUT_MODEL, `${JSON.stringify({
  generatedAt: report.generatedAt,
  modelId: selectedModel.featureSet.id,
  trainedOn: report.contract.train,
  featurePolicy: report.contract.featurePolicy,
  featureNames: [
    "course_1", "course_2", "course_3", "course_4", "course_5", "course_6",
    "class_score", "national_win_rate_10", "national_top2_rate_100",
    "local_win_rate_10", "local_top2_rate_100", "motor_top2_rate_100",
    "boat_top2_rate_100", "exhibition_rank_score",
  ],
  fit: report.fit,
  weights: selectedModel.weights,
}, null, 2)}\n`);
console.log(`[historical-ranking-forward] wrote ${OUT_MD} / ${OUT_JSON} / ${OUT_MODEL}`);

function trainModel(training: Race[], featureSet: FeatureSet): RankingModel {
  const weights = Array.from({ length: 3 }, () => Array(featureSet.dimensions).fill(0));
  for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
    const gradients = weights.map(() => Array(featureSet.dimensions).fill(0));
    for (const race of training) {
      const features = race.boats.map(featureSet.vector);
      const excluded = new Set<number>();
      for (let stage = 0; stage < 3; stage += 1) {
        const chosen = race.order[stage] - 1;
        const eligible = race.boats.map((_, index) => index).filter((index) => !excluded.has(index));
        const probabilities = softmax(eligible.map((index) => dot(weights[stage], features[index])));
        for (let dimension = 0; dimension < featureSet.dimensions; dimension += 1) {
          let expected = 0;
          for (let i = 0; i < eligible.length; i += 1) expected += probabilities[i] * features[eligible[i]][dimension];
          gradients[stage][dimension] += features[chosen][dimension] - expected;
        }
        excluded.add(chosen);
      }
    }
    const rate = 0.35 / Math.sqrt(epoch + 1);
    for (let stage = 0; stage < 3; stage += 1) {
      for (let dimension = 0; dimension < featureSet.dimensions; dimension += 1) {
        weights[stage][dimension] += rate * (gradients[stage][dimension] / training.length - 0.002 * weights[stage][dimension]);
      }
    }
  }
  return { featureSet, weights };
}

function evaluate(rows: Race[], model: RankingModel) {
  let hits = 0, payout = 0, logLoss = 0, brier = 0, balance = 0, peak = 0, maxDrawdownYen = 0;
  const hitPayouts: number[] = [];
  for (const race of rows) {
    const probabilities = trifectaProbabilities(race, model);
    const winner = race.order.join("-");
    const winnerProbability = Math.max(probabilities.get(winner) ?? 0, 1e-12);
    logLoss += -Math.log(winnerProbability);
    let squared = 0;
    for (const probability of probabilities.values()) squared += probability * probability;
    brier += squared - 2 * winnerProbability + 1;
    const selected = [...probabilities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const hit = selected === winner;
    if (hit) { hits += 1; payout += race.payoutYen; hitPayouts.push(race.payoutYen); }
    balance += hit ? race.payoutYen - 100 : -100;
    peak = Math.max(peak, balance);
    maxDrawdownYen = Math.max(maxDrawdownYen, peak - balance);
  }
  hitPayouts.sort((a, b) => b - a);
  const removed = Math.min(2, hitPayouts.length);
  return {
    n: rows.length, hits, hitRate: hits / rows.length, payoutRoi: payout / (rows.length * 100),
    payoutRoiExTop2: (payout - hitPayouts.slice(0, removed).reduce((sum, value) => sum + value, 0)) / ((rows.length - removed) * 100),
    logLoss: logLoss / rows.length, brier: brier / rows.length, maxDrawdownYen,
  };
}

function evaluateFixed123(rows: Race[]) {
  let hits = 0, payout = 0, balance = 0, peak = 0, maxDrawdownYen = 0;
  const hitPayouts: number[] = [];
  for (const race of rows) {
    const hit = race.order.join("-") === "1-2-3";
    if (hit) { hits += 1; payout += race.payoutYen; hitPayouts.push(race.payoutYen); }
    balance += hit ? race.payoutYen - 100 : -100;
    peak = Math.max(peak, balance); maxDrawdownYen = Math.max(maxDrawdownYen, peak - balance);
  }
  hitPayouts.sort((a, b) => b - a); const removed = Math.min(2, hitPayouts.length);
  return { n: rows.length, hits, hitRate: hits / rows.length, payoutRoi: payout / (rows.length * 100), payoutRoiExTop2: (payout - hitPayouts.slice(0, removed).reduce((sum, value) => sum + value, 0)) / ((rows.length - removed) * 100), maxDrawdownYen };
}

function trifectaProbabilities(race: Race, model: RankingModel) {
  const features = race.boats.map(model.featureSet.vector);
  const logits = model.weights.map((weights) => features.map((vector) => dot(weights, vector)));
  const result = new Map<string, number>();
  const first = softmax(logits[0]);
  for (let i = 0; i < 6; i += 1) {
    const secondEligible = [0, 1, 2, 3, 4, 5].filter((index) => index !== i);
    const second = softmax(secondEligible.map((index) => logits[1][index]));
    for (let sj = 0; sj < secondEligible.length; sj += 1) {
      const j = secondEligible[sj];
      const thirdEligible = secondEligible.filter((index) => index !== j);
      const third = softmax(thirdEligible.map((index) => logits[2][index]));
      for (let sk = 0; sk < thirdEligible.length; sk += 1) {
        const k = thirdEligible[sk]; result.set(`${i + 1}-${j + 1}-${k + 1}`, first[i] * second[sj] * third[sk]);
      }
    }
  }
  return result;
}

function oneHotCourse(course: number) { return Array.from({ length: 6 }, (_, index) => Number(index + 1 === course)); }
function classScore(value?: string | null) { return ({ B2: 0, B1: 1 / 3, A2: 2 / 3, A1: 1 } as Record<string, number>)[value ?? ""] ?? 0; }
function scaled(value: number | null | undefined, divisor: number) { return Number.isFinite(value) ? Number(value) / divisor : 0; }
function dot(left: number[], right: number[]) { let value = 0; for (let i = 0; i < left.length; i += 1) value += left[i] * right[i]; return value; }
function softmax(values: number[]) { const max = Math.max(...values); const exp = values.map((value) => Math.exp(value - max)); const total = exp.reduce((sum, value) => sum + value, 0); return exp.map((value) => value / total); }
function countBy<T>(rows: T[], key: (row: T) => string) { const result: Record<string, number> = {}; for (const row of rows) result[key(row)] = (result[key(row)] ?? 0) + 1; return result; }
