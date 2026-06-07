import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-hypothesis-sets.md";
const OUT_JSON = "reports/roi-hypothesis-sets.json";
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
  head: number;
  hit: boolean;
  venueMotorTop2Rate: number | null;
  venueBoatTop2Rate: number | null;
  nationalMotorTop2Rate: number | null;
  nationalBoatTop2Rate: number | null;
};

type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  avgOdds: number;
  stakeYen: number;
  returnYen: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

type Scenario = {
  name: string;
  intent: string;
  keep: (row: Row) => boolean;
};

if (!existsSync(DB_PATH)) {
  console.error(`[analyze-roi-hypothesis-sets] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");

  const rows = loadRows().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const baseline = metric(rows);
  const scenarios = buildScenarios();
  const results = scenarios.map((scenario) => evaluateScenario(rows, scenario, baseline));

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    safety: { readOnly: true, queryOnly: true, writesDb: false, changesSettings: false },
    baseline,
    results: results.sort((a, b) => b.remaining.roi - a.remaining.roi),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMd(report));
  console.log(`[analyze-roi-hypothesis-sets] baseline n=${baseline.n} roi=${pct(baseline.roi)}`);
  console.log(`[analyze-roi-hypothesis-sets] wrote ${OUT_MD}`);
  console.log(`[analyze-roi-hypothesis-sets] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function loadRows(): Row[] {
  const base = db.prepare(`
    SELECT dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.result,
           dh.current_odds, op.raw_json
    FROM decision_history dh
    LEFT JOIN official_programs op ON op.race_id = dh.race_id
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Array<Record<string, unknown>>;
  const venueMb = loadVenueMotorBoat();
  return base.map((row) => {
    const selection = String(row.selection);
    const head = Number(selection.split("-")[0]);
    const key = `${String(row.race_id)}:${head}`;
    const venue = venueMb.get(key) ?? { motor: null, boat: null };
    const national = extractNational(row.raw_json, head);
    return {
      id: Number(row.id),
      raceId: String(row.race_id),
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result: String(row.result),
      currentOdds: Number(row.current_odds),
      head,
      hit: String(row.result) === selection,
      venueMotorTop2Rate: venue.motor,
      venueBoatTop2Rate: venue.boat,
      nationalMotorTop2Rate: national.motor,
      nationalBoatTop2Rate: national.boat,
    };
  });
}

function buildScenarios(): Scenario[] {
  const weakVenues = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
  const widerWeakVenues = ["戸田", "多摩川", "桐生", "三国", "江戸川", "住之江", "徳山", "福岡"];
  const strongVenues = ["児島", "芦屋", "常滑", "びわこ", "平和島", "津"];
  const goodRaceNos = [3, 6, 7, 9];

  return [
    {
      name: "A_安全削減: 10R以降 + 高venueMotorを除外",
      intent: "後半レースと高モーター人気過剰を避ける。F情報はこの簡易版では未使用。",
      keep: (r) => r.raceNo < 10 && !isHighVenueMotor(r),
    },
    {
      name: "B_弱会場削減: 弱5会場 + 10R以降 + 高venueMotorを除外",
      intent: "既存レポートで弱い会場も除外する強めの守り。",
      keep: (r) => !weakVenues.includes(r.venue) && r.raceNo < 10 && !isHighVenueMotor(r),
    },
    {
      name: "B2_弱会場広め削減: 弱8会場 + 10R以降 + 高venueMotorを除外",
      intent: "弱会場を広く見る。過学習リスク高め。",
      keep: (r) => !widerWeakVenues.includes(r.venue) && r.raceNo < 10 && !isHighVenueMotor(r),
    },
    {
      name: "C_攻め会場限定: 強会場 + 3/6/7/9R + 高venueMotor除外",
      intent: "強い会場と良績raceNoだけ残す。母数減少に注意。",
      keep: (r) => strongVenues.includes(r.venue) && goodRaceNos.includes(r.raceNo) && !isHighVenueMotor(r),
    },
    {
      name: "D_低ボート逆張り: venueBoat<25 + 3/6/7/9R + 弱5会場除外",
      intent: "市場が嫌った低ボート成績を、良い条件だけで残す。",
      keep: (r) => isLowVenueBoat(r) && goodRaceNos.includes(r.raceNo) && !weakVenues.includes(r.venue) && !isHighVenueMotor(r),
    },
    {
      name: "E_高オッズ悪条件除外: odds>=50は弱会場/後半/高motorだけ除外",
      intent: "高オッズを全切りせず、悪条件の高オッズだけ避ける。",
      keep: (r) => !(r.currentOdds >= 50 && (weakVenues.includes(r.venue) || r.raceNo >= 10 || isHighVenueMotor(r))),
    },
    {
      name: "F_9R優遇: 9Rは残し、他は強会場3/6/7R中心",
      intent: "9Rの良績を別扱いする。",
      keep: (r) => (r.raceNo === 9 && !weakVenues.includes(r.venue) && !isHighVenueMotor(r)) || (strongVenues.includes(r.venue) && [3, 6, 7].includes(r.raceNo) && !isHighVenueMotor(r)),
    },
    {
      name: "G_1-2-3限定改善: 1-2-3は強会場/良raceNo/高motor除外だけ残す",
      intent: "大半を占める1-2-3の質を上げる。",
      keep: (r) => r.selection === "1-2-3" && strongVenues.includes(r.venue) && goodRaceNos.includes(r.raceNo) && !isHighVenueMotor(r),
    },
  ];
}

function evaluateScenario(rows: Row[], scenario: Scenario, baseline: Metric) {
  const remainingRows = rows.filter(scenario.keep);
  const removedRows = rows.filter((row) => !scenario.keep(row));
  const remaining = metric(remainingRows);
  const removed = metric(removedRows);
  const split = splitMetric(rows, scenario.keep);
  const warnings: string[] = [];
  if (remaining.n < 100) warnings.push("残りnがかなり少ない");
  if (remaining.n < 300) warnings.push("残りnが少ない");
  if (remaining.roiExMaxHit <= baseline.roiExMaxHit) warnings.push("最大1hit除外で改善が弱い");
  if (split.validation.roi < baseline.roi - 0.05) warnings.push("validationが弱い");
  if (split.test.roi < baseline.roi - 0.05) warnings.push("testが弱い");
  return {
    name: scenario.name,
    intent: scenario.intent,
    removed,
    remaining,
    improvement: remaining.roi - baseline.roi,
    split,
    warnings,
  };
}

function metric(rows: Row[]): Metric {
  const hits = rows.filter((row) => row.hit);
  const hitOdds = hits.map((row) => row.currentOdds).sort((a, b) => b - a);
  const returnYen = hitOdds.reduce((sum, odds) => sum + odds * STAKE_YEN, 0);
  const stakeYen = rows.length * STAKE_YEN;
  const maxHitOdds = hitOdds[0] ?? 0;
  return {
    n: rows.length,
    hits: hits.length,
    hitRate: rows.length ? hits.length / rows.length : 0,
    avgOdds: rows.length ? rows.reduce((sum, row) => sum + row.currentOdds, 0) / rows.length : 0,
    stakeYen,
    returnYen,
    roi: stakeYen ? returnYen / stakeYen : 0,
    maxHitOdds,
    roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHitOdds * STAKE_YEN) / stakeYen : 0,
  };
}

function splitMetric(rows: Row[], keep: (row: Row) => boolean) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const validationEnd = Math.floor(sorted.length * 0.9);
  return {
    train: metric(sorted.slice(0, trainEnd).filter(keep)),
    validation: metric(sorted.slice(trainEnd, validationEnd).filter(keep)),
    test: metric(sorted.slice(validationEnd).filter(keep)),
  };
}

function renderMd(report: { generatedAt: string; dbPath: string; baseline: Metric; results: Array<ReturnType<typeof evaluateScenario>> }) {
  return `# ROI Hypothesis Sets\n\nGenerated: ${report.generatedAt}\nDB: \`${report.dbPath}\`\n\n## Baseline\n\n| n | hits | hitRate | avgOdds | ROI | roiExMaxHit |\n|---:|---:|---:|---:|---:|---:|\n| ${report.baseline.n} | ${report.baseline.hits} | ${pct(report.baseline.hitRate)} | ${fixed(report.baseline.avgOdds)} | ${pct(report.baseline.roi)} | ${pct(report.baseline.roiExMaxHit)} |\n\n## Scenario Ranking\n\n| scenario | remainN | remainROI | improvement | removedN | removedROI | train | validation | test | roiExMaxHit | warnings |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${report.results.map((r) => `| ${md(r.name)} | ${r.remaining.n} | ${pct(r.remaining.roi)} | ${pct(r.improvement)} | ${r.removed.n} | ${pct(r.removed.roi)} | ${pct(r.split.train.roi)} | ${pct(r.split.validation.roi)} | ${pct(r.split.test.roi)} | ${pct(r.remaining.roiExMaxHit)} | ${md(r.warnings.join(", ") || "-")} |`).join("\n")}\n\n## Notes\n\n- This is a read-only historical audit.\n- High ROI with tiny remainN is not enough. Validation/test and roiExMaxHit must survive.\n- F-count based scenarios are handled in search-roi-patterns when racer profile coverage is available.\n`;
}

function loadVenueMotorBoat() {
  const map = new Map<string, { motor: number | null; boat: number | null }>();
  if (!tableExists("motor_boat_stats")) return map;
  const rows = db.prepare("SELECT race_id, course, motor_top2_rate, boat_top2_rate FROM motor_boat_stats").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    map.set(`${String(row.race_id)}:${Number(row.course)}`, {
      motor: numOrNull(row.motor_top2_rate),
      boat: numOrNull(row.boat_top2_rate),
    });
  }
  return map;
}

function extractNational(rawJson: unknown, course: number) {
  if (typeof rawJson !== "string") return { motor: null, boat: null };
  try {
    const parsed = JSON.parse(rawJson) as { boats?: Array<Record<string, unknown>> };
    const boat = parsed.boats?.find((b) => Number(b.course) === course);
    return { motor: numOrNull(boat?.motorTop2Rate), boat: numOrNull(boat?.boatTop2Rate) };
  } catch {
    return { motor: null, boat: null };
  }
}

function isHighVenueMotor(row: Row) { return (row.venueMotorTop2Rate ?? -1) >= 50; }
function isLowVenueBoat(row: Row) { return row.venueBoatTop2Rate != null && row.venueBoatTop2Rate < 25; }
function tableExists(name: string) { return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as { name?: string } | undefined)?.name); }
function numOrNull(value: unknown): number | null { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function fixed(value: number) { return value.toFixed(3); }
function md(value: string) { return value.replaceAll("|", "\\|"); }
