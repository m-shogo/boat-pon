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

  const decisionCounts = db.prepare(`
    SELECT
      decision,
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      MAX(date) AS latest_date
    FROM decision_history
    WHERE date >= ? AND model_version = ?
    GROUP BY decision
    ORDER BY decision
  `).all(LIVE_FROM, LIVE_MODEL) as Array<{ decision: string; n: number; odds_missing: number; odds_present: number; latest_date: string | null }>;

  const quality = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      MAX(date) AS latest_date
    FROM decision_history
    WHERE date >= ? AND model_version = ?
  `).get(LIVE_FROM, LIVE_MODEL) as { n: number; odds_missing: number; odds_present: number; latest_date: string | null };

  const watchBuyQuality = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
  `).get(LIVE_FROM, LIVE_MODEL) as { n: number; odds_missing: number; odds_present: number };

  const latestModelDecisionDate = (db.prepare(`
    SELECT MAX(date) AS d
    FROM decision_history
    WHERE date >= ? AND model_version = ?
  `).get(LIVE_FROM, LIVE_MODEL) as { d: string | null }).d;

  const latestAnyDecisionDate = (db.prepare(`
    SELECT MAX(date) AS d
    FROM decision_history
    WHERE date >= ?
  `).get(LIVE_FROM) as { d: string | null }).d;

  const latestOfficialProgramDate = (db.prepare(`
    SELECT MAX(date) AS d
    FROM official_programs
    WHERE date >= ?
  `).get(LIVE_FROM) as { d: string | null }).d;

  const latestOddsSnapshotDate = (db.prepare(`
    SELECT MAX(substr(captured_at, 1, 10)) AS d
    FROM odds_snapshots
    WHERE substr(captured_at, 1, 10) >= ?
  `).get(LIVE_FROM) as { d: string | null }).d;

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
    decisionCounts,
    quality: {
      n: numberValue(quality.n),
      oddsMissing: numberValue(quality.odds_missing),
      oddsPresent: numberValue(quality.odds_present),
      latestDate: quality.latest_date,
    },
    latestModelDecisionDate,
    latestAnyDecisionDate,
    latestOfficialProgramDate,
    latestOddsSnapshotDate,
    diagnostics,
    excludedOldModelCount,
    excludedSampleCount,
    sources,
    milestone: milestoneFor(n, roi),
    watchBuyQuality: {
      n: numberValue(watchBuyQuality.n),
      oddsMissing: numberValue(watchBuyQuality.odds_missing),
      oddsPresent: numberValue(watchBuyQuality.odds_present),
    },
  };
}

function printReport(report: ReturnType<typeof buildReport>) {
  const s = report.summary;
  const today = todayJst();
  const startDate = "2026-05-26"; // paper観察モード開始日
  const daysSinceStart = Math.floor((Date.parse(today) - Date.parse(startDate)) / 86400000);

  // --- ヘッダー ---
  console.log("=== Boat Pon live 進捗 ===");
  console.log(`モード: paper観察中（実購入なし）  ${today}`);
  console.log("");

  // --- BUY進捗バー ---
  const TARGET = 300;
  const pct = Math.min(100, Math.round((s.n / TARGET) * 100));
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  console.log(`BUY進捗  [${bar}] ${s.n}/${TARGET}件 (${pct}%)`);
  if (s.n === 0 && daysSinceStart > 0) {
    console.log(`         開始から${daysSinceStart}日経過、まだ0件`);
  } else if (s.n > 0) {
    const ratePerDay = s.n / Math.max(1, daysSinceStart);
    const daysLeft = ratePerDay > 0 ? Math.ceil((TARGET - s.n) / ratePerDay) : null;
    const eta = daysLeft !== null ? `あと約${daysLeft}日` : "-";
    console.log(`         ${daysSinceStart}日で${s.n}件 (${ratePerDay.toFixed(1)}件/日)  n=300まで${eta}`);
  }
  console.log("");

  // --- システム稼働確認 ---
  const lastDecision = report.latestModelDecisionDate;
  const lastProgram = report.latestOfficialProgramDate;
  const lastOdds = report.latestOddsSnapshotDate;
  const decisionLag = lastDecision ? Math.floor((Date.parse(today) - Date.parse(lastDecision)) / 86400000) : null;
  const programLag = lastProgram ? Math.floor((Date.parse(today) - Date.parse(lastProgram)) / 86400000) : null;
  const oddsLag = lastOdds ? Math.floor((Date.parse(today) - Date.parse(lastOdds)) / 86400000) : null;

  const statusIcon = (lag: number | null, warnDays = 2) =>
    lag === null ? "❓" : lag <= warnDays ? "✅" : `⚠️ ${lag}日前`;

  console.log("システム稼働");
  console.log(`  番組取得    ${statusIcon(programLag)}  最終: ${lastProgram ?? "-"}`);
  console.log(`  判定        ${statusIcon(decisionLag)}  最終: ${lastDecision ?? "-"}`);
  console.log(`  オッズ取得  ${statusIcon(oddsLag)}  最終: ${lastOdds ?? "-"}`);

  const oddsTotal = report.quality.n;
  const oddsPresent = report.quality.oddsPresent;
  const oddsCoverage = oddsTotal > 0 ? `${oddsPresent}/${oddsTotal}件 (${Math.round(oddsPresent / oddsTotal * 100)}%)` : "-";
  console.log(`  オッズ取得率(全体)   ${oddsCoverage}`);
  const watchBuyTotal = report.watchBuyQuality.n;
  const watchBuyPresent = report.watchBuyQuality.oddsPresent;
  const watchBuyCoverage = watchBuyTotal > 0 ? `${watchBuyPresent}/${watchBuyTotal}件 (${Math.round(watchBuyPresent / watchBuyTotal * 100)}%)` : "-";
  console.log(`  オッズ取得率(WATCH+BUY) ${watchBuyCoverage}`);
  console.log("");

  // --- ROI（n>=1のとき） ---
  if (s.n > 0) {
    console.log("ROI（参考）");
    console.log(`  n=${s.n}  ROI=${fmt(s.roi)}  roiExMax=${fmt(s.roiExMax)}`);
    console.log(`  的中${s.hits}件  最大払戻${s.maxHitOdds || "-"}倍`);
    console.log("");
  }

  // --- 再検討条件 ---
  const cond1 = s.n >= 300 ? "✅" : `❌ (${s.n}/300)`;
  const cond2 = s.roi !== null && s.roi > 1.05 ? "✅" : `❌ (${fmt(s.roi)})`;
  const cond3 = s.roiExMax !== null && s.roiExMax > 1.0 ? "✅" : `❌ (${fmt(s.roiExMax)})`;
  console.log("再検討条件（全部✅で初めて購入を検討）");
  console.log(`  ${cond1} n >= 300`);
  console.log(`  ${cond2} ROI > 1.05`);
  console.log(`  ${cond3} roiExMax > 1.0`);

  if (report.diagnostics.length > 0) {
    const excluded = report.diagnostics.filter(r => r.model_version !== LIVE_MODEL);
    if (excluded.length > 0) {
      console.log("");
      console.log("除外済み（旧モデル・サンプル）");
      for (const row of excluded) {
        console.log(`  ${row.model_version}  n=${row.n}  latest=${row.latest_date ?? "-"}`);
      }
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

function todayJst() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
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
