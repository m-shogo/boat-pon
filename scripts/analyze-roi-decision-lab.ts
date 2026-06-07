import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadOdds, loadRows } from "./roi-lab/load-rows.js";
import { buildLabRules } from "./roi-lab/rules.js";
import { compareEvaluation, evaluateRule, metric, ticketResult } from "./roi-lab/evaluate.js";
import type { LabEvaluation } from "./roi-lab/types.js";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-decision-lab.md";
const OUT_JSON = "reports/roi-decision-lab.json";

if (!existsSync(DB_PATH)) {
  console.error(`[roi-decision-lab] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
try {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA query_only = ON;");
  const rows = loadRows(db).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const odds = loadOdds(db, [...new Set(rows.map((row) => row.raceId))]);
  const baseline = metric(rows.map((row) => ticketResult(row, [row.selection], odds.get(row.raceId) ?? new Map())));
  const rules = buildLabRules();
  const evaluations = rules.map((rule) => evaluateRule(rows, odds, rule, baseline)).sort(compareEvaluation);
  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    safety: { readOnly: true, queryOnly: true, writesDb: false, changesSettings: false, autoBetting: false },
    baseline,
    counts: {
      rows: rows.length,
      rules: rules.length,
      s: evaluations.filter((item) => item.judgement === "S").length,
      a: evaluations.filter((item) => item.judgement === "A").length,
      d: evaluations.filter((item) => item.judgement === "D").length,
    },
    rankings: {
      stable: evaluations.filter((item) => item.judgement === "S" || item.judgement === "A").slice(0, 50),
      byImprovement: [...evaluations].sort((a, b) => b.improvement - a.improvement).slice(0, 50),
      noBuy: evaluations.filter((item) => item.action === "NO_BUY").slice(0, 50),
      betSelector: evaluations.filter((item) => item.action !== "NO_BUY").slice(0, 50),
      risky: evaluations.filter((item) => item.judgement === "D" || item.warnings.length >= 2).slice(0, 50),
    },
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[roi-decision-lab] rows=${rows.length} baseline=${pct(baseline.roi)} rules=${rules.length}`);
  console.log(`[roi-decision-lab] wrote ${OUT_MD}`);
  console.log(`[roi-decision-lab] wrote ${OUT_JSON}`);
} finally {
  db.close();
}

function renderMarkdown(report: {
  generatedAt: string;
  baseline: ReturnType<typeof metric>;
  counts: Record<string, number>;
  rankings: Record<string, LabEvaluation[]>;
}) {
  return `# ROI Decision Lab\n\nGenerated: ${report.generatedAt}\n\n## Safety\n\n- DB write: no\n- app_settings change: no\n- production decision logic change: no\n- auto betting/login/site operation: no\n\n## Baseline\n\n| n | hits | hitRate | stake | return | ROI | ROI ex max hit |\n|---:|---:|---:|---:|---:|---:|---:|\n| ${report.baseline.n} | ${report.baseline.hits} | ${pct(report.baseline.hitRate)} | ${yen(report.baseline.stake)} | ${yen(report.baseline.ret)} | ${pct(report.baseline.roi)} | ${pct(report.baseline.roiExMaxHit)} |\n\n## Counts\n\n${Object.entries(report.counts).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Stable Candidates\n\n${table(report.rankings.stable)}\n\n## NO BUY Candidates\n\n${table(report.rankings.noBuy)}\n\n## Bet Selector Candidates\n\n${table(report.rankings.betSelector)}\n\n## Risky / Do Not Ship\n\n${table(report.rankings.risky)}\n`;
}

function table(items: LabEvaluation[]) {
  if (!items.length) return "None\n";
  return `| judgement | action | label | afterROI | improve | removedN | removedROI | train | validation | test | warnings |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|\n${items.map((item) => `| ${item.judgement} | ${item.action} | ${md(item.label)} | ${pct(item.after.roi)} | ${pct(item.improvement)} | ${item.removed.n} | ${pct(item.removed.roi)} | ${pct(item.train.roi)} | ${pct(item.validation.roi)} | ${pct(item.test.roi)} | ${md(item.warnings.join(", ") || "-")} |`).join("\n")}`;
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function yen(value: number) { return `${Math.round(value).toLocaleString("ja-JP")}円`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
