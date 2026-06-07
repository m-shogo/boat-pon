import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-all-feature-search.md";
const OUT_JSON = "reports/roi-all-feature-search.json";
const OUT_CSV = "reports/roi-all-feature-search.csv";
const STAKE_YEN = 100;
const MIN_N = Number(process.env.ROI_ALL_MIN_N ?? 50);
const MIN_REMAINING = Number(process.env.ROI_ALL_MIN_REMAINING ?? 300);
const MAX_RULES = Number(process.env.ROI_ALL_MAX_RULES ?? 5000);

type Raw = Record<string, unknown>;
type Value = string | number | boolean | null;
type Row = { id: number; raceId: string; date: string; selection: string; result: string; currentOdds: number; hit: boolean; features: Record<string, Value> };
type Metric = { n: number; hits: number; hitRate: number; avgOdds: number; stakeYen: number; returnYen: number; roi: number; maxHitOdds: number; roiExMaxHit: number };
type Rule = { label: string; feature: string; fn: (row: Row) => boolean; risk: string };
type Eval = { label: string; feature: string; judgement: "S" | "A" | "B" | "C" | "D"; warnings: string[]; removed: Metric; remaining: Metric; improvement: number; trainRoi: number; validationRoi: number; testRoi: number; score: number; risk: string };

if (!existsSync(DB_PATH)) {
  console.error(`[search-roi-all-features-lite] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");

  const rows = loadRows().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const baseline = metric(rows);
  const baselineSplit = splitMetric(rows, () => true);
  console.log(`[search-roi-all-features-lite] rows=${rows.length} baseline=${pct(baseline.roi)}`);

  const rules = buildRules(rows).slice(0, MAX_RULES);
  console.log(`[search-roi-all-features-lite] rules=${rules.length}`);
  const evaluations = evaluate(rows, rules, baseline, baselineSplit).sort(compareEval);

  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    safety: { readOnly: true, queryOnly: true, writesDb: false, changesSettings: false },
    baseline,
    baselineSplit,
    counts: {
      rows: rows.length,
      features: Object.keys(rows[0]?.features ?? {}).length,
      rules: rules.length,
      evaluations: evaluations.length,
      s: evaluations.filter((x) => x.judgement === "S").length,
      a: evaluations.filter((x) => x.judgement === "A").length,
      d: evaluations.filter((x) => x.judgement === "D").length,
    },
    rankings: {
      stability: evaluations.filter((x) => x.judgement === "S" || x.judgement === "A").slice(0, 50),
      improvement: [...evaluations].sort((a, b) => b.improvement - a.improvement).slice(0, 50),
      noBuyEffect: [...evaluations].sort((a, b) => effect(b, baseline) - effect(a, baseline)).slice(0, 50),
      risky: evaluations.filter((x) => x.judgement === "D" || x.warnings.length >= 2).slice(0, 50),
    },
    featureCoverage: coverage(rows).slice(0, 200),
  };

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_CSV, csv(evaluations));
  writeFileSync(OUT_MD, mdReport(report));
  console.log(`[search-roi-all-features-lite] wrote ${OUT_MD}`);
  console.log(`[search-roi-all-features-lite] wrote ${OUT_JSON}`);
  console.log(`[search-roi-all-features-lite] wrote ${OUT_CSV}`);
} finally {
  db.close();
}

function loadRows(): Row[] {
  const base = db.prepare(`
    SELECT dh.*, rw.wind_speed_mps, rw.wave_height_cm, rw.weather
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Raw[];

  const raceIds = unique(base.map((x) => String(x.race_id)));
  const motor = byRaceCourse("motor_boat_stats", raceIds, "course");
  const entries = byRaceCourse("race_entries", raceIds, "boat");
  const exhibition = byRaceCourse("exhibition_data", raceIds, "course");
  const equipment = byRaceCourse("race_equipment", raceIds, "course");
  const official = officialHead(raceIds);

  return base.map((x) => {
    const raceId = String(x.race_id);
    const selection = String(x.selection);
    const result = String(x.result);
    const head = Number(selection.split("-")[0]);
    const f: Record<string, Value> = {};
    add(f, "decision", x);
    add(f, "head_motor", motor.get(`${raceId}:${head}`) ?? {});
    add(f, "head_entry", entries.get(`${raceId}:${head}`) ?? {});
    add(f, "head_exhibition", exhibition.get(`${raceId}:${head}`) ?? {});
    add(f, "head_equipment", equipment.get(`${raceId}:${head}`) ?? {});
    add(f, "head_official", official.get(`${raceId}:${head}`) ?? {});
    f.derived_head = head;
    f.derived_result_match = result === selection;
    f.derived_month = String(x.date).slice(0, 7);
    f.derived_selection = selection;
    f.derived_race_no = primitive(x.race_no);
    f.derived_venue = primitive(x.venue);
    addSelectionSummary(f, raceId, selection, { motor, exhibition, equipment, entries });
    return { id: Number(x.id), raceId, date: String(x.date), selection, result, currentOdds: Number(x.current_odds), hit: result === selection, features: f };
  });
}

function addSelectionSummary(f: Record<string, Value>, raceId: string, selection: string, maps: Record<string, Map<string, Raw>>) {
  const courses = selection.split("-").map(Number).filter(Number.isFinite);
  for (const [name, map] of Object.entries(maps)) {
    const records = courses.map((c) => map.get(`${raceId}:${c}`)).filter((x): x is Raw => Boolean(x));
    const keys = unique(records.flatMap((r) => Object.keys(r).filter((k) => toNum(r[k]) != null))).slice(0, 40);
    for (const key of keys) {
      const nums = records.map((r) => toNum(r[key])).filter((v): v is number => v != null);
      if (!nums.length) continue;
      f[`selected_${name}_${key}_min`] = Math.min(...nums);
      f[`selected_${name}_${key}_max`] = Math.max(...nums);
      f[`selected_${name}_${key}_avg`] = nums.reduce((s, v) => s + v, 0) / nums.length;
    }
  }
}

function add(target: Record<string, Value>, prefix: string, source: Raw) {
  for (const [key, value] of Object.entries(source)) {
    if (key === "raw_json") continue;
    const v = primitive(value);
    if (v == null) continue;
    target[`${prefix}_${key}`] = v;
  }
}

function byRaceCourse(table: string, raceIds: string[], courseCol: string) {
  const map = new Map<string, Raw>();
  if (!tableExists(table) || !columnExists(table, "race_id") || !columnExists(table, courseCol)) return map;
  for (const chunk of chunks(raceIds, 500)) {
    const rows = db.prepare(`SELECT * FROM ${ident(table)} WHERE race_id IN (${placeholders(chunk.length)})`).all(...chunk) as Raw[];
    for (const row of rows) map.set(`${String(row.race_id)}:${Number(row[courseCol])}`, row);
  }
  return map;
}

function officialHead(raceIds: string[]) {
  const map = new Map<string, Raw>();
  if (!tableExists("official_programs") || !columnExists("official_programs", "raw_json")) return map;
  for (const chunk of chunks(raceIds, 500)) {
    const rows = db.prepare(`SELECT race_id, raw_json FROM official_programs WHERE race_id IN (${placeholders(chunk.length)})`).all(...chunk) as Raw[];
    for (const row of rows) {
      if (typeof row.raw_json !== "string") continue;
      try {
        const parsed = JSON.parse(row.raw_json) as { boats?: Raw[] };
        for (const boat of parsed.boats ?? []) {
          const course = Number(boat.course);
          if (Number.isFinite(course)) map.set(`${String(row.race_id)}:${course}`, boat);
        }
      } catch {}
    }
  }
  return map;
}

function buildRules(rows: Row[]) {
  const rules: Rule[] = [];
  const keys = Object.keys(rows[0]?.features ?? {}).sort();
  for (const key of keys) {
    const values = rows.map((r) => r.features[key] ?? null);
    const present = values.filter((v) => v != null);
    if (present.length < MIN_N) continue;
    rules.push({ label: `${key}: missing`, feature: key, risk: "missing value split", fn: (r) => r.features[key] == null });
    const nums = present.map(toNum).filter((v): v is number => v != null);
    if (nums.length >= present.length * 0.8) {
      for (const cut of cuts(nums)) {
        rules.push({ label: `${key} < ${cut}`, feature: key, risk: "numeric threshold", fn: (r) => toNum(r.features[key]) != null && Number(toNum(r.features[key])) < cut });
        rules.push({ label: `${key} >= ${cut}`, feature: key, risk: "numeric threshold", fn: (r) => toNum(r.features[key]) != null && Number(toNum(r.features[key])) >= cut });
      }
    } else {
      for (const item of counts(present.map(String)).filter((x) => x.count >= MIN_N).slice(0, 25)) {
        rules.push({ label: `${key} = ${item.value}`, feature: key, risk: "category split", fn: (r) => String(r.features[key]) === item.value });
        rules.push({ label: `${key} != ${item.value}`, feature: key, risk: "category split", fn: (r) => r.features[key] != null && String(r.features[key]) !== item.value });
      }
    }
  }
  return dedupe(rules).filter((rule) => rows.some(rule.fn));
}

function evaluate(rows: Row[], rules: Rule[], base: Metric, baseSplit: ReturnType<typeof splitMetric>) {
  const out: Eval[] = [];
  let i = 0;
  for (const rule of rules) {
    i += 1;
    if (i % 500 === 0) console.log(`[search-roi-all-features-lite] progress ${i}/${rules.length}`);
    const removedRows = rows.filter(rule.fn);
    if (!removedRows.length) continue;
    const remainingRows = rows.filter((r) => !rule.fn(r));
    const removed = metric(removedRows);
    const remaining = metric(remainingRows);
    const split = splitMetric(rows, (r) => !rule.fn(r));
    const improvement = remaining.roi - base.roi;
    const warnings: string[] = [];
    if (removed.n < MIN_N) warnings.push("removed n low");
    if (remaining.n < MIN_REMAINING) warnings.push("remaining n low");
    if (removed.roi >= base.roi) warnings.push("removed ROI not weak");
    if (remaining.roiExMaxHit <= base.roiExMaxHit) warnings.push("max-hit adjusted gain disappears");
    if (split.validation.roi < baseSplit.validation.roi - 0.08) warnings.push("validation worse");
    if (split.test.roi < baseSplit.test.roi - 0.08) warnings.push("test worse");
    if (rule.feature.includes("date") || rule.feature.includes("month") || rule.feature.includes("id")) warnings.push("possible time/id leakage");
    const score = improvement * 100 + Math.min(20, removed.n / 100) + (remaining.roiExMaxHit - base.roiExMaxHit) * 80 + (split.test.roi - baseSplit.test.roi) * 30 - warnings.length * 6;
    let judgement: Eval["judgement"] = "D";
    if (removed.n < MIN_N || remaining.n < 100) judgement = "C";
    else if (improvement <= 0 || removed.roi >= base.roi) judgement = "D";
    else if (remaining.n >= 1000 && improvement >= 0.03 && warnings.length <= 1 && remaining.roiExMaxHit > base.roiExMaxHit) judgement = "S";
    else if (remaining.n >= MIN_REMAINING && improvement >= 0.015 && remaining.roiExMaxHit > base.roiExMaxHit) judgement = "A";
    else judgement = "B";
    out.push({ label: rule.label, feature: rule.feature, judgement, warnings, removed, remaining, improvement, trainRoi: split.train.roi, validationRoi: split.validation.roi, testRoi: split.test.roi, score, risk: rule.risk });
  }
  return out;
}

function metric(rows: Row[]): Metric {
  const hits = rows.filter((r) => r.hit);
  const hitOdds = hits.map((r) => r.currentOdds).sort((a, b) => b - a);
  const returnYen = hitOdds.reduce((s, o) => s + o * STAKE_YEN, 0);
  const stakeYen = rows.length * STAKE_YEN;
  const maxHitOdds = hitOdds[0] ?? 0;
  return { n: rows.length, hits: hits.length, hitRate: rows.length ? hits.length / rows.length : 0, avgOdds: avg(rows.map((r) => r.currentOdds)), stakeYen, returnYen, roi: stakeYen ? returnYen / stakeYen : 0, maxHitOdds, roiExMaxHit: stakeYen ? Math.max(0, returnYen - maxHitOdds * STAKE_YEN) / stakeYen : 0 };
}
function splitMetric(rows: Row[], keep: (row: Row) => boolean) { const trainEnd = Math.floor(rows.length * 0.7); const validationEnd = Math.floor(rows.length * 0.9); return { train: metric(rows.slice(0, trainEnd).filter(keep)), validation: metric(rows.slice(trainEnd, validationEnd).filter(keep)), test: metric(rows.slice(validationEnd).filter(keep)) }; }
function mdReport(report: { generatedAt: string; dbPath: string; baseline: Metric; counts: Record<string, number>; rankings: Record<string, Eval[]> }) { return `# ROI All Feature Search\n\nGenerated: ${report.generatedAt}\nDB: \`${report.dbPath}\`\n\n## Baseline\n\nROI ${pct(report.baseline.roi)} / n=${report.baseline.n} / ROI ex max hit ${pct(report.baseline.roiExMaxHit)}\n\n## Counts\n\n${Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Stability\n\n${table(report.rankings.stability)}\n\n## Improvement\n\n${table(report.rankings.improvement)}\n\n## Risky\n\n${table(report.rankings.risky)}\n`; }
function table(items: Eval[]) { if (!items.length) return "None\n"; return `| judgement | rule | removedN | removedROI | remainingN | remainingROI | improvement | train | validation | test | warnings |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${items.slice(0, 40).map((x) => `| ${x.judgement} | ${esc(x.label)} | ${x.removed.n} | ${pct(x.removed.roi)} | ${x.remaining.n} | ${pct(x.remaining.roi)} | ${pct(x.improvement)} | ${pct(x.trainRoi)} | ${pct(x.validationRoi)} | ${pct(x.testRoi)} | ${esc(x.warnings.join(", ") || "-")} |`).join("\n")}\n`; }
function csv(items: Eval[]) { return `judgement,label,feature,removed_n,removed_roi,remaining_n,remaining_roi,improvement,train_roi,validation_roi,test_roi,score,warnings\n${items.map((x) => [x.judgement, x.label, x.feature, x.removed.n, x.removed.roi, x.remaining.n, x.remaining.roi, x.improvement, x.trainRoi, x.validationRoi, x.testRoi, x.score, x.warnings.join("; ")].map(cell).join(",")).join("\n")}\n`; }
function coverage(rows: Row[]) { return Object.keys(rows[0]?.features ?? {}).map((key) => ({ key, present: rows.filter((r) => r.features[key] != null).length, total: rows.length })).sort((a, b) => b.present - a.present); }
function tableExists(name: string) { return Boolean((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) as { name?: string } | undefined)?.name); }
function columnExists(table: string, col: string) { if (!tableExists(table)) return false; return (db.prepare(`PRAGMA table_info(${ident(table)})`).all() as Array<{ name: string }>).some((r) => r.name === col); }
function ident(v: string) { if (!/^[a-zA-Z0-9_]+$/.test(v)) throw new Error(`unsafe identifier ${v}`); return v; }
function primitive(v: unknown): Value { if (v == null || v === "") return null; if (typeof v === "number" || typeof v === "boolean") return v; if (typeof v === "bigint") return Number(v); if (typeof v === "string") { const s = v.trim(); if (!s || s.length > 120) return null; const n = Number(s); return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(s) ? n : s; } return null; }
function toNum(v: unknown): number | null { if (typeof v === "number" && Number.isFinite(v)) return v; if (typeof v === "bigint") return Number(v); if (typeof v === "boolean") return v ? 1 : 0; if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; } return null; }
function cuts(nums: number[]) { const s = [...nums].sort((a, b) => a - b); return unique([0.1, 0.25, 0.5, 0.75, 0.9].map((q) => Number(s[Math.floor((s.length - 1) * q)].toFixed(6)))); }
function counts(values: string[]) { const m = new Map<string, number>(); for (const v of values) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count); }
function compareEval(a: Eval, b: Eval) { const r = { S: 5, A: 4, B: 3, C: 1, D: 0 } as const; return r[b.judgement] - r[a.judgement] || b.score - a.score || b.improvement - a.improvement; }
function effect(e: Eval, b: Metric) { return e.removed.n * Math.max(0, b.roi - e.removed.roi); }
function dedupe(rules: Rule[]) { const seen = new Set<string>(); return rules.filter((r) => { if (seen.has(r.label)) return false; seen.add(r.label); return true; }); }
function chunks<T>(items: T[], size: number) { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function placeholders(n: number) { return Array.from({ length: n }, () => "?").join(","); }
function unique<T>(v: T[]) { return [...new Set(v)]; }
function avg(v: number[]) { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; }
function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function esc(v: string) { return v.replaceAll("|", "\\|"); }
function cell(v: unknown) { return `"${String(v ?? "").replaceAll('"', '""')}"`; }
