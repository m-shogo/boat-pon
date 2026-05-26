import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION, liveMonitorFilterText } from "../src/domain/liveMonitor";

const DB_PATH = "data/boat.sqlite";
const LIVE_FROM = LIVE_MONITOR_FROM;
const LIVE_MODEL = LIVE_MONITOR_MODEL_VERSION;
const FILTER = liveMonitorFilterText();

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(DB_PATH, { readOnly: true });

try {
  const report = buildReport(db);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      SUM(returned) AS returned_n,
      ROUND(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 /
        NULLIF(SUM(CASE WHEN returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi,
      MAX(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) AS max_hit_odds,
      ROUND(AVG(required_odds), 2) AS avg_required_odds,
      ROUND(AVG(current_odds), 2) AS avg_current_odds,
      ROUND(AVG(CASE WHEN required_odds > 0 THEN current_odds / required_odds END), 3) AS avg_odds_ratio,
      ROUND(SUM(estimated_hit_rate), 2) AS estimated_hits
    FROM decision_history
    WHERE decision = 'BUY'
      AND date >= ?
      AND model_version = ?
  `).get(LIVE_FROM, LIVE_MODEL) as Record<string, unknown>;

  const n = numberValue(summary.n);
  const returnedN = numberValue(summary.returned_n);
  const roi = nullableNumber(summary.roi);
  const maxHitOdds = numberValue(summary.max_hit_odds);
  const effectiveN = n - returnedN;
  const roiExMax = roi !== null && effectiveN > 0 && maxHitOdds > 0
    ? Math.round((roi - maxHitOdds / effectiveN) * 1000) / 1000
    : null;

  const latestLiveDate = (db.prepare(`
    SELECT MAX(date) AS d FROM decision_history
    WHERE decision = 'BUY' AND date >= ? AND model_version = ?
  `).get(LIVE_FROM, LIVE_MODEL) as { d: string | null }).d;

  const diagnostics = db.prepare(`
    SELECT
      COALESCE(model_version, '(null)') AS model_version,
      source,
      COUNT(*) AS n,
      MAX(date) AS latest_date
    FROM decision_history
    WHERE decision = 'BUY' AND date >= ?
    GROUP BY model_version, source
    ORDER BY n DESC
  `).all(LIVE_FROM) as Array<{ model_version: string; source: string; n: number; latest_date: string | null }>;

  let excludedOldModelCount = 0;
  let excludedSampleCount = 0;
  const sources: string[] = [];
  for (const row of diagnostics) {
    if (row.model_version === LIVE_MODEL) {
      if (!sources.includes(row.source)) sources.push(row.source);
    } else if (row.model_version === "(null)") {
      excludedSampleCount += row.n;
    } else {
      excludedOldModelCount += row.n;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { from: LIVE_FROM, to: "current", modelVersion: LIVE_MODEL, filter: FILTER },
    summary: {
      n,
      hits: numberValue(summary.hits),
      returnedN,
      roi,
      maxHitOdds,
      roiExMax,
      avgRequiredOdds: nullableNumber(summary.avg_required_odds),
      avgCurrentOdds: nullableNumber(summary.avg_current_odds),
      avgOddsRatio: nullableNumber(summary.avg_odds_ratio),
      estimatedHits: nullableNumber(summary.estimated_hits),
      actualHits: numberValue(summary.hits),
    },
    latestLiveDate,
    diagnostics,
    excludedOldModelCount,
    excludedSampleCount,
    sources,
    milestone: milestoneFor(n, roi),
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  const s = report.summary;
  console.log("Boat Pon 2026 live B1 monitor");
  console.log(`filter: ${report.period.filter}`);
  console.log(`n=${s.n} hits=${s.hits} returned=${s.returnedN} latest=${report.latestLiveDate ?? "-"}`);
  console.log(`roi=${fmt(s.roi)} roiExMax=${fmt(s.roiExMax)} maxHitOdds=${s.maxHitOdds || "-"}`);
  console.log(`avgRequiredOdds=${fmt(s.avgRequiredOdds)} avgCurrentOdds=${fmt(s.avgCurrentOdds)} avgOddsRatio=${fmt(s.avgOddsRatio)}`);
  console.log(`estimatedHits=${fmt(s.estimatedHits)} actualHits=${s.actualHits}`);
  console.log(`excludedOldModel=${report.excludedOldModelCount} excludedSample=${report.excludedSampleCount} sources=${report.sources.join(",") || "-"}`);
  console.log(`milestone: ${report.milestone}`);
  if (report.diagnostics.length > 0) {
    console.log("diagnostics:");
    for (const row of report.diagnostics) {
      const mark = row.model_version === LIVE_MODEL ? "target" : "excluded";
      console.log(`  ${mark}\t${row.model_version}\t${row.source}\tn=${row.n}\tlatest=${row.latest_date ?? "-"}`);
    }
  }
}

function milestoneFor(n: number, roi: number | null) {
  if (n < 300) return "insufficient: n<300, ROI is not actionable";
  if (n < 600) return roi !== null && roi < 0.75 ? "watch: withdrawal candidate" : "watch: continue monitoring";
  if (n < 1000) return "conditional: require ROI>1.2 and monthly stability";
  return "near-confirmed: require roiExMax>1.0";
}

function parseArgs(argv: string[]) {
  const parsed = { json: false };
  for (const arg of argv) {
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx scripts/live-b1-monitor.ts [--json]");
      process.exit(0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return parsed;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fmt(value: number | null) {
  return value === null ? "-" : value.toFixed(3);
}
