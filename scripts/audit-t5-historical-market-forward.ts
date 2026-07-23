/**
 * 2023-2024固定の履歴着順モデルとT-5市場を、同一race_idのformal futureで比較する。
 * 修正前T-5は混合係数の事前校正だけに使い、formal futureの結果は調整へ戻さない。
 * 読み取り専用。本番判定・DB・app_settingsは変更しない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const MODEL_PATH = process.env.BOAT_PON_HISTORICAL_MODEL_PATH ?? "reports/historical-ranking-model.json";
const CALIBRATION_FROM = process.env.BOAT_PON_BLEND_CALIBRATION_FROM ?? "2026-06-01";
const CALIBRATION_TO = process.env.BOAT_PON_BLEND_CALIBRATION_TO ?? "2026-06-30";
const NETWORK_ONLY_FROM = new Date(
  process.env.BOAT_PON_T5_NETWORK_ONLY_FROM ?? "2026-07-21T15:15:00+09:00",
);
const ALPHAS = [0, 0.1, 0.25, 0.5, 0.75, 1];
const NOW = new Date();
const OUT_MD = "reports/t5-historical-market-forward.md";
const OUT_JSON = "reports/t5-historical-market-forward.json";

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
if (!existsSync(MODEL_PATH)) throw new Error(`model artifact not found: ${MODEL_PATH}`);
if (Number.isNaN(NETWORK_ONLY_FROM.getTime())) throw new Error("invalid BOAT_PON_T5_NETWORK_ONLY_FROM");

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
type ModelArtifact = {
  generatedAt: string;
  modelId: string;
  trainedOn: string;
  featureNames: string[];
  weights: number[][];
};
type OddsRow = { race_id: string; selection: string; odds: number; captured_at: string };
type ProgramRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  close_at: string;
  raw_json: string;
};
type ExhibitionRow = { race_id: string; course: number; exhibition_time: number };
type ResultRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  trifecta: string | null;
  payout_yen: number | null;
  returned: number;
};
type Race = {
  raceId: string;
  date: string;
  winner: string;
  payoutYen: number;
  market: Map<string, number>;
  historical: Map<string, number>;
};
type ProbabilityModel = (race: Race) => Map<string, number>;

const artifact = JSON.parse(readFileSync(MODEL_PATH, "utf8")) as ModelArtifact;
if (artifact.modelId !== "program-exhibition"
  || artifact.featureNames.length !== 14
  || artifact.weights.length !== 3
  || artifact.weights.some((row) => row.length !== 14 || row.some((value) => !Number.isFinite(value)))) {
  throw new Error("invalid historical model artifact");
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

const calibrationData = loadCohort(CALIBRATION_FROM, CALIBRATION_TO, null, null);
const formalFromDate = jstDate(NETWORK_ONLY_FROM);
const formalToDate = jstDate(NOW);
const formalPrograms = loadPrograms(formalFromDate, formalToDate);
const maturePrograms = formalPrograms.filter((row) => {
  const close = raceClose(row.date, row.close_at);
  return close >= NETWORK_ONLY_FROM && close <= NOW;
});
const matureIds = new Set(maturePrograms.map((row) => row.race_id));
const formalData = loadCohort(
  formalFromDate,
  formalToDate,
  NETWORK_ONLY_FROM.toISOString(),
  matureIds,
);
db.close();

const calibrationScores = ALPHAS.map((alpha) => ({
  alpha,
  ...probabilityScores(calibrationData.races, blendModel(alpha)),
}));
const selectedCalibration = [...calibrationScores].sort(
  (left, right) => left.logLoss - right.logLoss || left.brier - right.brier || left.alpha - right.alpha,
)[0];
const selectedAlpha = selectedCalibration?.alpha ?? 0;

const variants: Array<{ id: string; label: string; model: ProbabilityModel }> = [
  { id: "market", label: "T-5市場", model: (race) => race.market },
  { id: "historical", label: "2023-2024履歴", model: (race) => race.historical },
  {
    id: "fixed-blend",
    label: `事前固定混合 α=${selectedAlpha}`,
    model: blendModel(selectedAlpha),
  },
];
const metrics = variants.map((variant) => ({
  id: variant.id,
  label: variant.label,
  ...evaluate(formalData.races, variant.model),
}));
const market = metrics.find((row) => row.id === "market")!;
const blend = metrics.find((row) => row.id === "fixed-blend")!;
const improvementEpsilon = 1e-12;
const checks = {
  settled1000: formalData.races.length >= 1000,
  historicalContribution: selectedAlpha > 0,
  blendLogLoss: blend.logLoss != null && market.logLoss != null
    && blend.logLoss < market.logLoss - improvementEpsilon,
  blendBrier: blend.brier != null && market.brier != null
    && blend.brier < market.brier - improvementEpsilon,
  blendPayoutRoi: (blend.payoutRoi ?? 0) >= 1,
  blendPayoutRoiExTop2: (blend.payoutRoiExTop2 ?? 0) >= 1,
};
const report = {
  generatedAt: NOW.toISOString(),
  safety: {
    readOnly: true,
    dbWrites: false,
    productionChanged: false,
    automaticWagering: false,
    formalFutureUsedForTuning: false,
  },
  contract: {
    historicalModel: {
      artifact: MODEL_PATH,
      generatedAt: artifact.generatedAt,
      trainedOn: artifact.trainedOn,
    },
    calibration: {
      from: CALIBRATION_FROM,
      to: CALIBRATION_TO,
      purpose: "blend alpha selection only",
      freshness: "unverified pre-network-only T-5; not formal evidence",
      alphaGrid: ALPHAS,
    },
    formal: {
      from: NETWORK_ONLY_FROM.toISOString(),
      to: NOW.toISOString(),
      pointInTime: "single captured_at complete T-5 market",
      sameRacePopulation: true,
      payout: "race_results.payout_yen",
    },
  },
  coverage: {
    calibration: calibrationData.coverage,
    formal: {
      maturePrograms: maturePrograms.length,
      ...formalData.coverage,
    },
  },
  calibrationScores,
  selectedAlpha,
  metrics,
  gate: { passed: Object.values(checks).every(Boolean), checks },
  caveats: [
    "修正前T-5は混合係数の事前校正にだけ使用し、正式成績には数えない",
    "番組または展示が欠けたレースは市場単独も含めて除外し、全モデルを同一race_idで比較する",
    "最大2的中除外ROIの分母から除くのは実際に除外した的中数だけ",
    "formal settled 1,000件と全gate通過までは本番へ接続しない",
  ],
};

const pct = (value: number | null) => value == null ? "-" : `${(value * 100).toFixed(2)}%`;
const dec = (value: number | null) => value == null ? "-" : value.toFixed(4);
const yen = (value: number | null) => value == null ? "-" : `¥${value.toLocaleString()}`;
const lines = [
  "# T-5市場 × 2023-2024履歴モデル formal future比較",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> BUY・購入指示ではない。読み取り専用で、本番判定には未接続。",
  "",
  "## 固定条件",
  "",
  `- 履歴モデル: ${artifact.trainedOn}のみで学習`,
  `- 事前校正: ${CALIBRATION_FROM}..${CALIBRATION_TO}（鮮度未証明、α選択専用）`,
  `- formal: ${NETWORK_ONLY_FROM.toISOString()}以降のnetwork-only T-5`,
  `- 選択α: ${selectedAlpha}（logloss最小、同値ならBrier→小さいα）`,
  "",
  "## Coverage",
  "",
  `- formal締切済み: ${maturePrograms.length}`,
  `- T-5完全市場: ${formalData.coverage.completeMarkets}`,
  `- 番組・展示・結果まで揃った同一race: ${formalData.races.length} / 1,000`,
  `- 除外: 未確定/返還 ${formalData.coverage.unsettledOrReturned} / 番組不正 ${formalData.coverage.invalidProgram} / 展示不完全 ${formalData.coverage.incompleteExhibition}`,
  "",
  "## 同一race_id比較",
  "",
  "| モデル | n | 的中 | 的中率 | 実払戻ROI | 最大1的中除外ROI | 最大2的中除外ROI | logloss | Brier | 最大DD |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...metrics.map((row) =>
    `| ${row.label} | ${row.n} | ${row.hits} | ${pct(row.hitRate)} | ${pct(row.payoutRoi)} | ${pct(row.payoutRoiExTop1)} | ${pct(row.payoutRoiExTop2)} | ${dec(row.logLoss)} | ${dec(row.brier)} | ${yen(row.maxDrawdownYen)} |`,
  ),
  "",
  "## Gate",
  "",
  ...Object.entries(checks).map(([key, value]) => `- ${value ? "PASS" : "BLOCKED"}: ${key}`),
  `- 最終判定: **${report.gate.passed ? "PASS" : "BLOCKED"}**`,
];

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, `${lines.join("\n")}\n`);
console.log(`[t5-historical-market-forward] wrote ${OUT_MD} / ${OUT_JSON}`);

function loadCohort(from: string, to: string, capturedFrom: string | null, allowedRaceIds: Set<string> | null) {
  const odds = loadLatestCompleteCaptures(from, to, capturedFrom)
    .filter((row) => allowedRaceIds == null || allowedRaceIds.has(row.race_id));
  const completeRaceIds = new Set(odds.map((row) => row.race_id));
  const programs = new Map(loadPrograms(from, to).map((row) => [row.race_id, row]));
  const results = new Map(loadResults(from, to).map((row) => [row.race_id, row]));
  const exhibitions = loadExhibitions(from, to);
  const byRace = new Map<string, OddsRow[]>();
  for (const row of odds) byRace.set(row.race_id, [...(byRace.get(row.race_id) ?? []), row]);
  const races: Race[] = [];
  let unsettledOrReturned = 0;
  let invalidProgram = 0;
  let incompleteExhibition = 0;
  let invalidOdds = 0;
  for (const [raceId, rows] of byRace) {
    const result = results.get(raceId);
    if (!result?.trifecta || result.returned !== 0 || result.payout_yen == null) {
      unsettledOrReturned += 1;
      continue;
    }
    const program = parseBoats(programs.get(raceId)?.raw_json);
    if (!program) {
      invalidProgram += 1;
      continue;
    }
    const exhibition = exhibitions.get(raceId);
    if (!exhibition || program.some((boat) => !Number.isFinite(exhibition.get(boat.course)))) {
      incompleteExhibition += 1;
      continue;
    }
    const unique = new Map(rows.map((row) => [row.selection, row]));
    if (unique.size !== 120 || !unique.has(result.trifecta)
      || [...unique.values()].some((row) => !validSelection(row.selection) || !(row.odds > 1))) {
      invalidOdds += 1;
      continue;
    }
    const overround = [...unique.values()].reduce((sum, row) => sum + 1 / row.odds, 0);
    const market = new Map([...unique.values()].map((row) => [row.selection, (1 / row.odds) / overround]));
    const historical = historicalProbabilities(program, exhibition, artifact.weights);
    races.push({
      raceId,
      date: result.date,
      winner: result.trifecta,
      payoutYen: result.payout_yen,
      market,
      historical,
    });
  }
  races.sort((left, right) => left.date.localeCompare(right.date) || left.raceId.localeCompare(right.raceId));
  return {
    races,
    coverage: {
      completeMarkets: completeRaceIds.size,
      evaluated: races.length,
      unsettledOrReturned,
      invalidProgram,
      incompleteExhibition,
      invalidOdds,
    },
  };
}

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
    SELECT snapshots.race_id, snapshots.selection, snapshots.odds, snapshots.captured_at
    FROM odds_timeseries_snapshots snapshots
    WHERE snapshots.id IN (
      SELECT MAX(source.id)
      FROM odds_timeseries_snapshots source
      JOIN chosen ON chosen.race_id = source.race_id AND chosen.captured_at = source.captured_at
      GROUP BY source.race_id, source.selection
    )
  `).all(fromId, toExclusive, capturedFrom, capturedFrom) as OddsRow[];
}

function loadPrograms(from: string, to: string) {
  return db.prepare(`
    SELECT race_id, date, venue, race_no, close_at, raw_json
    FROM official_programs
    WHERE date >= ? AND date <= ?
  `).all(from, to) as ProgramRow[];
}

function loadResults(from: string, to: string) {
  return db.prepare(`
    SELECT race_id, date, venue, race_no, trifecta, payout_yen, returned
    FROM race_results
    WHERE date >= ? AND date <= ?
  `).all(from, to) as ResultRow[];
}

function loadExhibitions(from: string, to: string) {
  const rows = db.prepare(`
    SELECT race_id, course, exhibition_time
    FROM exhibition_data
    WHERE race_id >= ? AND race_id < ? AND exhibition_time IS NOT NULL
    UNION ALL
    SELECT entries.race_id, entries.boat AS course, entries.exhibition_time
    FROM race_entries entries
    WHERE entries.race_id >= ? AND entries.race_id < ?
      AND entries.exhibition_time IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM exhibition_data live
        WHERE live.race_id = entries.race_id AND live.course = entries.boat
      )
  `).all(
    from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", ""),
    from.replaceAll("-", ""), addDays(to, 1).replaceAll("-", ""),
  ) as ExhibitionRow[];
  const result = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const race = result.get(row.race_id) ?? new Map<number, number>();
    race.set(row.course, row.exhibition_time);
    result.set(row.race_id, race);
  }
  return result;
}

function parseBoats(rawJson?: string) {
  if (!rawJson) return null;
  try {
    const boats = [...((JSON.parse(rawJson) as Program).boats ?? [])].sort((a, b) => a.course - b.course);
    return boats.length === 6 && boats.every((boat, index) => boat.course === index + 1) ? boats : null;
  } catch {
    return null;
  }
}

function historicalProbabilities(boats: ProgramBoat[], exhibition: Map<number, number>, weights: number[][]) {
  const ranked = boats
    .map((boat) => ({ course: boat.course, time: exhibition.get(boat.course)! }))
    .sort((left, right) => left.time - right.time || left.course - right.course);
  const rankByCourse = new Map(ranked.map((value, index) => [value.course, index]));
  const features = boats.map((boat) => [
    ...oneHotCourse(boat.course),
    classScore(boat.className),
    scaled(boat.nationalWinRate, 10),
    scaled(boat.nationalTop2Rate, 100),
    scaled(boat.localWinRate, 10),
    scaled(boat.localTop2Rate, 100),
    scaled(boat.motorTop2Rate, 100),
    scaled(boat.boatTop2Rate, 100),
    1 - (rankByCourse.get(boat.course) ?? 5) / 5,
  ]);
  const logits = weights.map((stage) => features.map((feature) => dot(stage, feature)));
  const probabilities = new Map<string, number>();
  const first = softmax(logits[0]);
  for (let firstIndex = 0; firstIndex < 6; firstIndex += 1) {
    const secondEligible = [0, 1, 2, 3, 4, 5].filter((index) => index !== firstIndex);
    const second = softmax(secondEligible.map((index) => logits[1][index]));
    for (let secondOffset = 0; secondOffset < secondEligible.length; secondOffset += 1) {
      const secondIndex = secondEligible[secondOffset];
      const thirdEligible = secondEligible.filter((index) => index !== secondIndex);
      const third = softmax(thirdEligible.map((index) => logits[2][index]));
      for (let thirdOffset = 0; thirdOffset < thirdEligible.length; thirdOffset += 1) {
        const thirdIndex = thirdEligible[thirdOffset];
        probabilities.set(
          `${firstIndex + 1}-${secondIndex + 1}-${thirdIndex + 1}`,
          first[firstIndex] * second[secondOffset] * third[thirdOffset],
        );
      }
    }
  }
  return probabilities;
}

function blendModel(alpha: number): ProbabilityModel {
  return (race) => {
    const scores = new Map<string, number>();
    let total = 0;
    for (const [selection, market] of race.market) {
      const historical = race.historical.get(selection) ?? 1e-12;
      const score = Math.exp((1 - alpha) * Math.log(Math.max(market, 1e-12))
        + alpha * Math.log(Math.max(historical, 1e-12)));
      scores.set(selection, score);
      total += score;
    }
    return new Map([...scores].map(([selection, score]) => [selection, score / total]));
  };
}

function probabilityScores(races: Race[], model: ProbabilityModel) {
  if (!races.length) return { n: 0, logLoss: Number.POSITIVE_INFINITY, brier: Number.POSITIVE_INFINITY };
  let logLoss = 0;
  let brier = 0;
  for (const race of races) {
    const probabilities = model(race);
    const winnerProbability = Math.max(probabilities.get(race.winner) ?? 0, 1e-12);
    logLoss += -Math.log(winnerProbability);
    let squared = 0;
    for (const probability of probabilities.values()) squared += probability * probability;
    brier += squared - 2 * winnerProbability + 1;
  }
  return { n: races.length, logLoss: logLoss / races.length, brier: brier / races.length };
}

function evaluate(races: Race[], model: ProbabilityModel) {
  if (!races.length) {
    return {
      n: 0, hits: 0, hitRate: null, payoutRoi: null, payoutRoiExTop1: null, payoutRoiExTop2: null,
      logLoss: null, brier: null, maxDrawdownYen: null,
    };
  }
  let hits = 0;
  let payout = 0;
  let balance = 0;
  let peak = 0;
  let maxDrawdownYen = 0;
  const hitPayouts: number[] = [];
  for (const race of races) {
    const selected = [...model(race)].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )[0]?.[0];
    const hit = selected === race.winner;
    if (hit) {
      hits += 1;
      payout += race.payoutYen;
      hitPayouts.push(race.payoutYen);
    }
    balance += hit ? race.payoutYen - 100 : -100;
    peak = Math.max(peak, balance);
    maxDrawdownYen = Math.max(maxDrawdownYen, peak - balance);
  }
  hitPayouts.sort((left, right) => right - left);
  const excludedRoi = (count: number) => {
    const removed = Math.min(count, hitPayouts.length);
    const remainingRaces = races.length - removed;
    if (remainingRaces <= 0) return null;
    const removedPayout = hitPayouts.slice(0, removed).reduce((sum, value) => sum + value, 0);
    return (payout - removedPayout) / (remainingRaces * 100);
  };
  const scores = probabilityScores(races, model);
  return {
    n: races.length,
    hits,
    hitRate: hits / races.length,
    payoutRoi: payout / (races.length * 100),
    payoutRoiExTop1: excludedRoi(1),
    payoutRoiExTop2: excludedRoi(2),
    logLoss: scores.logLoss,
    brier: scores.brier,
    maxDrawdownYen,
  };
}

function validSelection(value: string) {
  const parts = value.split("-").map(Number);
  return parts.length === 3 && new Set(parts).size === 3
    && parts.every((part) => Number.isInteger(part) && part >= 1 && part <= 6);
}
function oneHotCourse(course: number) {
  return Array.from({ length: 6 }, (_, index) => Number(index + 1 === course));
}
function classScore(value?: string | null) {
  return ({ B2: 0, B1: 1 / 3, A2: 2 / 3, A1: 1 } as Record<string, number>)[value ?? ""] ?? 0;
}
function scaled(value: number | null | undefined, divisor: number) {
  return Number.isFinite(value) ? Number(value) / divisor : 0;
}
function dot(left: number[], right: number[]) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}
function softmax(values: number[]) {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
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
