/**
 * 公開能力情報と市場順位のずれを、discovery -> validation -> untouched test の順で検証する。
 * DBは読み取り専用。historical closing oddsのため、通過しても本番採用しない。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  selectDynamicSecond,
  type RivalContext,
  type RivalStrategy,
} from "../src/domain/dynamicSecondSelector";
import type { UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";

type Period = "discovery" | "validation" | "test";
type RaceRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  raw_json: string;
  winner: string | null;
  payout_yen: number | null;
  wind_speed: number | null;
};
type OddsRow = { race_id: string; combination: string; odds: number };
type ExhRow = { race_id: string; course: number; exhibition_time: number };
type EvalRow = {
  period: Period;
  strategy: string;
  context: string;
  selection: string;
  implied: number;
  hit: boolean;
  payout: number;
  venue: string;
};
type Metric = {
  n: number;
  hits: number;
  edgePp: number;
  roi: number;
  max2HitExclRoi: number;
};

const strategyDefs: Array<{ id: string; label: string; strategy?: RivalStrategy; fixed?: number }> = [
  { id: "fixed_4", label: "固定4号艇", fixed: 4 },
  { id: "national_best", label: "全国勝率最上位", strategy: "national_best" },
  { id: "local_best", label: "当地勝率最上位", strategy: "local_best" },
  { id: "motor_best", label: "モーター2連率最上位", strategy: "motor_best" },
  { id: "exhibition_best", label: "展示最速", strategy: "exhibition_best" },
  { id: "consensus", label: "4指標合議", strategy: "consensus" },
  { id: "ability_underbought", label: "能力順位より市場人気が低い艇", strategy: "ability_underbought" },
  { id: "market_favorite", label: "1-X市場最人気", strategy: "market_favorite" },
  { id: "national_worst_placebo", label: "全国勝率最低_placebo", strategy: "national_worst_placebo" },
];

const db = new DatabaseSync(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

try {
  const races = db.prepare(`
SELECT h.race_id, h.race_date AS date, h.venue, h.race_no, op.raw_json,
       p.combination AS winner, p.payout_yen, rw.wind_speed_mps AS wind_speed
FROM historical_alternative_odds h
JOIN official_programs op ON op.race_id = h.race_id
LEFT JOIN race_payouts p ON p.race_id = h.race_id AND p.bet_type = 'exacta'
LEFT JOIN race_weather rw ON rw.race_id = h.race_id
WHERE h.bet_type = 'exacta'
  AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM race_entries re WHERE re.race_id = h.race_id AND re.status_code = 'F'
  )
GROUP BY h.race_id
HAVING COUNT(*) = 30
ORDER BY h.race_date, h.race_id
`).all() as RaceRow[];
  const oddsRows = db.prepare(`
SELECT race_id, combination, odds
FROM historical_alternative_odds
WHERE bet_type = 'exacta' AND race_date BETWEEN '2024-01-01' AND '2025-12-31'
`).all() as OddsRow[];
  const exhRows = db.prepare(`
SELECT race_id, course, exhibition_time
FROM exhibition_data
WHERE exhibition_time IS NOT NULL
`).all() as ExhRow[];

  const oddsByRace = new Map<string, Map<string, number>>();
  for (const row of oddsRows) {
    const market = oddsByRace.get(row.race_id) ?? new Map<string, number>();
    market.set(row.combination, row.odds);
    oddsByRace.set(row.race_id, market);
  }
  const exhibitionByRace = new Map<string, Map<number, number>>();
  for (const row of exhRows) {
    const times = exhibitionByRace.get(row.race_id) ?? new Map<number, number>();
    times.set(row.course, row.exhibition_time);
    exhibitionByRace.set(row.race_id, times);
  }

  const evalRows: EvalRow[] = [];
  let evaluatedRaces = 0;
  for (const race of races) {
    const market = oddsByRace.get(race.race_id);
    if (!market || market.size !== 30) continue;
    const program = JSON.parse(race.raw_json) as UnconventionalProgram;
    if (program.boats.length !== 6) continue;
    const overround = [...market.values()].reduce((sum, odds) => sum + 1 / odds, 0);
    if (!Number.isFinite(overround) || overround <= 0) continue;
    const marketProbability = new Map<number, number>();
    for (let course = 2; course <= 6; course += 1) {
      const odds = market.get(`1-${course}`);
      if (odds != null) marketProbability.set(course, (1 / odds) / overround);
    }
    if (marketProbability.size !== 5) continue;

    const context: RivalContext = {
      boats: program.boats,
      marketProbability,
      exhibitionTime: exhibitionByRace.get(race.race_id) ?? new Map(),
    };
    const marketRanks = rankMap([...marketProbability.entries()], ([, value]) => value, true);
    const nationalRanks = rankMap(
      program.boats.filter((boat) => boat.course >= 2).map((boat) => [boat.course, boat.nationalWinRate] as const),
      ([, value]) => value,
      true,
    );
    const period = periodFor(race.date);
    evaluatedRaces += 1;

    for (const definition of strategyDefs) {
      const second = definition.fixed ?? selectDynamicSecond(context, definition.strategy!);
      if (second == null) continue;
      const selection = `1-${second}`;
      const odds = market.get(selection);
      const implied = marketProbability.get(second);
      if (odds == null || implied == null) continue;
      const marketRank = marketRanks.get(second);
      const nationalRank = nationalRanks.get(second);
      const contexts = contextsFor({
        course: second,
        odds,
        marketRank,
        underboughtGap: marketRank != null && nationalRank != null ? marketRank - nationalRank : null,
        windSpeed: race.wind_speed,
        raceNo: race.race_no,
      });
      for (const contextId of contexts) {
        evalRows.push({
          period,
          strategy: definition.id,
          context: contextId,
          selection,
          implied,
          hit: race.winner === selection,
          payout: race.winner === selection ? race.payout_yen ?? 0 : 0,
          venue: race.venue,
        });
      }
    }
  }

  const candidateKeys = [...new Set(evalRows.map((row) => `${row.strategy}\0${row.context}`))];
  const candidates = candidateKeys.map((key) => {
    const [strategy, context] = key.split("\0");
    const rows = evalRows.filter((row) => row.strategy === strategy && row.context === context);
    return {
      strategy,
      strategyLabel: strategyDefs.find((definition) => definition.id === strategy)?.label ?? strategy,
      context,
      discovery: metric(rows.filter((row) => row.period === "discovery")),
      validation: metric(rows.filter((row) => row.period === "validation")),
    };
  });

  const discoveryPassed = candidates.filter((candidate) => passesDiscovery(candidate.discovery));
  const validationPassed = discoveryPassed
    .filter((candidate) => passesValidation(candidate.validation))
    .map((candidate) => {
      const testRows = evalRows.filter((row) => row.strategy === candidate.strategy && row.context === candidate.context && row.period === "test");
      return { ...candidate, test: metric(testRows), testLeaveOneVenue: leaveOneVenue(testRows) };
    });
  const robust = validationPassed.filter((candidate) => passesTest(candidate.test, candidate.testLeaveOneVenue));
  const nearMisses = discoveryPassed
    .filter((candidate) => !passesValidation(candidate.validation))
    .sort((a, b) => score(b.validation) - score(a.validation))
    .slice(0, 15);
  const placebo = candidates
    .filter((candidate) => candidate.strategy === "national_worst_placebo" && candidate.context === "all")
    .map((candidate) => {
      const testRows = evalRows.filter((row) => row.strategy === candidate.strategy && row.context === candidate.context && row.period === "test");
      return { ...candidate, test: metric(testRows) };
    });

  const report = {
    generatedAt: new Date().toISOString(),
    safety: {
      readOnly: true,
      oneTicketPerStrategyRace: true,
      closingOddsOnly: true,
      productionConnected: false,
      testThresholdTuning: false,
    },
    split: {
      discovery: "2024-01-01..2024-06-30",
      validation: "2024-07-01..2024-12-31",
      untouchedTest: "2025-01-01..2025-12-31",
    },
    family: {
      strategies: strategyDefs.length,
      candidates: candidates.length,
      discoveryPassed: discoveryPassed.length,
      validationPassed: validationPassed.length,
      robust: robust.length,
    },
    coverage: { candidateRaces: races.length, evaluatedRaces, rejectedRaces: races.length - evaluatedRaces },
    validationPassed,
    robust,
    nearMisses,
    placebo,
    caveats: [
      "historical closing oddsでありlive/T-5ではない",
      "discoveryとvalidationを通過した候補だけをtest判定する",
      "venue・月の個別後付け探索は行わない",
      "通過してもfuture-only監視前に本番接続しない",
    ],
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/ability-market-validation.json", `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# 能力情報×市場順位 三段階ROI検証",
    "",
    "> discovery→validationを通過した条件だけを2025 testで判定する。closing oddsであり本番採用不可。",
    "",
    `coverage: 候補${races.length} / 評価${evaluatedRaces} / 除外${races.length - evaluatedRaces}レース`,
    `探索族: ${strategyDefs.length}戦略 / ${candidates.length}条件`,
    "split: 2024上期 discovery / 2024下期 validation / 2025 untouched test",
    "",
    "## Gate通過数",
    "",
    `- discovery通過: ${discoveryPassed.length}`,
    `- validationまで通過: ${validationPassed.length}`,
    `- test頑健利益gate通過: ${robust.length}`,
    "",
    "## validation通過候補のtest結果",
    "",
    "| 戦略 | 条件 | discovery | validation | test | test LOO最小 | 判定 |",
    "|---|---|---:|---:|---:|---:|---|",
    ...(validationPassed.length > 0
      ? validationPassed.map((candidate) => `| ${candidate.strategyLabel} | ${contextLabel(candidate.context)} | ${cell(candidate.discovery)} | ${cell(candidate.validation)} | ${cell(candidate.test)} | ${pct(candidate.testLeaveOneVenue)} | ${passesTest(candidate.test, candidate.testLeaveOneVenue) ? "robust" : "reject"} |`)
      : ["| 該当なし | — | — | — | test未開封 | — | reject |"]),
    "",
    "## validationで落ちた上位候補",
    "",
    "| 戦略 | 条件 | discovery | validation |",
    "|---|---|---:|---:|",
    ...nearMisses.map((candidate) => `| ${candidate.strategyLabel} | ${contextLabel(candidate.context)} | ${cell(candidate.discovery)} | ${cell(candidate.validation)} |`),
    "",
    "## placebo",
    "",
    ...placebo.map((candidate) => `- ${candidate.strategyLabel}: discovery ${cell(candidate.discovery)} / validation ${cell(candidate.validation)} / test ${cell(candidate.test)}`),
    "",
    "## 結論",
    "",
    robust.length > 0
      ? "三段階gateを通過した仮説はあるが、closing oddsのためfuture-only T-5監視へ固定するまで採用しない。"
      : "能力情報と市場順位のずれを組み合わせても、三段階で頑健に黒字化するedgeは確認できなかった。",
    "",
    "- 2025 testを見て条件や閾値を変更しない。",
    "- BUY・app_settings・本番decisionへ接続しない。",
  ];
  writeFileSync("reports/ability-market-validation.md", `${lines.join("\n")}\n`);
  console.log(`ability-market validation: races=${evaluatedRaces} candidates=${candidates.length} discovery=${discoveryPassed.length} validation=${validationPassed.length} robust=${robust.length}`);
} finally {
  db.close();
}

function periodFor(date: string): Period {
  if (date <= "2024-06-30") return "discovery";
  if (date <= "2024-12-31") return "validation";
  return "test";
}

function contextsFor(input: {
  course: number;
  odds: number;
  marketRank: number | undefined;
  underboughtGap: number | null;
  windSpeed: number | null;
  raceNo: number;
}): string[] {
  const contexts = ["all", `course_${input.course}`, `odds_${oddsBand(input.odds)}`, `race_${raceBand(input.raceNo)}`];
  if (input.marketRank != null) contexts.push(`market_rank_${input.marketRank <= 2 ? "1_2" : input.marketRank === 3 ? "3" : "4_5"}`);
  if (input.underboughtGap != null && input.underboughtGap >= 2) contexts.push("underbought_gap_2plus");
  const wind = windBand(input.windSpeed);
  if (wind) contexts.push(`wind_${wind}`);
  return contexts;
}

function oddsBand(odds: number): string {
  if (odds < 10) return "under10";
  if (odds < 20) return "10_20";
  if (odds < 30) return "20_30";
  if (odds < 50) return "30_50";
  return "50plus";
}

function windBand(wind: number | null): string | null {
  if (wind == null) return null;
  if (wind < 1) return "0_1";
  if (wind < 2) return "1_2";
  if (wind < 3) return "2_3";
  if (wind < 4) return "3_4";
  if (wind < 6) return "4_6";
  return "6plus";
}

function raceBand(raceNo: number): string {
  if (raceNo <= 4) return "1_4";
  if (raceNo <= 8) return "5_8";
  return "9_12";
}

function rankMap<T extends readonly [number, number | undefined]>(rows: T[], value: (row: T) => number | undefined, descending: boolean): Map<number, number> {
  const valid = rows.filter((row) => value(row) != null && Number.isFinite(value(row)));
  valid.sort((a, b) => ((descending ? -1 : 1) * ((value(a) ?? 0) - (value(b) ?? 0))) || a[0] - b[0]);
  return new Map(valid.map((row, index) => [row[0], index + 1]));
}

function metric(rows: EvalRow[]): Metric {
  const payouts = rows.filter((row) => row.hit).map((row) => row.payout).sort((a, b) => b - a);
  const total = payouts.reduce((sum, payout) => sum + payout, 0);
  const expected = rows.reduce((sum, row) => sum + row.implied, 0);
  return {
    n: rows.length,
    hits: payouts.length,
    edgePp: rows.length > 0 ? ((payouts.length - expected) / rows.length) * 100 : 0,
    roi: rows.length > 0 ? total / (rows.length * 100) : 0,
    max2HitExclRoi: rows.length > 2 ? (total - (payouts[0] ?? 0) - (payouts[1] ?? 0)) / ((rows.length - 2) * 100) : 0,
  };
}

function leaveOneVenue(rows: EvalRow[]): number {
  const values = [...new Set(rows.map((row) => row.venue))].map((venue) => metric(rows.filter((row) => row.venue !== venue)).max2HitExclRoi);
  return values.length > 0 ? Math.min(...values) : 0;
}

function passesDiscovery(value: Metric): boolean {
  return value.n >= 60 && value.edgePp > 0 && value.roi >= 1 && value.max2HitExclRoi >= 0.85;
}

function passesValidation(value: Metric): boolean {
  return value.n >= 40 && value.edgePp > 0 && value.roi >= 1 && value.max2HitExclRoi >= 0.85;
}

function passesTest(value: Metric, leaveOne: number): boolean {
  return value.n >= 100 && value.edgePp > 0 && value.roi >= 1 && value.max2HitExclRoi >= 1 && leaveOne >= 0.95;
}

function score(value: Metric): number {
  return value.edgePp + value.roi * 10 + value.max2HitExclRoi * 5;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function cell(value: Metric): string {
  return `n=${value.n} / edge ${signed(value.edgePp)}pt / ROI ${pct(value.roi)} / max2 ${pct(value.max2HitExclRoi)}`;
}

function contextLabel(context: string): string {
  return context.replaceAll("_", " ");
}
