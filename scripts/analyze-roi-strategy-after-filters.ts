import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-strategy-after-filters.md";
const OUT_JSON = "reports/roi-strategy-after-filters.json";
const STAKE_YEN = 100;

type Row = {
  id: number;
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string;
  currentOdds: number;
  payoutYen: number;
  marketSettled: boolean;
  venueMotorTop2Rate: number | null;
  venueBoatTop2Rate: number | null;
};

type FilterSet = {
  name: string;
  keep: (row: Row) => boolean;
};

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  stakeYen: number;
  returnYen: number;
  roi: number;
  roiExMaxHit: number;
  avgOdds: number;
};

type StrategyResult = {
  filter: string;
  strategy: string;
  metric: Metric;
  avgTicketsPerRace: number;
  warnings: string[];
};

type TicketOutcome = {
  originalOdds: number;
  hit: boolean;
  payoutYen: number;
};

if (!existsSync(DB_PATH)) {
  console.error("[analyze-roi-strategy-after-filters] primary DB missing");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "ROI_STRATEGY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");
  const rows = loadRows();
  if (rows.length === 0) throw new Error("ROI_STRATEGY_POPULATION_EMPTY");
  const missingSettlement = rows.filter((row) => !row.marketSettled).length;
  const missingWinningPayout = rows.filter((row) => !(row.payoutYen > 0)).length;
  if (missingSettlement !== 0 || missingWinningPayout !== 0) {
    throw new Error(`ROI_STRATEGY_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify({ rows: rows.length, missingSettlement, missingWinningPayout })}`);
  }

  const filters = buildFilters();
  const results: StrategyResult[] = [];

  for (const filter of filters) {
    const kept = rows.filter(filter.keep);
    results.push(evalStrategy(filter.name, "original", kept, (row) => [row.selection]));
    results.push(evalStrategy(filter.name, "second_third_reverse", kept, reverse23));
    results.push(evalStrategy(filter.name, "top3_box", kept, top3Box));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dbIdentity: "verified-canonical-research-db",
    roiBasis: "official-race-payouts",
    baseline: metric(rows.map((row) => ({ originalOdds: row.currentOdds, hit: row.result === row.selection, payoutYen: row.payoutYen }))),
    results: results.sort((a, b) => b.metric.roi - a.metric.roi),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMd(report));
  console.log(`[analyze-roi-strategy-after-filters] wrote ${OUT_MD}`);
  console.log(`[analyze-roi-strategy-after-filters] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function loadRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.id,
      dh.race_id AS raceId,
      dh.date,
      dh.venue,
      dh.race_no,
      dh.selection,
      dh.result,
      dh.current_odds,
      CASE WHEN EXISTS (
        SELECT 1
        FROM race_payouts settled
        WHERE settled.race_id = dh.race_id
          AND settled.bet_type = dh.bet_type
          AND settled.returned = 0
          AND settled.payout_yen > 0
      ) THEN 1 ELSE 0 END AS market_settled,
      (
        SELECT rp.payout_yen
        FROM race_payouts rp
        WHERE rp.race_id = dh.race_id
          AND rp.bet_type = dh.bet_type
          AND rp.combination = dh.result
          AND rp.returned = 0
          AND rp.payout_yen > 0
        LIMIT 1
      ) AS winning_payout_yen
    FROM decision_history dh
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Array<Record<string, unknown>>;
  const mb = loadMotorBoat();
  return raw.map((row) => {
    const selection = String(row.selection);
    const head = Number(selection.split("-")[0]);
    const raceId = String(row.raceId);
    const rates = mb.get(`${raceId}:${head}`) ?? { motor: null, boat: null };
    return {
      id: Number(row.id),
      raceId,
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result: String(row.result),
      currentOdds: Number(row.current_odds),
      payoutYen: Number(row.winning_payout_yen ?? 0),
      marketSettled: Number(row.market_settled) === 1,
      venueMotorTop2Rate: rates.motor,
      venueBoatTop2Rate: rates.boat,
    };
  });
}

function loadMotorBoat() {
  const map = new Map<string, { motor: number | null; boat: number | null }>();
  if (!tableExists("motor_boat_stats")) return map;
  const rows = db.prepare("SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    map.set(`${String(row.race_id)}:${Number(row.course)}`, {
      motor: num(row.motor_top2_rate),
      boat: num(row.boat_top2_rate),
    });
  }
  return map;
}

function buildFilters(): FilterSet[] {
  const weak = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
  const strong = ["児島", "芦屋", "常滑", "びわこ", "平和島", "津"];
  const goodRace = [3, 6, 7, 9];
  return [
    { name: "all", keep: () => true },
    { name: "no_10plus_no_high_motor", keep: (r) => r.raceNo < 10 && !highMotor(r) },
    { name: "no_weak_no_10plus_no_high_motor", keep: (r) => !weak.includes(r.venue) && r.raceNo < 10 && !highMotor(r) },
    { name: "strong_good_race_no_high_motor", keep: (r) => strong.includes(r.venue) && goodRace.includes(r.raceNo) && !highMotor(r) },
    { name: "low_boat_good_race_no_weak_no_high_motor", keep: (r) => lowBoat(r) && goodRace.includes(r.raceNo) && !weak.includes(r.venue) && !highMotor(r) },
    { name: "odds50_bad_context_removed", keep: (r) => !(r.currentOdds >= 50 && (weak.includes(r.venue) || r.raceNo >= 10 || highMotor(r))) },
  ];
}

function evalStrategy(filter: string, strategy: string, rows: Row[], tickets: (row: Row) => string[]): StrategyResult {
  const ticketOutcomes: TicketOutcome[] = [];
  for (const row of rows) {
    for (const ticket of tickets(row)) {
      ticketOutcomes.push({ originalOdds: row.currentOdds, hit: row.result === ticket, payoutYen: row.payoutYen });
    }
  }
  const m = metric(ticketOutcomes);
  const warnings: string[] = [];
  if (rows.length < 100) warnings.push("race n small");
  if (ticketOutcomes.length > rows.length * 3) warnings.push("ticket expansion high");
  if (m.roiExMaxHit < m.roi - 0.08) warnings.push("single large hit sensitive");
  return { filter, strategy, metric: m, avgTicketsPerRace: rows.length ? ticketOutcomes.length / rows.length : 0, warnings };
}

function reverse23(row: Row) {
  const parts = row.selection.split("-");
  if (parts.length !== 3) return [row.selection];
  return [row.selection, `${parts[0]}-${parts[2]}-${parts[1]}`];
}

function top3Box(row: Row) {
  const parts = row.selection.split("-");
  if (parts.length !== 3) return [row.selection];
  return permutations(parts).map((p) => p.join("-"));
}

function permutations(parts: string[]) {
  return [
    [parts[0], parts[1], parts[2]],
    [parts[0], parts[2], parts[1]],
    [parts[1], parts[0], parts[2]],
    [parts[1], parts[2], parts[0]],
    [parts[2], parts[0], parts[1]],
    [parts[2], parts[1], parts[0]],
  ];
}

function metric(items: TicketOutcome[]): Metric {
  const hitReturns = items.filter((item) => item.hit).map((item) => item.payoutYen).sort((a, b) => b - a);
  const stakeYen = items.length * STAKE_YEN;
  const returnYen = hitReturns.reduce((sum, payoutYen) => sum + payoutYen, 0);
  const maxHitReturn = hitReturns[0] ?? 0;
  return {
    n: items.length,
    hits: hitReturns.length,
    hitRate: items.length ? hitReturns.length / items.length : 0,
    stakeYen,
    returnYen,
    roi: stakeYen ? returnYen / stakeYen : 0,
    roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHitReturn) / stakeYen : 0,
    avgOdds: items.length ? items.reduce((sum, item) => sum + item.originalOdds, 0) / items.length : 0,
  };
}

function renderMd(report: { generatedAt: string; dbIdentity: string; roiBasis: string; baseline: Metric; results: StrategyResult[] }) {
  return `# ROI Strategy After Filters\n\nGenerated: ${report.generatedAt}\nDB identity: \`${report.dbIdentity}\`\nROI basis: \`${report.roiBasis}\`\n\n## Baseline\n\n| n | hits | hitRate | ROI | roiExMaxHit |\n|---:|---:|---:|---:|---:|\n| ${report.baseline.n} | ${report.baseline.hits} | ${pct(report.baseline.hitRate)} | ${pct(report.baseline.roi)} | ${pct(report.baseline.roiExMaxHit)} |\n\n## Ranking\n\n| filter | strategy | tickets | hitRate | ROI | roiExMaxHit | avgTicketsPerRace | warnings |\n|---|---|---:|---:|---:|---:|---:|---|\n${report.results.map((r) => `| ${md(r.filter)} | ${md(r.strategy)} | ${r.metric.n} | ${pct(r.metric.hitRate)} | ${pct(r.metric.roi)} | ${pct(r.metric.roiExMaxHit)} | ${r.avgTicketsPerRace.toFixed(2)} | ${md(r.warnings.join(", ") || "-")} |`).join("\n")}\n`;
}

function highMotor(row: Row) { return (row.venueMotorTop2Rate ?? -1) >= 50; }
function lowBoat(row: Row) { return row.venueBoatTop2Rate != null && row.venueBoatTop2Rate < 25; }
function tableExists(name: string) { return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as { name?: string } | undefined)?.name); }
function num(value: unknown): number | null { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
