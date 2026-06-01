import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_FROM, LIVE_MONITOR_MODEL_VERSION, liveMonitorFilterText } from "../src/domain/liveMonitor";

const DB_PATH = "data/boat.sqlite";
const LIVE_FROM = LIVE_MONITOR_FROM;
const LIVE_MODEL = LIVE_MONITOR_MODEL_VERSION;
const FILTER = liveMonitorFilterText();
const PAPER_LIVE_START = "2026-05-27";
const TARGET_BUY_N = 300;

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

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
      SUM(CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END) AS settled_n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      SUM(returned) AS returned_n,
      ROUND(SUM(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) * 1.0 /
        NULLIF(SUM(CASE WHEN result IS NOT NULL AND returned = 0 THEN 1 ELSE 0 END), 0), 3) AS roi,
      MAX(CASE WHEN selection = result AND returned = 0 THEN current_odds ELSE 0 END) AS max_hit_odds,
      ROUND(AVG(required_odds), 2) AS avg_required_odds,
      ROUND(AVG(current_odds), 2) AS avg_current_odds,
      ROUND(AVG(CASE WHEN required_odds > 0 THEN current_odds / required_odds END), 3) AS avg_odds_ratio,
      ROUND(SUM(estimated_hit_rate), 2) AS estimated_hits
    FROM decision_history
    WHERE decision = 'BUY'
      AND date >= ?
      AND model_version = ?
      AND run_kind = 'paper-live'
  `).get(LIVE_FROM, LIVE_MODEL) as Record<string, unknown>;

  const n = numberValue(summary.n);
  const settledN = numberValue(summary.settled_n);
  const returnedN = numberValue(summary.returned_n);
  const roi = nullableNumber(summary.roi);
  const maxHitOdds = numberValue(summary.max_hit_odds);
  const effectiveN = settledN - returnedN;
  const roiExMax = roi !== null && effectiveN > 0 && maxHitOdds > 0
    ? Math.round((roi - maxHitOdds / effectiveN) * 1000) / 1000
    : null;

  const latestLiveDate = (db.prepare(`
    SELECT MAX(date) AS d FROM decision_history
    WHERE decision = 'BUY' AND date >= ? AND model_version = ? AND run_kind = 'paper-live'
  `).get(LIVE_FROM, LIVE_MODEL) as { d: string | null }).d;

  const decisionCounts = db.prepare(`
    SELECT
      decision,
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      MAX(date) AS latest_date
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live'
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
    WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live'
  `).get(LIVE_FROM, LIVE_MODEL) as { n: number; odds_missing: number; odds_present: number; latest_date: string | null };

  const watchBuyQuality = db.prepare(`
    SELECT
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live' AND decision IN ('WATCH', 'BUY')
  `).get(LIVE_FROM, LIVE_MODEL) as { n: number; odds_missing: number; odds_present: number };

  const latestModelDecisionDate = (db.prepare(`
    SELECT MAX(date) AS d
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live'
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
      run_kind,
      COUNT(*) AS n,
      MAX(date) AS latest_date
    FROM decision_history
    WHERE decision = 'BUY' AND date >= ?
    GROUP BY model_version, source, run_kind
    ORDER BY n DESC
  `).all(LIVE_FROM) as Array<{ model_version: string; source: string; run_kind: string; n: number; latest_date: string | null }>;

  let excludedOldModelCount = 0;
  let excludedSampleCount = 0;
  const sources: string[] = [];
  for (const row of diagnostics) {
    if (row.model_version === LIVE_MODEL && row.run_kind === "paper-live") {
      if (!sources.includes(row.source)) sources.push(row.source);
    } else if (row.model_version === "(null)") {
      excludedSampleCount += row.n;
    } else {
      excludedOldModelCount += row.n;
    }
  }

  const paperDays = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy_n,
      SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch_n,
      COUNT(*) AS total_n
    FROM decision_history
    WHERE date >= ? AND model_version = ? AND run_kind = 'paper-live'
    GROUP BY date
    ORDER BY date
  `).all(PAPER_LIVE_START, LIVE_MODEL) as Array<{ date: string; buy_n: number; watch_n: number; total_n: number }>;

  const todayBuyCandidates = db.prepare(`
    SELECT venue, race_no, selection, current_odds, ev, required_odds, result, selection_popularity
    FROM decision_history
    WHERE date = ? AND model_version = ? AND run_kind = 'paper-live' AND decision = 'BUY'
    ORDER BY race_no ASC
  `).all(todayJst(), LIVE_MODEL) as Array<{
    venue: string; race_no: number; selection: string;
    current_odds: number | null; ev: number | null; required_odds: number | null;
    result: string | null; selection_popularity: number | null;
  }>;

  const historicalPace = historicalBuyPace(db);
  const livePace = liveBuyPace(paperDays);
  const eta = buyEta(n, livePace.ratePerDay, historicalPace);
  const alerts = buildAlerts({
    buyN: n,
    paperDays,
    watchBuyN: numberValue(watchBuyQuality.n),
    watchBuyOddsMissing: numberValue(watchBuyQuality.odds_missing),
    latestModelDecisionDate,
    latestOddsSnapshotDate,
  });

  return {
    generatedAt: new Date().toISOString(),
    period: { from: LIVE_FROM, to: "current", modelVersion: LIVE_MODEL, filter: FILTER },
    summary: {
      n,
      settledN,
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
    paperLive: {
      startDate: PAPER_LIVE_START,
      observedDays: paperDays.length,
      zeroBuyDays: paperDays.filter((row) => numberValue(row.buy_n) === 0).length,
      consecutiveZeroBuyDays: consecutiveZeroBuyDays(paperDays),
      latestDay: paperDays.at(-1) ?? null,
    },
    pace: {
      live: livePace,
      historical: historicalPace,
      eta,
    },
    alerts,
    todayBuyCandidates,
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
  const TARGET = TARGET_BUY_N;
  const pct = Math.min(100, Math.round((s.n / TARGET) * 100));
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  console.log(`BUY進捗  [${bar}] ${s.n}/${TARGET}件 (${pct}%)`);
  if (s.n === 0 && daysSinceStart > 0) {
    console.log(`         開始から${daysSinceStart}日経過、まだ0件`);
  } else if (s.n > 0) {
    const ratePerDay = report.pace.live.ratePerDay;
    const eta = report.pace.eta.liveDaysLeft !== null ? `あと約${report.pace.eta.liveDaysLeft}日` : "-";
    console.log(`         ${daysSinceStart}日で${s.n}件 (${ratePerDay.toFixed(1)}件/日)  n=300まで${eta}`);
  }
  console.log(
    `         参考ETA: 過去中央値ペースなら${report.pace.eta.historicalMedianDaysLeft}日、保守ペースなら${report.pace.eta.historicalMinDaysLeft}日`,
  );
  console.log("");

  if (report.alerts.length > 0) {
    console.log("早期警告");
    for (const alert of report.alerts) {
      console.log(`  ${alert.level}\t${alert.code}\t${alert.message}`);
    }
    console.log("");
  }

  // --- システム稼働確認 ---
  const lastDecision = report.latestModelDecisionDate;
  const lastProgram = report.latestOfficialProgramDate;
  const lastOdds = report.latestOddsSnapshotDate;
  const decisionLag = lastDecision ? Math.floor((Date.parse(today) - Date.parse(lastDecision)) / 86400000) : null;
  const programLag = lastProgram ? Math.floor((Date.parse(today) - Date.parse(lastProgram)) / 86400000) : null;
  const oddsLag = lastOdds ? Math.floor((Date.parse(today) - Date.parse(lastOdds)) / 86400000) : null;

  const statusIcon = (lag: number | null, warnDays = 1) =>
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
    const pendingN = s.n - s.settledN;
    const pendingStr = pendingN > 0 ? `  未決済${pendingN}件` : "";
    console.log("ROI（参考）");
    console.log(`  BUY ${s.n}件（決済済${s.settledN}件${pendingStr}）`);
    if (s.settledN > 0) {
      console.log(`  ROI=${fmt(s.roi)}  roiExMax=${fmt(s.roiExMax)}  的中${s.hits}件  最大払戻${s.maxHitOdds || "-"}倍`);
    } else {
      console.log("  ROI=- (決済済みなし)");
    }
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

  // --- 今日のBUY候補 + Kelly fraction ---
  if (report.todayBuyCandidates.length > 0) {
    console.log("");
    console.log(`今日のBUY候補 (${todayJst()}) ─ Kelly: (EV-1)/(odds-1)`);
    for (const c of report.todayBuyCandidates) {
      const odds = c.current_odds;
      const ev = c.ev;
      const kelly = (odds != null && ev != null && odds > 1)
        ? ((ev - 1) / (odds - 1) * 100).toFixed(2) + "%"
        : "-";
      const resultStr = c.result ? ` [${c.result}]` : "";
      const popStr = c.selection_popularity != null ? `  pop=${String(c.selection_popularity).padStart(3)}位` : "";
      console.log(
        `  ${c.venue} R${String(c.race_no).padStart(2, "0")}  ${c.selection.padEnd(7)}` +
        `  odds=${odds != null ? odds.toFixed(1).padStart(6) : "    -"}  EV=${ev != null ? ev.toFixed(2) : "-"}  Kelly=${kelly.padStart(7)}${popStr}${resultStr}`
      );
    }
  }
}

function milestoneFor(n: number, roi: number | null) {
  if (n < 300) return "insufficient: n<300, ROI is not actionable";
  if (n < 600) return roi !== null && roi < 0.75 ? "watch: withdrawal candidate" : "watch: continue monitoring";
  if (n < 1000) return "conditional: require ROI>1.2 and monthly stability";
  return "near-confirmed: require roiExMax>1.0";
}

function historicalBuyPace(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT substr(date, 1, 7) AS ym, COUNT(*) AS n
    FROM decision_history
    WHERE model_version = ?
      AND decision = 'BUY'
      AND date BETWEEN '2024-01-01' AND '2025-12-31'
    GROUP BY ym
    ORDER BY ym
  `).all(LIVE_MODEL) as Array<{ ym: string; n: number }>;

  const counts = rows.map((row) => numberValue(row.n)).filter((n) => n > 0);
  const sorted = [...counts].sort((a, b) => a - b);
  const sum = counts.reduce((acc, n) => acc + n, 0);
  const averagePerMonth = counts.length > 0 ? sum / counts.length : 0;
  const medianPerMonth =
    sorted.length > 0 ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : 0;
  const minPerMonth = sorted[0] ?? 0;

  return {
    source: "2024-2025 v3 BUY months",
    months: counts.length,
    total: sum,
    averagePerMonth: round1(averagePerMonth),
    medianPerMonth: round1(medianPerMonth),
    minPerMonth,
    maxPerMonth: sorted.at(-1) ?? 0,
  };
}

function liveBuyPace(rows: Array<{ date: string; buy_n: number }>) {
  const observedDays = rows.length;
  const buyN = rows.reduce((acc, row) => acc + numberValue(row.buy_n), 0);
  return {
    observedDays,
    buyN,
    ratePerDay: observedDays > 0 ? round2(buyN / observedDays) : 0,
  };
}

function buyEta(n: number, liveRatePerDay: number, historical: ReturnType<typeof historicalBuyPace>) {
  const remaining = Math.max(0, TARGET_BUY_N - n);
  return {
    targetN: TARGET_BUY_N,
    remaining,
    liveDaysLeft: liveRatePerDay > 0 ? Math.ceil(remaining / liveRatePerDay) : null,
    historicalMedianDaysLeft: daysLeftFromMonthlyPace(remaining, historical.medianPerMonth),
    historicalAverageDaysLeft: daysLeftFromMonthlyPace(remaining, historical.averagePerMonth),
    historicalMinDaysLeft: daysLeftFromMonthlyPace(remaining, historical.minPerMonth),
  };
}

function daysLeftFromMonthlyPace(remaining: number, monthlyPace: number) {
  return monthlyPace > 0 ? Math.ceil(remaining / (monthlyPace / 30.4375)) : null;
}

function buildAlerts(input: {
  buyN: number;
  paperDays: Array<{ date: string; buy_n: number; watch_n: number; total_n: number }>;
  watchBuyN: number;
  watchBuyOddsMissing: number;
  latestModelDecisionDate: string | null;
  latestOddsSnapshotDate: string | null;
}) {
  const alerts: Array<{ level: "info" | "warn" | "critical"; code: string; message: string }> = [];
  const zeroDays = consecutiveZeroBuyDays(input.paperDays);

  if (input.buyN === 0 && zeroDays >= 7) {
    alerts.push({
      level: "critical",
      code: "buy_zero_7d",
      message: `BUYが${zeroDays}日連続0件です。取得タイミング・BUY条件・保存条件を点検してください。`,
    });
  } else if (input.buyN === 0 && zeroDays >= 3) {
    alerts.push({
      level: "warn",
      code: "buy_zero_3d",
      message: `BUYが${zeroDays}日連続0件です。数日継続するならライブ条件の厳しさを確認します。`,
    });
  } else if (input.buyN === 0 && input.watchBuyN > 0) {
    alerts.push({
      level: "info",
      code: "watch_present_buy_zero",
      message: `WATCH/BUY候補は${input.watchBuyN}件ありますがBUYはまだ0件です。初期日は観察継続で十分です。`,
    });
  }

  if (input.watchBuyN > 0 && input.watchBuyOddsMissing > 0) {
    alerts.push({
      level: "warn",
      code: "watch_buy_odds_missing",
      message: `WATCH/BUY候補のオッズ未取得が${input.watchBuyOddsMissing}件あります。auto-oddsログを確認してください。`,
    });
  }

  if (input.latestModelDecisionDate !== input.latestOddsSnapshotDate) {
    alerts.push({
      level: "info",
      code: "latest_date_mismatch",
      message: `最新判定日=${input.latestModelDecisionDate ?? "-"}、最新オッズ日=${input.latestOddsSnapshotDate ?? "-"}です。`,
    });
  }

  return alerts;
}

function consecutiveZeroBuyDays(rows: Array<{ buy_n: number }>) {
  let count = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (numberValue(rows[i].buy_n) === 0) count += 1;
    else break;
  }
  return count;
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

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
