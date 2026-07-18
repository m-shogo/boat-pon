/**
 * 正しい買い目別オッズとモデルtop-1を使うread-only shadow backtest。
 * DB/app_settings/production decisionは変更しない。
 */
import { DatabaseSync } from "node:sqlite";
import {
  getSettings,
  listAllOddsBySelection,
  listProgramInputsRange,
  listResultsForModelRange,
} from "../server/db";
import { selectBestPaperDecisionPerRace, selectTopModelCandidatePerRace } from "../src/domain/candidateSelection";
import { judgeCandidate } from "../src/domain/decision";
import { DEFAULT_MODEL_ALPHA, buildCandidatesFromModel, buildVenueModel, type ModelCandidateInput } from "../src/domain/model";
import { normalizeMarketResidual, selectBlendedMarketCandidate } from "../src/domain/marketResidual";
import { filterComparableResultsForDate } from "../src/domain/raceRegime";
import { summarizeShadowTop1, type ShadowTop1Row, type ShadowTop1Summary } from "../src/domain/shadowTop1";
import type { BetCandidate, BudgetRule } from "../src/domain/types";

const MARKET_VARIANTS = [
  { id: "market-only-rank", modelWeight: 0, minEv: 0 },
  { id: "blend10-rank", modelWeight: 0.10, minEv: 0 },
  { id: "blend25-rank", modelWeight: 0.25, minEv: 0 },
  { id: "blend50-rank", modelWeight: 0.50, minEv: 0 },
  { id: "model-only-rank", modelWeight: 1, minEv: 0 },
  { id: "blend10-edge100", modelWeight: 0.10, minEv: 1 },
  { id: "blend25-edge100", modelWeight: 0.25, minEv: 1 },
  { id: "blend50-edge100", modelWeight: 0.50, minEv: 1 },
  { id: "model-only-edge100", modelWeight: 1, minEv: 1 },
] as const;

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync("data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

try {
  const startedAt = new Date();
  const settings = getSettings(db);
  const programs = listProgramInputsRange(db, args.from, args.to, args.limit, "historical-readonly");
  const results = listResultsForModelRange(db, addDays(args.from, -args.trainDays), args.to);
  const resultByRace = new Map(results.map((row) => [row.raceId, row]));
  const oddsBySelection = args.oddsSource === "t5"
    ? loadCheckpointOdds(db, args.from, args.to, "T-5")
    : listAllOddsBySelection(db);
  const programsByDate = groupProgramsByDate(programs);
  const rows: ShadowTop1Row[] = [];
  const edgeRows: Array<{ row: Omit<ShadowTop1Row, "decision">; modelEv: number; odds: number }> = [];
  const marketRows = new Map(MARKET_VARIANTS.map((variant) => [variant.id, [] as ShadowTop1Row[]]));
  let fullMarketRaces = 0;

  for (const [date, datePrograms] of [...programsByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const trainFrom = addDays(date, -args.trainDays);
    const trainResults = filterComparableResultsForDate(
      results.filter((row) => row.date < date && row.date >= trainFrom),
      date,
    );
    const model = buildVenueModel(trainResults, args.minTrainRaceCount, args.alpha);
    const candidates = buildCandidatesFromModel(
      datePrograms,
      model,
      settings.targetEv,
      `${date}T00:00:00+09:00`,
      new Map(),
      oddsBySelection,
    );
    for (const candidate of selectMaxModelEvPerRace(candidates)) {
      const result = resultByRace.get(candidate.raceId);
      edgeRows.push({
        row: {
          raceId: candidate.raceId,
          date: candidate.date,
          selection: candidate.selection.join("-"),
          currentOdds: candidate.currentOdds,
          result: result?.trifecta ?? null,
          payoutYen: result?.payoutYen ?? null,
        },
        modelEv: candidate.estimatedHitRate * (candidate.currentOdds ?? 0),
        odds: candidate.currentOdds ?? 0,
      });
    }
    if (args.marketGrid) {
      for (const raceCandidates of groupCandidatesByRace(candidates).values()) {
        if (raceCandidates.length < 100) continue;
        const normalized = normalizeMarketResidual(raceCandidates.flatMap((candidate) =>
          candidate.currentOdds == null ? [] : [{
            selection: candidate.selection.join("-"),
            odds: candidate.currentOdds,
            modelProbability: candidate.estimatedHitRate,
          }],
        ));
        if (normalized.length < 100) continue;
        fullMarketRaces += 1;
        const exemplar = raceCandidates[0];
        const result = resultByRace.get(exemplar.raceId);
        for (const variant of MARKET_VARIANTS) {
          const selectedMarket = selectBlendedMarketCandidate(normalized, variant.modelWeight);
          if (!selectedMarket) continue;
          marketRows.get(variant.id)!.push({
            raceId: exemplar.raceId,
            date: exemplar.date,
            selection: selectedMarket.selection,
            decision: selectedMarket.blendedEv >= variant.minEv ? "BUY" : "SKIP",
            currentOdds: selectedMarket.odds,
            result: result?.trifecta ?? null,
            payoutYen: result?.payoutYen ?? null,
          });
        }
      }
    }
    const selected = args.selector === "ev"
      ? selectBestPaperDecisionPerRace(candidates.map((candidate) => ({
          candidate,
          decision: judgeCandidate(candidate, settings, {
            now: beforeClose(candidate.date, candidate.closeAt, settings),
            buyCountToday: 0,
            reservedBudgetYen: 0,
          }),
        }))).map((row) => row.candidate)
      : selectTopModelCandidatePerRace(candidates);
    let buyCountToday = 0;
    let reservedBudgetYen = 0;
    for (const candidate of selected) {
      const decision = judgeCandidate(candidate, settings, {
        now: beforeClose(candidate.date, candidate.closeAt, settings),
        buyCountToday,
        reservedBudgetYen,
      });
      if (decision.status === "BUY") {
        buyCountToday += 1;
        reservedBudgetYen += decision.recommendedAmount;
      }
      const result = resultByRace.get(candidate.raceId);
      rows.push({
        raceId: candidate.raceId,
        date: candidate.date,
        selection: candidate.selection.join("-"),
        decision: decision.status,
        currentOdds: candidate.currentOdds,
        result: result?.trifecta ?? null,
        payoutYen: result?.payoutYen ?? null,
      });
    }
  }

  const report: ShadowTop1Report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    window: { from: args.from, to: args.to, trainDays: args.trainDays },
    model: { alpha: args.alpha, minTrainRaceCount: args.minTrainRaceCount, selector: args.selector },
    data: { programs: programs.length, results: results.length, oddsSelections: oddsBySelection.size },
    safety: {
      readOnly: true,
      productionConnected: false,
      dbWrites: false,
      primaryRoi: "race_results.payout_yen",
      oddsTiming: args.oddsSource === "t5" ? "odds_timeseries T-5" : "historical latest snapshot; not T-5 replay",
    },
    summary: summarizeShadowTop1(rows),
    edgeGrid: args.edgeGrid ? buildEdgeGrid(edgeRows) : undefined,
    marketGrid: args.marketGrid ? {
      fullMarketRaces,
      variants: MARKET_VARIANTS.map((variant) => ({
        ...variant,
        summary: summarizeShadowTop1(marketRows.get(variant.id) ?? []),
      })),
    } : undefined,
  };
  if (args.json) console.log(JSON.stringify(report));
  else printReport(report);
} finally {
  db.close();
}

type ShadowTop1Report = {
  generatedAt: string;
  durationMs: number;
  window: { from: string; to: string; trainDays: number };
  model: { alpha: number; minTrainRaceCount: number; selector: "model-score" | "ev" };
  data: { programs: number; results: number; oddsSelections: number };
  safety: {
    readOnly: true; productionConnected: false; dbWrites: false; primaryRoi: string; oddsTiming: string;
  };
  summary: ShadowTop1Summary;
  edgeGrid?: Array<{ id: string; minEv: number; minOdds: number; maxOdds: number; summary: ShadowTop1Summary }>;
  marketGrid?: {
    fullMarketRaces: number;
    variants: Array<{ id: string; modelWeight: number; minEv: number; summary: ShadowTop1Summary }>;
  };
};

function printReport(report: ShadowTop1Report) {
  const summary = report.summary;
  const metric = summary.overall;
  console.log("=== shadow top1 backtest (read-only) ===");
  console.log(`window: ${report.window.from}..${report.window.to}`);
  console.log(`selector: ${report.model.selector}`);
  console.log(`programs: ${report.data.programs} / modeled top1: ${summary.total}`);
  console.log(`decisions: BUY=${summary.buy} WATCH=${summary.watch} SKIP=${summary.skip}`);
  console.log(`settled BUY: ${metric.n} / hits=${metric.hits} / ROI(payout)=${pct(metric.payoutRoi)} / ROI(current odds)=${pct(metric.currentOddsRoi)}`);
  console.log(`ROI ex top1=${pct(metric.payoutRoiExTop1)} / ex top2=${pct(metric.payoutRoiExTop2)}`);
  console.log(`max drawdown=¥${metric.maxDrawdownYen.toLocaleString()} / max loss streak=${metric.maxLossStreak}`);
  for (const year of summary.byYear) {
    console.log(`${year.year}: n=${year.metric.n} ROI=${pct(year.metric.payoutRoi)} exTop2=${pct(year.metric.payoutRoiExTop2)}`);
  }
  if (report.edgeGrid) {
    console.log("\nedge grid (research only):");
    for (const variant of report.edgeGrid) {
      const m = variant.summary.overall;
      console.log(`${variant.id}: n=${m.n} ROI=${pct(m.payoutRoi)} exTop2=${pct(m.payoutRoiExTop2)} DD=¥${m.maxDrawdownYen}`);
    }
  }
  if (report.marketGrid) {
    console.log(`\nmarket residual grid: full-market races=${report.marketGrid.fullMarketRaces}`);
    for (const variant of report.marketGrid.variants) {
      const m = variant.summary.overall;
      console.log(`${variant.id}: n=${m.n} ROI=${pct(m.payoutRoi)} exTop2=${pct(m.payoutRoiExTop2)} DD=¥${m.maxDrawdownYen}`);
    }
  }
}

function selectMaxModelEvPerRace(candidates: ReturnType<typeof buildCandidatesFromModel>) {
  const selected = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (candidate.currentOdds == null) continue;
    const existing = selected.get(candidate.raceId);
    const ev = candidate.estimatedHitRate * candidate.currentOdds;
    const existingEv = existing == null || existing.currentOdds == null
      ? Number.NEGATIVE_INFINITY
      : existing.estimatedHitRate * existing.currentOdds;
    if (existing == null || ev > existingEv || (ev === existingEv && candidate.selection.join("-") < existing.selection.join("-"))) {
      selected.set(candidate.raceId, candidate);
    }
  }
  return [...selected.values()];
}

function groupCandidatesByRace(candidates: BetCandidate[]) {
  const grouped = new Map<string, BetCandidate[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.raceId);
    if (group) group.push(candidate);
    else grouped.set(candidate.raceId, [candidate]);
  }
  return grouped;
}

function buildEdgeGrid(edgeRows: Array<{ row: Omit<ShadowTop1Row, "decision">; modelEv: number; odds: number }>) {
  const variants = [
    { id: "ev100-cap100", minEv: 1.00, minOdds: 0, maxOdds: 100 },
    { id: "ev110-cap100", minEv: 1.10, minOdds: 0, maxOdds: 100 },
    { id: "ev125-cap100", minEv: 1.25, minOdds: 0, maxOdds: 100 },
    { id: "ev150-cap100", minEv: 1.50, minOdds: 0, maxOdds: 100 },
    { id: "ev125-cap50", minEv: 1.25, minOdds: 0, maxOdds: 50 },
    { id: "ev125-odds25to30", minEv: 1.25, minOdds: 25, maxOdds: 30 },
  ];
  return variants.map((variant) => ({
    ...variant,
    summary: summarizeShadowTop1(edgeRows.map(({ row, modelEv, odds }) => ({
      ...row,
      decision: modelEv >= variant.minEv && odds >= variant.minOdds && odds <= variant.maxOdds ? "BUY" : "SKIP",
    }))),
  }));
}

function groupProgramsByDate(programs: ModelCandidateInput[]) {
  const grouped = new Map<string, ModelCandidateInput[]>();
  for (const program of programs) {
    const group = grouped.get(program.date);
    if (group) group.push(program);
    else grouped.set(program.date, [program]);
  }
  return grouped;
}

function pct(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function beforeClose(date: string, closeAt: string, settings: BudgetRule) {
  const [hour, minute] = closeAt.split(":").map(Number);
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setHours(hour, minute, 0, 0);
  return new Date(value.getTime() - (settings.minMinutesBeforeClose + 10) * 60_000);
}

function parseArgs(argv: string[]) {
  const value = (name: string, fallback: string) => {
    const direct = argv.find((item) => item.startsWith(`--${name}=`));
    if (direct) return direct.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] ?? fallback : fallback;
  };
  const numberValue = (name: string, fallback: number) => {
    const parsed = Number(value(name, String(fallback)));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const selectorValue = value("selector", "model-score");
  const selector = selectorValue === "ev" ? "ev" as const : "model-score" as const;
  return {
    from: value("from", "2025-01-01"),
    to: value("to", "2025-12-31"),
    limit: Math.floor(numberValue("limit", 100_000)),
    trainDays: Math.floor(numberValue("train-days", 180)),
    minTrainRaceCount: Math.floor(numberValue("min-train-races", 50)),
    alpha: numberValue("alpha", DEFAULT_MODEL_ALPHA),
    selector,
    edgeGrid: argv.includes("--edge-grid"),
    marketGrid: argv.includes("--market-grid"),
    oddsSource: value("odds-source", "latest") === "t5" ? "t5" as const : "latest" as const,
    json: argv.includes("--json"),
  };
}

function addDays(date: string, delta: number) {
  const value = new Date(`${date}T00:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function loadCheckpointOdds(db: DatabaseSync, from: string, to: string, checkpoint: string) {
  const fromRaceId = from.replaceAll("-", "");
  const toExclusive = addDays(to, 1).replaceAll("-", "");
  const rows = db.prepare(`
    SELECT race_id, selection, odds
    FROM odds_timeseries_snapshots
    WHERE id IN (
      SELECT MAX(id)
      FROM odds_timeseries_snapshots
      WHERE race_id >= ? AND race_id < ? AND checkpoint_label = ?
      GROUP BY race_id, selection
    )
  `).all(fromRaceId, toExclusive, checkpoint) as Array<{ race_id: string; selection: string; odds: number }>;
  return new Map(rows.map((row) => [`${row.race_id}/${row.selection}`, Number(row.odds)]));
}
