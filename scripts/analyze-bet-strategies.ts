/**
 * 買い方別ROIシミュレーション。
 *
 * 読み取り専用:
 * - DB INSERT / UPDATE / DELETE なし
 * - app_settings 変更なし
 * - 本番decision生成ロジック変更なし
 *
 * ROI:
 * - run_kind='historical-backfill' decision='BUY'
 * - 1点100円
 * - 複数点は ticket_count * 100円
 * - 的中回収は result selection の current odds * 100円
 * - payout_yen は使わない
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-strategy-simulation.md";
const OUT_JSON = "reports/bet-strategy-simulation.json";
const STAKE_YEN = 100;

type DecisionRow = {
  id: number;
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  current_odds: number;
  result: string;
  venue_motor_top2_rate: number | null;
  venue_boat_top2_rate: number | null;
};

type RaceContext = {
  weatherPresent: boolean;
  exhibitionPresent: boolean;
  fPresent: boolean;
  windMps: number | null;
  waveCm: number | null;
  exhibitionRankByBoat: Map<number, number>;
};

type BaseRow = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  venue: string;
  raceNo: number;
  selection: string;
  selectionNums: number[];
  result: string;
  resultNums: number[];
  originalOdds: number;
  headVenueMotorTop2Rate: number | null;
  headVenueBoatTop2Rate: number | null;
  hasVenueMotorBoat: boolean;
  context: RaceContext;
};

type StrategyName =
  | "original_single"
  | "first_second_third_flow"
  | "first_third_second_flow"
  | "first_fixed_second_third_flow"
  | "top3_box"
  | "top4_box"
  | "second_third_reverse"
  | "first_second_flow_odds_min_5"
  | "first_second_flow_odds_min_8"
  | "first_second_flow_odds_min_10"
  | "box_only_when_order_uncertain";

type Ticket = { selection: string; odds: number | null };
type RaceStrategyResult = {
  row: BaseRow;
  strategy: StrategyName;
  generatedTickets: number;
  tickets: Ticket[];
  missingTickets: number;
  hit: boolean;
  hitOdds: number | null;
  stakeYen: number;
  returnYen: number;
};

type StrategySummary = {
  strategy: StrategyName;
  races: number;
  totalTickets: number;
  generatedTickets: number;
  missingTickets: number;
  missingRate: number;
  avgTicketsPerRace: number;
  hitRaces: number;
  hitRate: number;
  avgTicketOdds: number;
  avgHitOdds: number;
  stakeYen: number;
  returnYen: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

type GroupBest = {
  key: string;
  bestStrategy: StrategyName;
  originalRoi: number;
  bestRoi: number;
  n: number;
  comment: string;
};

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-bet-strategies] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const rows = loadBaseRows();
  const raceIds = unique(rows.map((r) => r.raceId));
  const odds = loadOddsMap(raceIds);
  const strategyResults = simulateAll(rows, odds);
  const summaries = summarizeStrategies(strategyResults);
  const original = summaries.find((s) => s.strategy === "original_single");
  if (!original) throw new Error("original_single summary missing");

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    period: { minDate: rows[0]?.date ?? null, maxDate: rows.at(-1)?.date ?? null },
    original,
    summaries,
    classifications: classifyStrategies(summaries, original),
    missAnalysis: analyzeMisses(rows),
    splitValidation: splitValidation(strategyResults),
    venueBest: bestByGroup(strategyResults, (r) => r.row.venue, 50),
    raceNoBest: bestByGroup(strategyResults, (r) => `${r.row.raceNo}R`, 50),
    oddsBandBest: bestByGroup(strategyResults, (r) => oddsBand(r.row.originalOdds), 50),
    headBest: bestByGroup(strategyResults, (r) => headBand(r.row.selectionNums[0]), 50),
    weatherBest: bestByGroup(strategyResults, (r) => r.row.context.weatherPresent ? "天候あり" : "天候なし", 30),
    exhibitionBest: bestByGroup(strategyResults, (r) => r.row.context.exhibitionPresent ? "展示あり" : "展示なし", 30),
    fBest: bestByGroup(strategyResults, (r) => r.row.context.fPresent ? "F情報あり" : "F情報なし", 30),
    windBest: bestByGroup(strategyResults, (r) => windBand(r.row.context.windMps), 30),
    waveBest: bestByGroup(strategyResults, (r) => waveBand(r.row.context.waveCm), 30),
    motorBest: bestByGroup(strategyResults, (r) => motorBand(r.row.headVenueMotorTop2Rate), 50),
    boatBest: bestByGroup(strategyResults, (r) => boatBand(r.row.headVenueBoatTop2Rate), 50),
    motorStrategy: motorStrategyMatrix(strategyResults),
    flowConditions: findConditionalWinners(strategyResults, ["first_second_third_flow", "first_fixed_second_third_flow", "first_second_flow_odds_min_5", "first_second_flow_odds_min_8", "first_second_flow_odds_min_10"]),
    boxConditions: findConditionalWinners(strategyResults, ["top3_box", "top4_box", "box_only_when_order_uncertain"]),
    additionalSuggestions: additionalSuggestions(),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, jsonReplacer, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-bet-strategies] wrote ${OUT_MD}`);
  console.log(`[analyze-bet-strategies] wrote ${OUT_JSON}`);
  console.log(`[analyze-bet-strategies] original BUY n=${original.races} hit=${original.hitRaces} hitRate=${pct(original.hitRate)} avgOdds=${num(original.avgTicketOdds)} ROI=${pct(original.roi / 100)}`);
} finally {
  db.close();
}

function loadBaseRows(): BaseRow[] {
  const decisions = db.prepare(`
SELECT
  dh.id,
  dh.race_id,
  dh.date,
  dh.venue,
  dh.race_no,
  dh.selection,
  dh.current_odds,
  dh.result,
  mbs.motor_top2_rate AS venue_motor_top2_rate,
  mbs.boat_top2_rate AS venue_boat_top2_rate
FROM decision_history dh
LEFT JOIN motor_boat_stats mbs
  ON mbs.race_id = dh.race_id
 AND mbs.course = CAST(substr(dh.selection, 1, 1) AS INTEGER)
WHERE dh.run_kind = 'historical-backfill'
  AND dh.decision = 'BUY'
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
ORDER BY dh.date, dh.id
`).all() as DecisionRow[];

  const contexts = loadRaceContexts(unique(decisions.map((r) => r.race_id)));
  return decisions
    .map((row) => {
      const selectionNums = parseSelection(row.selection);
      const resultNums = parseSelection(row.result);
      if (selectionNums.length !== 3 || resultNums.length !== 3) return null;
      return {
        id: row.id,
        raceId: row.race_id,
        date: row.date,
        ym: row.date.slice(0, 7),
        venue: row.venue,
        raceNo: row.race_no,
        selection: row.selection,
        selectionNums,
        result: row.result,
        resultNums,
        originalOdds: Number(row.current_odds),
        headVenueMotorTop2Rate: nullableNumber(row.venue_motor_top2_rate),
        headVenueBoatTop2Rate: nullableNumber(row.venue_boat_top2_rate),
        hasVenueMotorBoat: row.venue_motor_top2_rate != null || row.venue_boat_top2_rate != null,
        context: contexts.get(row.race_id) ?? emptyContext(),
      };
    })
    .filter((row): row is BaseRow => row != null);
}

function loadRaceContexts(raceIds: string[]) {
  const map = new Map<string, RaceContext>();
  for (const id of raceIds) map.set(id, emptyContext());
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const weatherRows = db.prepare(`
SELECT race_id, weather, wind_speed_mps, wave_height_cm
FROM race_weather
WHERE race_id IN (${placeholders})
`).all(...ids) as Array<{ race_id: string; weather: string | null; wind_speed_mps: number | null; wave_height_cm: number | null }>;
    for (const row of weatherRows) {
      const context = map.get(row.race_id);
      if (!context) continue;
      context.weatherPresent = row.weather != null || row.wind_speed_mps != null || row.wave_height_cm != null;
      context.windMps = nullableNumber(row.wind_speed_mps);
      context.waveCm = nullableNumber(row.wave_height_cm);
    }

    const exhibitionRows = db.prepare(`
SELECT race_id, course, exhibition_time, ranking, start_timing
FROM exhibition_data
WHERE race_id IN (${placeholders})
`).all(...ids) as Array<{ race_id: string; course: number; exhibition_time: number | null; ranking: number | null; start_timing: number | null }>;
    const byRace = new Map<string, Array<{ course: number; exhibition_time: number | null; ranking: number | null; start_timing: number | null }>>();
    for (const row of exhibitionRows) byRace.set(row.race_id, [...(byRace.get(row.race_id) ?? []), row]);
    for (const [raceId, raceRows] of byRace) {
      const context = map.get(raceId);
      if (!context) continue;
      context.exhibitionPresent = raceRows.length >= 3;
      const ranked = raceRows
        .filter((r) => r.exhibition_time != null)
        .sort((a, b) => Number(a.exhibition_time) - Number(b.exhibition_time));
      for (const row of raceRows) {
        const derived = ranked.findIndex((r) => r.course === row.course);
        const rank = row.ranking ?? (derived >= 0 ? derived + 1 : null);
        if (rank != null) context.exhibitionRankByBoat.set(Number(row.course), Number(rank));
      }
    }

    const fRows = db.prepare(`
SELECT ent.race_id, COUNT(*) AS n
FROM race_entries ent
JOIN racer_profiles rp ON rp.registration_no = ent.racer_reg
WHERE ent.race_id IN (${placeholders})
  AND rp.flying_count IS NOT NULL
GROUP BY ent.race_id
`).all(...ids) as Array<{ race_id: string; n: number }>;
    for (const row of fRows) {
      const context = map.get(row.race_id);
      if (context) context.fPresent = Number(row.n) > 0;
    }
  }
  return map;
}

function loadOddsMap(raceIds: string[]) {
  const map = new Map<string, Map<string, number>>();
  for (const ids of chunks(raceIds, 500)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
WITH ranked AS (
  SELECT
    race_id,
    selection,
    odds,
    ROW_NUMBER() OVER (
      PARTITION BY race_id, selection
      ORDER BY is_final_like DESC, captured_at DESC, id DESC
    ) AS rn
  FROM odds_snapshots
  WHERE race_id IN (${placeholders})
)
SELECT race_id, selection, odds
FROM ranked
WHERE rn = 1
`).all(...ids) as Array<{ race_id: string; selection: string; odds: number }>;
    for (const row of rows) {
      const raceMap = map.get(row.race_id) ?? new Map<string, number>();
      raceMap.set(row.selection, Number(row.odds));
      map.set(row.race_id, raceMap);
    }
  }
  return map;
}

function simulateAll(rows: BaseRow[], odds: Map<string, Map<string, number>>) {
  const strategyNames: StrategyName[] = [
    "original_single",
    "first_second_third_flow",
    "first_third_second_flow",
    "first_fixed_second_third_flow",
    "top3_box",
    "top4_box",
    "second_third_reverse",
    "first_second_flow_odds_min_5",
    "first_second_flow_odds_min_8",
    "first_second_flow_odds_min_10",
    "box_only_when_order_uncertain",
  ];
  const results: RaceStrategyResult[] = [];
  for (const row of rows) {
    for (const strategy of strategyNames) {
      results.push(simulateStrategy(row, strategy, odds.get(row.raceId) ?? new Map()));
    }
  }
  return results;
}

function simulateStrategy(row: BaseRow, strategy: StrategyName, raceOdds: Map<string, number>): RaceStrategyResult {
  const generated = generateTickets(row, strategy);
  const tickets = generated.map((selection) => ({
    selection,
    odds: selection === row.selection ? row.originalOdds : raceOdds.get(selection) ?? null,
  }));
  const available = tickets.filter((ticket) => ticket.odds != null) as Array<{ selection: string; odds: number }>;
  const hitTicket = available.find((ticket) => ticket.selection === row.result);
  return {
    row,
    strategy,
    generatedTickets: generated.length,
    tickets,
    missingTickets: tickets.length - available.length,
    hit: Boolean(hitTicket),
    hitOdds: hitTicket?.odds ?? null,
    stakeYen: available.length * STAKE_YEN,
    returnYen: hitTicket ? hitTicket.odds * STAKE_YEN : 0,
  };
}

function generateTickets(row: BaseRow, strategy: StrategyName) {
  const [a, b, c] = row.selectionNums;
  const boats = [1, 2, 3, 4, 5, 6];
  const uniqueTickets = (items: string[]) => unique(items.filter((selection) => parseSelection(selection).length === 3));
  if (strategy === "original_single") return [row.selection];
  if (strategy === "first_second_third_flow") return uniqueTickets(boats.filter((x) => x !== a && x !== b).map((x) => joinSelection([a, b, x])));
  if (strategy === "first_third_second_flow") return uniqueTickets(boats.filter((x) => x !== a && x !== c).map((x) => joinSelection([a, x, c])));
  if (strategy === "first_fixed_second_third_flow") {
    const tickets: string[] = [];
    for (const second of boats.filter((x) => x !== a)) {
      for (const third of boats.filter((x) => x !== a && x !== second)) tickets.push(joinSelection([a, second, third]));
    }
    return uniqueTickets(tickets);
  }
  if (strategy === "top3_box") return permutations(row.selectionNums).map(joinSelection);
  if (strategy === "top4_box") {
    const next = nextBoat(row);
    if (next == null) return [row.selection];
    return permutationsK([...row.selectionNums, next], 3).map(joinSelection);
  }
  if (strategy === "second_third_reverse") return uniqueTickets([row.selection, joinSelection([a, c, b])]);
  if (strategy === "first_second_flow_odds_min_5") return generatedOddsFiltered(row, 5);
  if (strategy === "first_second_flow_odds_min_8") return generatedOddsFiltered(row, 8);
  if (strategy === "first_second_flow_odds_min_10") return generatedOddsFiltered(row, 10);
  if (strategy === "box_only_when_order_uncertain") {
    const ranks = row.selectionNums.map((boat) => row.context.exhibitionRankByBoat.get(boat)).filter(isNumber);
    const spreadSmall = ranks.length >= 3 && Math.max(...ranks) - Math.min(...ranks) <= 2;
    const originalOrderWeak = row.originalOdds >= 30;
    return spreadSmall || originalOrderWeak ? permutations(row.selectionNums).map(joinSelection) : [row.selection];
  }
  return [row.selection];
}

function generatedOddsFiltered(row: BaseRow, minOdds: number) {
  const [a, b] = row.selectionNums;
  void minOdds;
  return [1, 2, 3, 4, 5, 6]
    .filter((x) => x !== a && x !== b)
    .map((x) => joinSelection([a, b, x]));
}

function summarizeStrategies(results: RaceStrategyResult[]) {
  const byStrategy = new Map<StrategyName, RaceStrategyResult[]>();
  for (const result of results) byStrategy.set(result.strategy, [...(byStrategy.get(result.strategy) ?? []), result]);
  return [...byStrategy.entries()].map(([strategy, rows]) => summarize(strategy, rows));
}

function summarize(strategy: StrategyName, rows: RaceStrategyResult[]): StrategySummary {
  const normalizedRows = rows.map((row) => normalizeOddsFiltered(row));
  const races = normalizedRows.length;
  const totalTickets = normalizedRows.reduce((sum, r) => sum + r.tickets.filter((t) => t.odds != null).length, 0);
  const ticketOdds = normalizedRows.flatMap((r) => r.tickets.map((t) => t.odds).filter(isNumber));
  const generatedTickets = normalizedRows.reduce((sum, r) => sum + r.generatedTickets, 0);
  const missingTickets = normalizedRows.reduce((sum, r) => sum + r.missingTickets, 0);
  const hitRows = normalizedRows.filter((r) => r.hit);
  const hitOdds = hitRows.map((r) => Number(r.hitOdds)).sort((a, b) => b - a);
  const stakeYen = normalizedRows.reduce((sum, r) => sum + r.stakeYen, 0);
  const returnYen = normalizedRows.reduce((sum, r) => sum + r.returnYen, 0);
  const returnExMax = Math.max(0, returnYen - ((hitOdds[0] ?? 0) * STAKE_YEN));
  return {
    strategy,
    races,
    totalTickets,
    generatedTickets,
    missingTickets,
    missingRate: generatedTickets ? missingTickets / generatedTickets : 0,
    avgTicketsPerRace: races ? totalTickets / races : 0,
    hitRaces: hitRows.length,
    hitRate: races ? hitRows.length / races : 0,
    avgTicketOdds: ticketOdds.length ? ticketOdds.reduce((a, b) => a + b, 0) / ticketOdds.length : 0,
    avgHitOdds: hitOdds.length ? hitOdds.reduce((a, b) => a + b, 0) / hitOdds.length : 0,
    stakeYen,
    returnYen,
    roi: stakeYen ? (returnYen / stakeYen) * 100 : 0,
    maxHitOdds: hitOdds[0] ?? 0,
    roiExMaxHit: stakeYen ? (returnExMax / stakeYen) * 100 : 0,
  };
}

function normalizeOddsFiltered(input: RaceStrategyResult): RaceStrategyResult {
  if (!input.strategy.startsWith("first_second_flow_odds_min_")) return input;
  const minOdds = Number(input.strategy.replace("first_second_flow_odds_min_", ""));
  const tickets = input.tickets
    .filter((ticket) => ticket.odds != null && ticket.odds >= minOdds);
  const hitTicket = tickets.find((ticket) => ticket.selection === input.row.result);
  return {
    ...input,
    tickets,
    missingTickets: input.generatedTickets - tickets.length,
    hit: Boolean(hitTicket),
    hitOdds: hitTicket?.odds ?? null,
    stakeYen: tickets.length * STAKE_YEN,
    returnYen: hitTicket?.odds ? hitTicket.odds * STAKE_YEN : 0,
  };
}

function classifyStrategies(summaries: StrategySummary[], original: StrategySummary) {
  return summaries.map((summary) => {
    if (summary.strategy === "original_single") {
      return { strategy: summary.strategy, classification: "基準", hitRate: summary.hitRate, roi: summary.roi };
    }
    const hitUp = summary.hitRate > original.hitRate;
    const roiUp = summary.roi > original.roi;
    const classification = hitUp && roiUp
      ? "A. 的中率もROIも上がる"
      : hitUp && !roiUp
        ? "B. 的中率は上がるがROIは下がる"
        : !hitUp && roiUp
          ? "C. 的中率は下がるがROIは上がる"
          : "D. どちらも下がる";
    return { strategy: summary.strategy, classification, hitRate: summary.hitRate, roi: summary.roi };
  });
}

function analyzeMisses(rows: BaseRow[]) {
  const misses = rows.filter((row) => row.result !== row.selection);
  const counts = {
    totalMisses: misses.length,
    headMatched: 0,
    firstSecondMatchedThirdMiss: 0,
    firstThirdMatchedSecondMiss: 0,
    secondThirdReversed: 0,
    top3AllInOrderDifferent: 0,
    completelyDifferent: 0,
  };
  for (const row of misses) {
    const [a, b, c] = row.selectionNums;
    const [r1, r2, r3] = row.resultNums;
    const selectedSet = new Set(row.selectionNums);
    const allIn = row.resultNums.every((n) => selectedSet.has(n));
    if (r1 === a) counts.headMatched += 1;
    if (r1 === a && r2 === b && r3 !== c) counts.firstSecondMatchedThirdMiss += 1;
    if (r1 === a && r3 === c && r2 !== b) counts.firstThirdMatchedSecondMiss += 1;
    if (row.result === joinSelection([a, c, b])) counts.secondThirdReversed += 1;
    if (allIn && row.result !== row.selection) counts.top3AllInOrderDifferent += 1;
    if (!allIn && r1 !== a) counts.completelyDifferent += 1;
  }
  return counts;
}

function splitValidation(results: RaceStrategyResult[]) {
  const rowIds = unique(results.map((r) => r.row.id)).sort((a, b) => a - b);
  const trainEnd = Math.floor(rowIds.length * 0.7);
  const validationEnd = Math.floor(rowIds.length * 0.9);
  const train = new Set(rowIds.slice(0, trainEnd));
  const validation = new Set(rowIds.slice(trainEnd, validationEnd));
  const test = new Set(rowIds.slice(validationEnd));
  const byStrategy = new Map<StrategyName, RaceStrategyResult[]>();
  for (const result of results) byStrategy.set(result.strategy, [...(byStrategy.get(result.strategy) ?? []), result]);
  return [...byStrategy.entries()].map(([strategy, rows]) => {
    const trainSummary = summarize(strategy, rows.filter((r) => train.has(r.row.id)));
    const validationSummary = summarize(strategy, rows.filter((r) => validation.has(r.row.id)));
    const testSummary = summarize(strategy, rows.filter((r) => test.has(r.row.id)));
    const monthly = monthlyStability(strategy, rows);
    return {
      strategy,
      trainRoi: trainSummary.roi,
      validationRoi: validationSummary.roi,
      testRoi: testSummary.roi,
      monthlyStability: monthly,
      judgement: judgeSplit(trainSummary, validationSummary, testSummary, monthly),
    };
  });
}

function bestByGroup(results: RaceStrategyResult[], keyFn: (result: RaceStrategyResult) => string, minRaces: number): GroupBest[] {
  const groups = new Map<string, RaceStrategyResult[]>();
  for (const result of results) groups.set(keyFn(result), [...(groups.get(keyFn(result)) ?? []), result]);
  const out: GroupBest[] = [];
  for (const [key, rows] of groups) {
    const summaries = summarizeStrategies(rows);
    const original = summaries.find((s) => s.strategy === "original_single");
    if (!original || original.races < minRaces) continue;
    const best = summaries
      .filter((s) => s.missingRate < 0.2 && s.stakeYen > 0)
      .sort((a, b) => b.roi - a.roi)[0];
    if (!best) continue;
    out.push({
      key,
      bestStrategy: best.strategy,
      originalRoi: original.roi,
      bestRoi: best.roi,
      n: original.races,
      comment: best.roi > original.roi ? "改善候補。ただし同一条件でvalidation確認必須" : "1点維持候補",
    });
  }
  return out.sort((a, b) => b.bestRoi - a.bestRoi);
}

function findConditionalWinners(results: RaceStrategyResult[], targets: StrategyName[]) {
  const candidates = [
    ...bestByGroup(results, (r) => r.row.venue, 80),
    ...bestByGroup(results, (r) => `${r.row.raceNo}R`, 80),
    ...bestByGroup(results, (r) => oddsBand(r.row.originalOdds), 80),
    ...bestByGroup(results, (r) => headBand(r.row.selectionNums[0]), 80),
    ...bestByGroup(results, (r) => windBand(r.row.context.windMps), 80),
    ...bestByGroup(results, (r) => waveBand(r.row.context.waveCm), 80),
  ];
  return candidates
    .filter((c) => targets.includes(c.bestStrategy) && c.bestRoi > c.originalRoi)
    .sort((a, b) => (b.bestRoi - b.originalRoi) - (a.bestRoi - a.originalRoi))
    .slice(0, 20);
}

function motorStrategyMatrix(results: RaceStrategyResult[]) {
  const conditions: Array<[string, (row: BaseRow) => boolean]> = [
    ["venueMotorTop2Rate >= 50", (row) => (row.headVenueMotorTop2Rate ?? -1) >= 50],
    ["venueMotorTop2Rate 35-50", (row) => (row.headVenueMotorTop2Rate ?? -1) >= 35 && (row.headVenueMotorTop2Rate ?? -1) < 50],
    ["venueMotorTop2Rate < 35", (row) => (row.headVenueMotorTop2Rate ?? 999) < 35],
    ["venueBoatTop2Rate >= 50", (row) => (row.headVenueBoatTop2Rate ?? -1) >= 50],
    ["venueBoatTop2Rate < 35", (row) => (row.headVenueBoatTop2Rate ?? 999) < 35],
    ["venue motor/boatあり", (row) => row.hasVenueMotorBoat],
    ["venue motor/boat欠損", (row) => !row.hasVenueMotorBoat],
  ];
  const strategies: StrategyName[] = ["original_single", "second_third_reverse", "first_second_third_flow", "first_fixed_second_third_flow", "top3_box", "top4_box"];
  const rows: Array<{ condition: string; strategy: StrategyName } & StrategySummary & { comment: string }> = [];
  for (const [condition, fn] of conditions) {
    const subset = results.filter((result) => fn(result.row) && strategies.includes(result.strategy));
    for (const summary of summarizeStrategies(subset).filter((s) => strategies.includes(s.strategy))) {
      rows.push({
        condition,
        ...summary,
        comment: summary.races < 50
          ? "n不足"
          : summary.missingRate >= 0.8
            ? "odds欠損が多く参考扱い"
            : summary.roi >= 100
              ? "edge候補。ただし最大1hit除外確認"
              : "単独では弱い",
      });
    }
  }
  return rows.sort((a, b) => a.condition.localeCompare(b.condition) || b.roi - a.roi);
}

function monthlyStability(strategy: StrategyName, rows: RaceStrategyResult[]) {
  const byMonth = new Map<string, RaceStrategyResult[]>();
  for (const row of rows) byMonth.set(row.row.ym, [...(byMonth.get(row.row.ym) ?? []), row]);
  const monthly = [...byMonth.entries()]
    .map(([ym, monthRows]) => ({ ym, summary: summarize(strategy, monthRows) }))
    .filter((row) => row.summary.races >= 20);
  const good = monthly.filter((row) => row.summary.roi >= 100).length;
  const bad = monthly.filter((row) => row.summary.roi < 80).length;
  return monthly.length ? `${good}/${monthly.length}ヶ月がROI>=100、${bad}ヶ月がROI<80` : "n不足";
}

function judgeSplit(train: StrategySummary, validation: StrategySummary, test: StrategySummary, monthly: string) {
  if (train.races < 50 || validation.races < 20 || test.races < 20) return "C: n不足";
  if (train.roi >= 100 && validation.roi >= 100 && test.roi >= 90 && train.roiExMaxHit >= 80) return "S: 再現性あり";
  if (train.roi >= 90 && validation.roi >= 90 && test.roi >= 80) return "A: 追加確認";
  if (train.roi >= 100 && validation.roi < 80) return "B: validationで弱い";
  if (monthly.includes("0/")) return "D: 月別不安定";
  return "C: 観察";
}

function renderMarkdown(report: {
  period: { minDate: string | null; maxDate: string | null };
  original: StrategySummary;
  summaries: StrategySummary[];
  classifications: ReturnType<typeof classifyStrategies>;
  missAnalysis: ReturnType<typeof analyzeMisses>;
  splitValidation: ReturnType<typeof splitValidation>;
  venueBest: GroupBest[];
  raceNoBest: GroupBest[];
  oddsBandBest: GroupBest[];
  headBest: GroupBest[];
  weatherBest: GroupBest[];
  exhibitionBest: GroupBest[];
  fBest: GroupBest[];
  windBest: GroupBest[];
  waveBest: GroupBest[];
  motorBest: GroupBest[];
  boatBest: GroupBest[];
  motorStrategy: ReturnType<typeof motorStrategyMatrix>;
  flowConditions: GroupBest[];
  boxConditions: GroupBest[];
  additionalSuggestions: ReturnType<typeof additionalSuggestions>;
}) {
  const lines: string[] = [];
  lines.push("# 買い方別ROIシミュレーション", "");
  lines.push("## 1. 現状1点BUY");
  lines.push(`- 対象期間: ${report.period.minDate ?? "-"} 〜 ${report.period.maxDate ?? "-"}`);
  lines.push("- 対象: `run_kind='historical-backfill' AND decision='BUY' AND current_odds IS NOT NULL AND result IS NOT NULL`");
  lines.push("- BUYは購入指示ではなく検証候補。自動投票・ログイン保存・投票サイト操作は対象外。");
  lines.push(`- BUY件数: ${report.original.races}`);
  lines.push(`- 的中数: ${report.original.hitRaces}`);
  lines.push(`- 的中率: ${pct(report.original.hitRate)}`);
  lines.push(`- 平均odds: ${num(report.original.avgTicketOdds)}`);
  lines.push(`- 平均的中odds: ${num(report.original.avgHitOdds)}`);
  lines.push(`- 投資額: ${yen(report.original.stakeYen)}`);
  lines.push(`- 回収額: ${yen(report.original.returnYen)}`);
  lines.push(`- ROI: ${pct(report.original.roi / 100)}`, "");

  lines.push("## 2. 買い方別比較");
  lines.push("| strategy | races | total_tickets | avg_tickets_per_race | hit_races | hit_rate | avg_ticket_odds | avg_hit_odds | stake | return | ROI | 欠損率 | 最大1hit除外ROI |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of report.summaries) {
    lines.push(`| ${s.strategy} | ${s.races} | ${s.totalTickets} | ${num(s.avgTicketsPerRace)} | ${s.hitRaces} | ${pct(s.hitRate)} | ${num(s.avgTicketOdds)} | ${num(s.avgHitOdds)} | ${yen(s.stakeYen)} | ${yen(s.returnYen)} | ${pct(s.roi / 100)} | ${pct(s.missingRate)} | ${pct(s.roiExMaxHit / 100)} |`);
  }
  lines.push("");

  lines.push("## 3. 的中率とROIの関係");
  lines.push("| strategy | 分類 | hit_rate | ROI | コメント |");
  lines.push("|---|---|---:|---:|---|");
  for (const c of report.classifications) {
    const comment = c.classification === "基準" ? "比較の基準。" : c.classification.startsWith("B") ? "的中率だけ上がる買い方。常用は危険。" : c.classification.startsWith("A") ? "有望だが過学習確認必須。" : "1点維持またはNO BUY優先。";
    lines.push(`| ${c.strategy} | ${c.classification} | ${pct(c.hitRate)} | ${pct(c.roi / 100)} | ${comment} |`);
  }
  lines.push("");

  lines.push("## 4. 惜しい外れ分析");
  lines.push("| 分類 | n | 比率 | 示唆 |");
  lines.push("|---|---:|---:|---|");
  const missTotal = report.missAnalysis.totalMisses || 1;
  const missRows: Array<[string, number, string]> = [
    ["頭は合っていた", report.missAnalysis.headMatched, "1着固定流しの検証価値"],
    ["1着2着は合っていたが3着違い", report.missAnalysis.firstSecondMatchedThirdMiss, "1-2-流しの検証価値"],
    ["1着3着は合っていたが2着違い", report.missAnalysis.firstThirdMatchedSecondMiss, "1着3着固定・2着流しの検証価値"],
    ["2着3着が逆だった", report.missAnalysis.secondThirdReversed, "2着3着逆転保険の検証価値"],
    ["selectionの3艇は全部入っていたが順番違い", report.missAnalysis.top3AllInOrderDifferent, "3艇BOXの検証価値"],
    ["完全に違った", report.missAnalysis.completelyDifferent, "買い方拡張よりNO BUY優先"],
  ];
  for (const [label, n, comment] of missRows) lines.push(`| ${label} | ${n} | ${pct(n / missTotal)} | ${comment} |`);
  lines.push("");

  lines.push("## 5. 会場別おすすめstrategy");
  lines.push(bestTable("venue", report.venueBest));
  lines.push("## 6. odds帯別おすすめstrategy");
  lines.push(bestTable("odds帯", report.oddsBandBest));
  lines.push("### raceNo別");
  lines.push(bestTable("raceNo", report.raceNoBest));
  lines.push("### selection頭別");
  lines.push(bestTable("頭", report.headBest));
  lines.push("### データ有無・水面別");
  lines.push(bestTable("天候", report.weatherBest));
  lines.push(bestTable("展示", report.exhibitionBest));
  lines.push(bestTable("F", report.fBest));
  lines.push(bestTable("風速", report.windBest));
  lines.push(bestTable("波高", report.waveBest));

  lines.push("## 8. motor_boat_statsと買い方");
  lines.push("### motor帯別おすすめstrategy");
  lines.push(bestTable("motor", report.motorBest));
  lines.push("### boat帯別おすすめstrategy");
  lines.push(bestTable("boat", report.boatBest));
  lines.push("| motor_condition | strategy | n | hit_rate | avg_odds | ROI | 欠損率 | コメント |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---|");
  for (const row of report.motorStrategy) {
    lines.push(`| ${row.condition} | ${row.strategy} | ${row.races} | ${pct(row.hitRate)} | ${num(row.avgTicketOdds)} | ${pct(row.roi / 100)} | ${pct(row.missingRate)} | ${row.comment} |`);
  }
  lines.push("");

  lines.push("## 9. 流しが有効な条件");
  lines.push(bestTable("条件", report.flowConditions));
  lines.push("## 10. BOXが有効な条件");
  lines.push(bestTable("条件", report.boxConditions));

  lines.push("## 11. やらない方がいい買い方");
  lines.push("- 常時 `top3_box` / `top4_box`: 的中率は上がりやすいが、点数増でROIが落ちる場合は危険。");
  lines.push("- odds欠損率が高いstrategy: 結果オッズを取れたticketだけの参考値になる。");
  lines.push("- `first_fixed_second_third_flow` の常用: 最大20点で、的中率上昇より投資増が勝ちやすい。");
  lines.push("- 高配当1発で最大1hit除外ROIが崩れる条件: 偽edge疑い。", "");

  lines.push("## 12. 過学習リスク");
  lines.push("| strategy | train ROI | validation ROI | test ROI | 月別安定性 | 判定 |");
  lines.push("|---|---:|---:|---:|---|---|");
  for (const row of report.splitValidation) {
    lines.push(`| ${row.strategy} | ${pct(row.trainRoi / 100)} | ${pct(row.validationRoi / 100)} | ${pct(row.testRoi / 100)} | ${row.monthlyStability} | ${row.judgement} |`);
  }
  lines.push("");

  lines.push("## 13. 次に実装するならこの順番");
  lines.push("1. 本番変更ではなく、paper検証で `second_third_reverse` と `first_second_third_flow` を比較する。");
  lines.push("2. `1着2着は合っていて3着違い` が多い会場だけ `1-2-流し` を検証する。");
  lines.push("3. `selectionの3艇は全部入っていたが順番違い` が多い条件だけ `top3_box` を検証する。");
  lines.push("4. 常時BOX/常時20点流しは避け、NO BUY条件とセットで検証する。");
  lines.push("5. odds鮮度と欠損率をstrategy評価に加え、締切直前oddsで再評価する。", "");

  lines.push("## 14. 中学生でも分かる説明");
  lines.push("1点買いは、当たると大きいけれど外れやすい作戦です。流しやBOXは当たりやすくなりますが、買う点数が増えるので、お金もたくさん使います。だから「当たる回数が増えた」だけでは良くなくて、「増えた投資より回収が増えたか」を見ます。今回の分析は、どんな時だけ広げる価値があるか、逆に広げても損しやすいかを調べるものです。", "");

  lines.push("## 追加提案");
  lines.push("| 優先度 | 提案 | 理由 | 期待効果 | リスク | 今回やる/次回やる |");
  lines.push("|---|---|---|---|---|---|");
  for (const s of report.additionalSuggestions) lines.push(`| ${s.priority} | ${s.proposal} | ${s.reason} | ${s.effect} | ${s.risk} | ${s.when} |`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function bestTable(label: string, rows: GroupBest[]) {
  const lines = [`| ${label} | best_strategy | original ROI | best ROI | n | コメント |`, "|---|---|---:|---:|---:|---|"];
  for (const row of rows.slice(0, 24)) lines.push(`| ${row.key} | ${row.bestStrategy} | ${pct(row.originalRoi / 100)} | ${pct(row.bestRoi / 100)} | ${row.n} | ${row.comment} |`);
  lines.push("");
  return lines.join("\n");
}

function additionalSuggestions() {
  return [
    { priority: "S", proposal: "流し/BOXの前にNO BUY条件を重ねる", reason: "点数を増やすと投資が増える", effect: "不要BUY削減とstrategy改善を両立", risk: "削りすぎ", when: "今回レポートで提案、実装は次回paper" },
    { priority: "S", proposal: "odds鮮度をstrategy評価に入れる", reason: "仮想ticketのoddsが古いとROIが歪む", effect: "偽edge削減", risk: "時系列欠損", when: "次回やる" },
    { priority: "A", proposal: "2着3着逆転専用の条件付き保険", reason: "常時保険はROIを落としやすい", effect: "惜しい外れだけ拾う", risk: "過学習", when: "次回やる" },
    { priority: "A", proposal: "会場別にstrategyを分ける", reason: "流しが効く水面と効かない水面が違う", effect: "汎用ルールの粗さを減らす", risk: "n不足", when: "次回やる" },
    { priority: "B", proposal: "人気順/1-2-3固定ベースライン比較", reason: "モデルstrategyが単純ベースラインに勝つ必要がある", effect: "モデル価値の確認", risk: "odds取得範囲依存", when: "次回やる" },
    { priority: "B", proposal: "UIに買わない理由とstrategy非採用理由を表示", reason: "BUYが購入指示に見える誤解を避ける", effect: "安全性と説明性向上", risk: "UI文言調整", when: "次回やる" },
    { priority: "C", proposal: "選手役割で展開シナリオを保存", reason: "強さより逃げ/差し/まくりの噛み合わせが重要", effect: "BOX条件の精度向上", risk: "分類過学習", when: "次回以降" },
  ];
}

function parseSelection(value: string) {
  return value.split("-").map((v) => Number(v)).filter((n) => Number.isInteger(n));
}

function joinSelection(nums: number[]) {
  return nums.join("-");
}

function permutations(nums: number[]): number[][] {
  if (nums.length <= 1) return [nums];
  const out: number[][] = [];
  for (let i = 0; i < nums.length; i += 1) {
    const head = nums[i];
    const rest = [...nums.slice(0, i), ...nums.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  }
  return out;
}

function permutationsK(nums: number[], k: number): number[][] {
  if (k <= 0) return [[]];
  const out: number[][] = [];
  for (let i = 0; i < nums.length; i += 1) {
    const head = nums[i];
    const rest = [...nums.slice(0, i), ...nums.slice(i + 1)];
    for (const tail of permutationsK(rest, k - 1)) out.push([head, ...tail]);
  }
  return out;
}

function nextBoat(row: BaseRow) {
  const used = new Set(row.selectionNums);
  const ranked = [...row.context.exhibitionRankByBoat.entries()]
    .filter(([boat]) => !used.has(boat))
    .sort((a, b) => a[1] - b[1]);
  if (ranked[0]) return ranked[0][0];
  return [1, 2, 3, 4, 5, 6].find((boat) => !used.has(boat)) ?? null;
}

function oddsBand(odds: number) {
  if (odds < 3) return "odds < 3";
  if (odds < 5) return "3 <= odds < 5";
  if (odds < 10) return "5 <= odds < 10";
  if (odds < 20) return "10 <= odds < 20";
  if (odds < 30) return "20 <= odds < 30";
  if (odds < 50) return "30 <= odds < 50";
  return "odds >= 50";
}

function headBand(head: number) {
  if (head === 1) return "1号艇頭";
  if (head === 2) return "2号艇頭";
  if (head === 3) return "3号艇頭";
  return "4号艇以降頭";
}

function windBand(wind: number | null) {
  if (wind == null) return "風速なし";
  if (wind < 3) return "wind < 3";
  if (wind < 5) return "3 <= wind < 5";
  if (wind < 8) return "5 <= wind < 8";
  return "wind >= 8";
}

function waveBand(wave: number | null) {
  if (wave == null) return "波高なし";
  if (wave < 3) return "wave < 3";
  if (wave < 5) return "3 <= wave < 5";
  return "wave >= 5";
}

function motorBand(value: number | null) {
  if (value == null) return "venueMotorTop2Rateなし";
  if (value < 25) return "venueMotorTop2Rate < 25";
  if (value < 35) return "25 <= venueMotorTop2Rate < 35";
  if (value < 50) return "35 <= venueMotorTop2Rate < 50";
  return "venueMotorTop2Rate >= 50";
}

function boatBand(value: number | null) {
  if (value == null) return "venueBoatTop2Rateなし";
  if (value < 25) return "venueBoatTop2Rate < 25";
  if (value < 35) return "25 <= venueBoatTop2Rate < 35";
  if (value < 50) return "35 <= venueBoatTop2Rate < 50";
  return "venueBoatTop2Rate >= 50";
}

function emptyContext(): RaceContext {
  return {
    weatherPresent: false,
    exhibitionPresent: false,
    fPresent: false,
    windMps: null,
    waveCm: null,
    exhibitionRankByBoat: new Map(),
  };
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique<T>(values: T[]) {
  return [...new Set(values)].filter((v) => v != null);
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function pct(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function num(value: number) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function yen(value: number) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return value;
}
