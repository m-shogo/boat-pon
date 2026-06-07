import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-pattern-search.md";
const OUT_JSON = "reports/roi-pattern-search.json";
const STAKE_YEN = 100;
const MIN_REMOVED = Number(process.env.ROI_SEARCH_MIN_REMOVED ?? 40);
const MIN_REMAINING = Number(process.env.ROI_SEARCH_MIN_REMAINING ?? 300);

type Row = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string;
  currentOdds: number;
  estimatedHitRate: number | null;
  conservativeHitRate: number | null;
  ev: number | null;
  head: number;
  hit: boolean;
  windMps: number | null;
  waveCm: number | null;
  weatherPresent: boolean;
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

type Rule = {
  label: string;
  family: string;
  risk: string;
  fn: (row: Row) => boolean;
};

type Eval = {
  label: string;
  family: string;
  risk: string;
  judgement: "S" | "A" | "B" | "C" | "D";
  warnings: string[];
  removed: Metric;
  remaining: Metric;
  improvement: number;
  trainRoi: number;
  validationRoi: number;
  testRoi: number;
};

if (!existsSync(DB_PATH)) {
  console.error(`[search-roi-patterns] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");

  const rows = sortRows(loadRows());
  const baseline = metric(rows);
  const baselineSplit = splitMetric(rows, () => true);
  console.log(`[search-roi-patterns] baseline n=${baseline.n} roi=${pct(baseline.roi)}`);

  const singleRules = buildRules(rows);
  const singles = evaluate(rows, singleRules, baseline, baselineSplit);

  const seeds = singles
    .filter((x) => x.removed.n >= MIN_REMOVED && x.remaining.n >= MIN_REMAINING && x.removed.roi < baseline.roi)
    .sort(compareEval)
    .slice(0, 32)
    .map((x) => singleRules.find((r) => r.label === x.label))
    .filter((x): x is Rule => Boolean(x));

  const combos = evaluate(rows, buildCombos(seeds), baseline, baselineSplit);
  const all = [...singles, ...combos].sort(compareEval);

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    safety: { readOnly: true, queryOnly: true, writesDb: false, changesSettings: false },
    baseline,
    baselineSplit,
    counts: {
      rows: rows.length,
      singleRules: singleRules.length,
      singleEvaluations: singles.length,
      comboEvaluations: combos.length,
      total: all.length,
      s: all.filter((x) => x.judgement === "S").length,
      a: all.filter((x) => x.judgement === "A").length,
      d: all.filter((x) => x.judgement === "D").length,
    },
    rankings: {
      stability: all.filter((x) => x.judgement === "S" || x.judgement === "A").slice(0, 40),
      improvement: [...all].sort((a, b) => b.improvement - a.improvement).slice(0, 40),
      noBuyEffect: [...all].sort((a, b) => effect(b, baseline) - effect(a, baseline)).slice(0, 40),
      risky: all.filter((x) => x.judgement === "D" || x.warnings.length >= 2).slice(0, 40),
    },
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMd(report));
  console.log(`[search-roi-patterns] wrote ${OUT_MD}`);
  console.log(`[search-roi-patterns] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function loadRows(): Row[] {
  const base = db.prepare(`
    SELECT dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.result,
           dh.current_odds, dh.estimated_hit_rate, dh.conservative_hit_rate, dh.ev,
           rw.wind_speed_mps, rw.wave_height_cm, rw.weather, op.raw_json
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
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
    const national = extractNational(row.raw_json, head);
    const venue = venueMb.get(key) ?? { motor: null, boat: null };
    return {
      id: Number(row.id),
      raceId: String(row.race_id),
      date: String(row.date),
      ym: String(row.date).slice(0, 7),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection,
      result: String(row.result),
      currentOdds: Number(row.current_odds),
      estimatedHitRate: numOrNull(row.estimated_hit_rate),
      conservativeHitRate: numOrNull(row.conservative_hit_rate),
      ev: numOrNull(row.ev),
      head,
      hit: String(row.result) === selection,
      windMps: numOrNull(row.wind_speed_mps),
      waveCm: numOrNull(row.wave_height_cm),
      weatherPresent: row.weather != null || row.wind_speed_mps != null || row.wave_height_cm != null,
      venueMotorTop2Rate: venue.motor,
      venueBoatTop2Rate: venue.boat,
      nationalMotorTop2Rate: national.motor,
      nationalBoatTop2Rate: national.boat,
    };
  });
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

function buildRules(rows: Row[]): Rule[] {
  const rules: Rule[] = [];
  const venues = unique(rows.map((x) => x.venue));
  const raceNos = unique(rows.map((x) => x.raceNo)).sort((a, b) => a - b);
  const selections = unique(rows.map((x) => x.selection));

  for (const venue of venues) rules.push(rule(`会場=${venue}`, "venue", "会場単独は過学習注意", (r) => r.venue === venue));
  for (const raceNo of raceNos) rules.push(rule(`${raceNo}R`, "raceNo", "raceNo単独", (r) => r.raceNo === raceNo));
  for (const selection of selections) rules.push(rule(`selection=${selection}`, "selection", "買い目単位", (r) => r.selection === selection));

  rules.push(rule("弱会場セット", "venueSet", "会場まとめ", (r) => ["戸田", "多摩川", "桐生", "三国", "江戸川", "住之江", "徳山", "福岡"].includes(r.venue)));
  rules.push(rule("強会場以外", "venueSet", "攻め会場だけ残す", (r) => !["児島", "芦屋", "常滑", "びわこ", "平和島", "津"].includes(r.venue)));
  rules.push(rule("10R以降", "raceNoSet", "後半レース", (r) => r.raceNo >= 10));
  rules.push(rule("3/6/7/9R以外", "raceNoSet", "良績raceNoだけ残す", (r) => ![3, 6, 7, 9].includes(r.raceNo)));
  rules.push(rule("odds>=50", "odds", "高配当依存注意", (r) => r.currentOdds >= 50));
  rules.push(rule("odds<30", "odds", "低オッズ帯", (r) => r.currentOdds < 30));
  rules.push(rule("wave>=5", "wave", "波高", (r) => (r.waveCm ?? -1) >= 5));
  rules.push(rule("wind>=5", "wind", "風", (r) => (r.windMps ?? -1) >= 5));
  rules.push(rule("weather missing", "weather", "天候欠損", (r) => !r.weatherPresent));
  rules.push(rule("venueMotorTop2Rate>=50", "venueMotor", "良モーター人気過剰仮説", (r) => (r.venueMotorTop2Rate ?? -1) >= 50));
  rules.push(rule("venueMotorTop2Rate>=35", "venueMotor", "良モーター広め", (r) => (r.venueMotorTop2Rate ?? -1) >= 35));
  rules.push(rule("venueMotorTop2Rate<25", "venueMotor", "低モーター", (r) => r.venueMotorTop2Rate != null && r.venueMotorTop2Rate < 25));
  rules.push(rule("venueBoatTop2Rate<25以外", "venueBoat", "低ボート逆張りだけ残す", (r) => !(r.venueBoatTop2Rate != null && r.venueBoatTop2Rate < 25)));
  rules.push(rule("venueBoatTop2Rate>=50", "venueBoat", "高ボート", (r) => (r.venueBoatTop2Rate ?? -1) >= 50));
  rules.push(rule("nationalMotorTop2Rate>=50", "nationalMotor", "全国motor", (r) => (r.nationalMotorTop2Rate ?? -1) >= 50));
  rules.push(rule("confidence<0.05", "confidence", "低confidence", (r) => confidence(r) != null && Number(confidence(r)) < 0.05));
  rules.push(rule("edge<0.02", "edge", "低edge", (r) => edge(r) != null && Number(edge(r)) < 0.02));

  for (const venue of venues) {
    for (const raceNo of raceNos) {
      rules.push(rule(`${venue} ${raceNo}R`, "venueRaceNo", "細かすぎ注意", (r) => r.venue === venue && r.raceNo === raceNo));
    }
  }
  return rules;
}

function buildCombos(seeds: Rule[]) {
  const combos: Rule[] = [];
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      if (seeds[i].family === seeds[j].family) continue;
      combos.push(rule(`${seeds[i].label} AND ${seeds[j].label}`, `${seeds[i].family}+${seeds[j].family}`, `${seeds[i].risk} / ${seeds[j].risk}`, (r) => seeds[i].fn(r) && seeds[j].fn(r)));
      if (combos.length >= 1200) return combos;
    }
  }
  return combos;
}

function evaluate(rows: Row[], rules: Rule[], baseline: Metric, baselineSplit: ReturnType<typeof splitMetric>): Eval[] {
  return rules.map((r) => {
    const removedRows = rows.filter(r.fn);
    const remainingRows = rows.filter((row) => !r.fn(row));
    const removed = metric(removedRows);
    const remaining = metric(remainingRows);
    const split = splitMetric(rows, (row) => !r.fn(row));
    const warnings: string[] = [];
    if (removed.n < MIN_REMOVED) warnings.push("削除n不足");
    if (remaining.n < MIN_REMAINING) warnings.push("残りn不足");
    if (removed.roi >= baseline.roi) warnings.push("削除対象ROIが基準以上");
    if (remaining.roiExMaxHit <= baseline.roiExMaxHit) warnings.push("最大1hit除外で改善が消える");
    if (split.validation.roi < baselineSplit.validation.roi - 0.08) warnings.push("validation悪化");
    if (split.test.roi < baselineSplit.test.roi - 0.08) warnings.push("test悪化");
    if (r.family.includes("venueRaceNo")) warnings.push("細かすぎ過学習疑い");
    const improvement = remaining.roi - baseline.roi;
    let judgement: Eval["judgement"] = "D";
    if (removed.n < MIN_REMOVED || remaining.n < 100) judgement = "C";
    else if (improvement <= 0 || removed.roi >= baseline.roi) judgement = "D";
    else if (remaining.n >= 1000 && improvement >= 0.03 && warnings.length <= 1 && remaining.roiExMaxHit > baseline.roiExMaxHit) judgement = "S";
    else if (remaining.n >= MIN_REMAINING && improvement >= 0.015 && remaining.roiExMaxHit > baseline.roiExMaxHit) judgement = "A";
    else judgement = "B";
    return { label: r.label, family: r.family, risk: r.risk, judgement, warnings, removed, remaining, improvement, trainRoi: split.train.roi, validationRoi: split.validation.roi, testRoi: split.test.roi };
  }).filter((x) => x.removed.n > 0);
}

function metric(rows: Row[]): Metric {
  const hits = rows.filter((x) => x.hit);
  const hitOdds = hits.map((x) => x.currentOdds).sort((a, b) => b - a);
  const returnYen = hitOdds.reduce((sum, odds) => sum + odds * STAKE_YEN, 0);
  const stakeYen = rows.length * STAKE_YEN;
  const maxHitOdds = hitOdds[0] ?? 0;
  return { n: rows.length, hits: hits.length, hitRate: rows.length ? hits.length / rows.length : 0, avgOdds: avg(rows.map((x) => x.currentOdds)), stakeYen, returnYen, roi: stakeYen ? returnYen / stakeYen : 0, maxHitOdds, roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHitOdds * STAKE_YEN) / stakeYen : 0 };
}

function splitMetric(rows: Row[], keep: (row: Row) => boolean) {
  const sorted = sortRows(rows);
  const trainEnd = Math.floor(sorted.length * 0.7);
  const validationEnd = Math.floor(sorted.length * 0.9);
  return { train: metric(sorted.slice(0, trainEnd).filter(keep)), validation: metric(sorted.slice(trainEnd, validationEnd).filter(keep)), test: metric(sorted.slice(validationEnd).filter(keep)) };
}

function renderMd(report: { generatedAt: string; dbPath: string; baseline: Metric; baselineSplit: ReturnType<typeof splitMetric>; counts: Record<string, number>; rankings: Record<string, Eval[]> }) {
  return `# ROI Pattern Search\n\nGenerated: ${report.generatedAt}\nDB: \`${report.dbPath}\`\n\n## Baseline\n\n| n | hits | hitRate | avgOdds | ROI | roiExMaxHit |\n|---:|---:|---:|---:|---:|---:|\n| ${report.baseline.n} | ${report.baseline.hits} | ${pct(report.baseline.hitRate)} | ${fixed(report.baseline.avgOdds)} | ${pct(report.baseline.roi)} | ${pct(report.baseline.roiExMaxHit)} |\n\n## Counts\n\n${Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Stability Candidates\n\n${table(report.rankings.stability)}\n\n## ROI Improvement\n\n${table(report.rankings.improvement)}\n\n## No Buy Effect\n\n${table(report.rankings.noBuyEffect)}\n\n## Risky / Do Not Ship\n\n${table(report.rankings.risky)}\n`;
}

function table(items: Eval[]) {
  if (!items.length) return "None\n";
  return `| judgement | rule | removedN | removedROI | remainingN | remainingROI | improvement | train | validation | test | warnings |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${x.judgement} | ${md(x.label)} | ${x.removed.n} | ${pct(x.removed.roi)} | ${x.remaining.n} | ${pct(x.remaining.roi)} | ${pct(x.improvement)} | ${pct(x.trainRoi)} | ${pct(x.validationRoi)} | ${pct(x.testRoi)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}\n`;
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

function rule(label: string, family: string, risk: string, fn: (row: Row) => boolean): Rule { return { label, family, risk, fn }; }
function confidence(row: Row) { return row.conservativeHitRate ?? row.estimatedHitRate; }
function edge(row: Row) { const c = confidence(row); return c == null ? null : c * row.currentOdds - 1; }
function effect(e: Eval, baseline: Metric) { return e.removed.n * Math.max(0, baseline.roi - e.removed.roi); }
function compareEval(a: Eval, b: Eval) { const rank = { S: 5, A: 4, B: 3, C: 1, D: 0 } as const; return rank[b.judgement] - rank[a.judgement] || b.improvement - a.improvement || effect(b, b.remaining) - effect(a, a.remaining); }
function tableExists(name: string) { return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as { name?: string } | undefined)?.name); }
function sortRows(rows: Row[]) { return [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id); }
function unique<T>(values: T[]) { return [...new Set(values)]; }
function avg(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function numOrNull(value: unknown): number | null { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function fixed(value: number) { return value.toFixed(3); }
function md(value: string) { return value.replaceAll("|", "\\|"); }
