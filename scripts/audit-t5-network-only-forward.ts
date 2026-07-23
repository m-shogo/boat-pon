/**
 * network-only化後のT-5 future cohortを、同一race_id集合で評価する。
 * 6月trainで固定した最小候補だけを比較し、future cohortを再学習へ戻さない。
 * 読み取り専用。本番判定・DB・app_settingsは変更しない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  evaluateProbabilityModel,
  fitSelectionResidual,
  fitTemperature,
  marketModel,
  selectionResidualModel,
  temperatureModel,
  type ProbabilityModel,
  type ResidualRace,
} from "../src/domain/t5ResidualModel";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const TRAIN_FROM = process.env.BOAT_PON_TRAIN_FROM ?? "2026-06-01";
const TRAIN_TO = process.env.BOAT_PON_TRAIN_TO ?? "2026-06-30";
const NETWORK_ONLY_FROM = new Date(
  process.env.BOAT_PON_T5_NETWORK_ONLY_FROM ?? "2026-07-21T15:15:00+09:00",
);
const NOW = new Date();
const OUT_MD = "reports/t5-network-only-forward.md";
const OUT_JSON = "reports/t5-network-only-forward.json";

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
if (Number.isNaN(NETWORK_ONLY_FROM.getTime())) throw new Error("invalid BOAT_PON_T5_NETWORK_ONLY_FROM");

type OddsRow = { id: number; race_id: string; selection: string; odds: number; captured_at: string };
type ProgramRow = { race_id: string; date: string; venue: string; race_no: number; close_at: string };
type ResultRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  trifecta: string | null;
  payout_yen: number | null;
  returned: number;
};

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

const trainOdds = loadLatestCompleteCaptures(TRAIN_FROM, TRAIN_TO, null);
const trainResults = loadResults(TRAIN_FROM, TRAIN_TO);
const trainRaces = buildRaces(trainOdds, trainResults);

const formalFromDate = jstDate(NETWORK_ONLY_FROM);
const formalToDate = jstDate(NOW);
const formalPrograms = db.prepare(`
  SELECT race_id, date, venue, race_no, close_at
  FROM official_programs
  WHERE date >= ? AND date <= ?
  ORDER BY date, close_at, race_id
`).all(formalFromDate, formalToDate) as ProgramRow[];
const maturePrograms = formalPrograms.filter((row) => {
  const close = raceClose(row.date, row.close_at);
  return close >= NETWORK_ONLY_FROM && close <= NOW;
});
const matureRaceIds = new Set(maturePrograms.map((row) => row.race_id));
const formalOdds = loadLatestCompleteCaptures(formalFromDate, formalToDate, NETWORK_ONLY_FROM.toISOString())
  .filter((row) => matureRaceIds.has(row.race_id));
const completeRaceIds = new Set(formalOdds.map((row) => row.race_id));
const formalResults = loadResults(formalFromDate, formalToDate);
const resultByRace = new Map(formalResults.map((row) => [row.race_id, row]));
const formalRaces = buildRaces(formalOdds, formalResults);
db.close();

const fittedTemperature = fitTemperature(trainRaces);
const fittedResidual = fitSelectionResidual(trainRaces);
if (!fittedTemperature || !fittedResidual) throw new Error("training cohort is empty");

const variants: Array<{ id: string; label: string; model: ProbabilityModel }> = [
  { id: "market", label: "T-5市場", model: marketModel },
  {
    id: "temperature",
    label: `市場temperature T=${fittedTemperature.temperature}`,
    model: temperatureModel(fittedTemperature.temperature),
  },
  {
    id: "selection-residual",
    label: `買い目残差 T=${fittedResidual.temperature} prior=${fittedResidual.priorStrength}`,
    model: selectionResidualModel(fittedResidual.factors, fittedResidual.temperature),
  },
];

const metrics = variants.map((variant) => ({
  id: variant.id,
  label: variant.label,
  ...evaluateProbabilityModel(formalRaces, variant.model),
  maxDrawdownYen: maxDrawdown(formalRaces, variant.model),
}));
const market = metrics.find((row) => row.id === "market")!;
const residual = metrics.find((row) => row.id === "selection-residual")!;
const settledComplete = formalRaces.length;
const returnedOrUnsettled = [...completeRaceIds].filter((raceId) => {
  const result = resultByRace.get(raceId);
  return !result?.trifecta || result.returned !== 0 || result.payout_yen == null;
}).length;
const checks = {
  settled1000: settledComplete >= 1000,
  residualLogLoss: residual.logLoss != null && market.logLoss != null && residual.logLoss < market.logLoss,
  residualBrier: residual.brier != null && market.brier != null && residual.brier < market.brier,
  residualPayoutRoi: (residual.payoutRoi ?? 0) >= 1,
  residualPayoutRoiExTop2: (residual.payoutRoiExTop2 ?? 0) >= 1,
  clv: false,
};
const report = {
  generatedAt: NOW.toISOString(),
  safety: {
    readOnly: true,
    dbWrites: false,
    productionChanged: false,
    futureCohortUsedForTraining: false,
  },
  contract: {
    networkOnlyFrom: NETWORK_ONLY_FROM.toISOString(),
    train: { from: TRAIN_FROM, to: TRAIN_TO, freshness: "unverified; fit only" },
    future: { from: formalFromDate, to: formalToDate, pointInTime: "single captured_at T-5 complete market" },
    payout: "race_results.payout_yen (official actual payout)",
    sameRacePopulation: true,
  },
  coverage: {
    maturePrograms: maturePrograms.length,
    completeT5: completeRaceIds.size,
    settledComplete,
    returnedOrUnsettled,
  },
  frozenFit: {
    trainRaces: trainRaces.length,
    temperature: fittedTemperature.temperature,
    residualTemperature: fittedResidual.temperature,
    residualPriorStrength: fittedResidual.priorStrength,
  },
  metrics,
  gate: { passed: Object.values(checks).every(Boolean), checks },
  unavailable: {
    clv: "同一selectionのT-5とclosing oddsを時点整合付きで結合する正式器が未完成",
    currentModelMulticlass:
      "decision_historyは選択買い目の確率だけで、120通り分布のlogloss/Brierと同尺度比較できない",
  },
  caveats: [
    "修正前T-5は候補fitにだけ使用し、formal future評価には混ぜない",
    "formal futureの結果をfit・特徴量探索・閾値調整へ戻さない",
    "settled 1,000件と全gate通過までは本番へ接続しない",
  ],
};

const percent = (value: number | null) => value == null ? "-" : `${(value * 100).toFixed(2)}%`;
const decimal = (value: number | null) => value == null ? "-" : value.toFixed(4);
const yen = (value: number | null) => value == null ? "-" : `¥${value.toLocaleString()}`;
const lines = [
  "# network-only T-5 future評価",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 2026-07-21 15:15 JST以降の単一captured_at完全市場だけをformal futureとして評価。読み取り専用・本番未接続。",
  "",
  "## Coverage",
  "",
  `- 締切済み: ${report.coverage.maturePrograms}`,
  `- network-only T-5完全: ${report.coverage.completeT5}`,
  `- 結果確定・評価可能: ${report.coverage.settledComplete} / 1,000`,
  `- 返還・未確定: ${report.coverage.returnedOrUnsettled}`,
  "",
  "## 同一race_id比較",
  "",
  "| モデル | n | 的中 | 的中率 | 実払戻ROI | 最大1的中除外ROI | 最大2的中除外ROI | logloss | Brier | 最大DD |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...metrics.map((row) =>
    `| ${row.label} | ${row.n} | ${row.hits} | ${percent(row.hitRate)} | ${percent(row.payoutRoi)} | ${percent(row.payoutRoiExTop1)} | ${percent(row.payoutRoiExTop2)} | ${decimal(row.logLoss)} | ${decimal(row.brier)} | ${yen(row.maxDrawdownYen)} |`,
  ),
  "",
  "## Gate",
  "",
  ...Object.entries(checks).map(([key, value]) => `- ${value ? "PASS" : "BLOCKED"}: ${key}`),
  `- 最終判定: **${report.gate.passed ? "PASS" : "BLOCKED"}**`,
  "",
  "## 未計測",
  "",
  `- CLV: ${report.unavailable.clv}`,
  `- 現行モデルの多クラス比較: ${report.unavailable.currentModelMulticlass}`,
];

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, `${lines.join("\n")}\n`);
console.log(`[t5-network-only-forward] wrote ${OUT_MD} / ${OUT_JSON}`);

function loadLatestCompleteCaptures(from: string, to: string, capturedFrom: string | null) {
  const fromId = from.replaceAll("-", "");
  const toExclusive = addDays(to, 1).replaceAll("-", "");
  return db.prepare(`
    WITH complete_capture AS (
      SELECT race_id, captured_at, MAX(id) AS max_id
      FROM odds_timeseries_snapshots
      WHERE race_id >= ? AND race_id < ?
        AND checkpoint_label = 'T-5'
        AND (? IS NULL OR captured_at >= ?)
      GROUP BY race_id, captured_at
      HAVING COUNT(DISTINCT selection) = 120
    ), latest_capture AS (
      SELECT race_id, MAX(max_id) AS max_id
      FROM complete_capture
      GROUP BY race_id
    ), chosen AS (
      SELECT capture.race_id, capture.captured_at
      FROM complete_capture capture
      JOIN latest_capture latest
        ON latest.race_id = capture.race_id AND latest.max_id = capture.max_id
    )
    SELECT snapshots.id, snapshots.race_id, snapshots.selection, snapshots.odds, snapshots.captured_at
    FROM odds_timeseries_snapshots snapshots
    WHERE snapshots.id IN (
      SELECT MAX(source.id)
      FROM odds_timeseries_snapshots source
      JOIN chosen ON chosen.race_id = source.race_id AND chosen.captured_at = source.captured_at
      GROUP BY source.race_id, source.selection
    )
  `).all(fromId, toExclusive, capturedFrom, capturedFrom) as OddsRow[];
}

function loadResults(from: string, to: string) {
  return db.prepare(`
    SELECT race_id, date, venue, race_no, trifecta, payout_yen, returned
    FROM race_results
    WHERE date >= ? AND date <= ?
  `).all(from, to) as ResultRow[];
}

function buildRaces(odds: OddsRow[], results: ResultRow[]) {
  const resultByRace = new Map(results.map((row) => [row.race_id, row]));
  const byRace = new Map<string, OddsRow[]>();
  for (const row of odds) byRace.set(row.race_id, [...(byRace.get(row.race_id) ?? []), row]);
  const races: ResidualRace[] = [];
  for (const [raceId, source] of byRace) {
    const unique = new Map(source.map((row) => [row.selection, row]));
    const result = resultByRace.get(raceId);
    if (unique.size !== 120 || !result?.trifecta || result.returned !== 0 || result.payout_yen == null) continue;
    const rows = [...unique.values()];
    if (rows.some((row) => !validSelection(row.selection) || !Number.isFinite(row.odds) || row.odds <= 1)) continue;
    const overround = rows.reduce((sum, row) => sum + 1 / row.odds, 0);
    if (!(overround > 0) || !unique.has(result.trifecta)) continue;
    races.push({
      raceId,
      date: result.date,
      venue: result.venue,
      raceNo: result.race_no,
      winner: result.trifecta,
      payoutYen: result.payout_yen,
      outcomes: rows.map((row) => ({
        selection: row.selection,
        odds: row.odds,
        marketProbability: (1 / row.odds) / overround,
      })),
    });
  }
  return races.sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
}

function maxDrawdown(races: ResidualRace[], model: ProbabilityModel) {
  if (!races.length) return null;
  let balance = 0;
  let peak = 0;
  let drawdown = 0;
  for (const race of races) {
    const selected = [...model(race).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    balance += selected === race.winner ? race.payoutYen - 100 : -100;
    peak = Math.max(peak, balance);
    drawdown = Math.max(drawdown, peak - balance);
  }
  return drawdown;
}

function validSelection(value: string) {
  const parts = value.split("-").map(Number);
  return parts.length === 3
    && new Set(parts).size === 3
    && parts.every((part) => Number.isInteger(part) && part >= 1 && part <= 6);
}

function raceClose(date: string, closeAt: string) {
  return new Date(`${date}T${closeAt}:00+09:00`);
}

function addDays(date: string, delta: number) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + delta);
  return jstDate(value);
}

function jstDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value);
}
