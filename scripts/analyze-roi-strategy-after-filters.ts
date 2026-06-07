import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-strategy-after-filters.md";
const OUT_JSON = "reports/roi-strategy-after-filters.json";
const STAKE_YEN = 100;

type Row = {
  id: number;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string;
  currentOdds: number;
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

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-roi-strategy-after-filters] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");
  const rows = loadRows();
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
    dbPath: DB_PATH,
    baseline: metric(rows.map((row) => ({ odds: row.currentOdds, hit: row.result === row.selection }))),
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
    SELECT dh.id, dh.date, dh.venue, dh.race_no, dh.selection, dh.result, dh.current_odds
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
    const key = `${String(row.id)}:${head}`;
    const byRaceKey = `${String((row as any).race_id)}:${head}`;
    const rates = mb.get(byRaceKey) ?? mb.get(key) ?? { motor: null, boat: null };
    return {
      id: Number(row.id),
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result: String(row.result),
      currentOdds: Number(row.current_odds),
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
  const ticketOutcomes: Array<{ odds: number; hit: boolean }> = [];
  for (const row of rows) {
    for (const ticket of tickets(row)) {
      ticketOutcomes.push({ odds: row.currentOdds, hit: row.result === ticket });
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

function metric(items: Array<{ odds: number; hit: boolean }>): Metric {
  const hits = items.filter((item) => item.hit).map((item) => item.odds).sort((a, b) => b - a);
  const stakeYen = items.length * STAKE_YEN;
  const returnYen = hits.reduce((sum, odds) => sum + odds * STAKE_YEN, 0);
  const maxHit = hits[0] ?? 0;
  return {
    n: items.length,
    hits: hits.length,
    hitRate: items.length ? hits.length / items.length : 0,
    stakeYen,
    returnYen,
    roi: stakeYen ? returnYen / stakeYen : 0,
    roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHit * STAKE_YEN) / stakeYen : 0,
    avgOdds: items.length ? items.reduce((sum, item) => sum + item.odds, 0) / items.length : 0,
  };
}

function renderMd(report: { generatedAt: string; dbPath: string; baseline: Metric; results: StrategyResult[] }) {
  return `# ROI Strategy After Filters\n\nGenerated: ${report.generatedAt}\nDB: \`${report.dbPath}\`\n\n## Baseline\n\n| n | hits | hitRate | ROI | roiExMaxHit |\n|---:|---:|---:|---:|---:|\n| ${report.baseline.n} | ${report.baseline.hits} | ${pct(report.baseline.hitRate)} | ${pct(report.baseline.roi)} | ${pct(report.baseline.roiExMaxHit)} |\n\n## Ranking\n\n| filter | strategy | tickets | hitRate | ROI | roiExMaxHit | avgTicketsPerRace | warnings |\n|---|---|---:|---:|---:|---:|---:|---|\n${report.results.map((r) => `| ${md(r.filter)} | ${md(r.strategy)} | ${r.metric.n} | ${pct(r.metric.hitRate)} | ${pct(r.metric.roi)} | ${pct(r.metric.roiExMaxHit)} | ${r.avgTicketsPerRace.toFixed(2)} | ${md(r.warnings.join(", ") || "-")} |`).join("\n")}\n`;
}

function highMotor(row: Row) { return (row.venueMotorTop2Rate ?? -1) >= 50; }
function lowBoat(row: Row) { return row.venueBoatTop2Rate != null && row.venueBoatTop2Rate < 25; }
function tableExists(name: string) { return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as { name?: string } | undefined)?.name); }
function num(value: unknown): number | null { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
