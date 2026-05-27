import { DatabaseSync } from "node:sqlite";
import { DEFAULT_APP_RULE } from "../src/domain/decision";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { ODDS_FETCH_WINDOW_MINUTES, minutesUntilRaceClose } from "../src/domain/livePersistence";
import type { BudgetRule } from "../src/domain/types";

const DB_PATH = "data/boat.sqlite";
const DEFAULT_LIMIT = 20;
const TARGET_BUY_N = 300;

const args = parseArgs(process.argv.slice(2));
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  const report = buildReport(db);
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    printReport(report);
  }
} finally {
  db.close();
}

function buildReport(db: DatabaseSync) {
  const settings = readSettings(db);
  const now = new Date();

  const decisionCounts = db.prepare(`
    SELECT
      decision,
      COUNT(*) AS n,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      SUM(CASE WHEN current_odds IS NOT NULL AND required_odds IS NOT NULL AND current_odds < required_odds THEN 1 ELSE 0 END) AS odds_below_required,
      SUM(CASE WHEN current_odds IS NOT NULL AND required_odds IS NOT NULL AND current_odds >= required_odds THEN 1 ELSE 0 END) AS odds_at_or_above_required
    FROM decision_history
    WHERE date = ? AND model_version = ?
    GROUP BY decision
    ORDER BY decision
  `).all(args.date, LIVE_MONITOR_MODEL_VERSION) as DecisionCountRow[];

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
      SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
      SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) AS odds_missing,
      SUM(CASE WHEN current_odds IS NOT NULL THEN 1 ELSE 0 END) AS odds_present,
      SUM(CASE WHEN decision = 'SKIP' AND current_odds IS NOT NULL AND required_odds IS NOT NULL AND current_odds >= required_odds THEN 1 ELSE 0 END) AS skip_at_or_above_required
    FROM decision_history
    WHERE date = ? AND model_version = ?
  `).get(args.date, LIVE_MONITOR_MODEL_VERSION) as TodayTotalsRow;

  const programTotal = numberValue(
    (db.prepare("SELECT COUNT(*) AS n FROM official_programs WHERE date = ?").get(args.date) as { n: number }).n,
  );

  const oddsSummary = db.prepare(`
    SELECT
      COUNT(*) AS snapshots,
      COUNT(DISTINCT race_id) AS races,
      MAX(captured_at) AS latest_captured_at
    FROM odds_snapshots
    WHERE substr(captured_at, 1, 10) = ?
  `).get(args.date) as { snapshots: number; races: number; latest_captured_at: string | null };

  const windowRows = db.prepare(`
    SELECT race_id, venue, race_no, close_at
    FROM official_programs
    WHERE date = ?
    ORDER BY close_at, venue, race_no
  `).all(args.date) as ProgramWindowRow[];

  const windows = summarizeWindows(windowRows, settings, now);
  const nearMisses = readNearMisses(db, settings, now);
  const nearMissSummary = summarizeNearMisses(db, settings, now);
  const nearMissHidden = countWatchBuy(db) - nearMisses.length;
  const skipAboveRequired = readSkipAboveRequired(db, settings, now);
  const selectionDistribution = readSelectionDistribution(db);
  const alerts = buildAlerts({ totals, oddsSummary, programTotal, windows, nearMissSummary });

  return {
    generatedAt: now.toISOString(),
    date: args.date,
    model: LIVE_MONITOR_MODEL_VERSION,
    settings: {
      minMinutesBeforeClose: settings.minMinutesBeforeClose,
      fetchWindowMinutes: ODDS_FETCH_WINDOW_MINUTES,
      targetBuyN: TARGET_BUY_N,
    },
    programs: {
      total: programTotal,
      windows,
    },
    odds: {
      snapshots: numberValue(oddsSummary.snapshots),
      races: numberValue(oddsSummary.races),
      latestCapturedAt: oddsSummary.latest_captured_at,
      raceCoveragePct: programTotal > 0 ? round3(numberValue(oddsSummary.races) / programTotal) : null,
    },
    decisions: normalizeTotals(totals),
    decisionCounts,
    nearMissSummary,
    nearMisses,
    nearMissHidden: Math.max(0, nearMissHidden),
    skipAtOrAboveRequired: skipAboveRequired,
    selectionDistribution,
    alerts,
    action: actionFor({ totals, nearMissSummary, oddsSummary, programTotal }),
  };
}

function readNearMisses(db: DatabaseSync, settings: BudgetRule, now: Date) {
  const rows = db.prepare(`
    SELECT
      dh.race_id,
      dh.venue,
      dh.race_no,
      dh.decision,
      dh.selection,
      dh.current_odds,
      dh.required_odds,
      dh.ev,
      dh.sample_size,
      dh.race_category,
      op.close_at,
      (
        SELECT MAX(os.captured_at)
        FROM odds_snapshots os
        WHERE os.race_id = dh.race_id AND os.selection = dh.selection
      ) AS latest_snapshot_at
    FROM decision_history dh
    LEFT JOIN official_programs op ON op.race_id = dh.race_id
    WHERE dh.date = ?
      AND dh.model_version = ?
      AND dh.decision IN ('WATCH', 'BUY')
    ORDER BY
      CASE dh.decision WHEN 'BUY' THEN 0 ELSE 1 END,
      CASE
        WHEN dh.current_odds IS NULL OR dh.required_odds IS NULL THEN 999999
        ELSE ABS(dh.required_odds - dh.current_odds)
      END,
      dh.race_id
    LIMIT ?
  `).all(args.date, LIVE_MONITOR_MODEL_VERSION, args.limit) as CandidateRow[];

  return rows.map((row) => enrichCandidate(row, settings, now)) as EnrichedCandidateRow[];
}

function summarizeNearMisses(db: DatabaseSync, settings: BudgetRule, now: Date) {
  const rows = db.prepare(`
    SELECT
      dh.current_odds,
      dh.required_odds,
      op.close_at
    FROM decision_history dh
    LEFT JOIN official_programs op ON op.race_id = dh.race_id
    WHERE dh.date = ? AND dh.model_version = ? AND dh.decision = 'WATCH'
  `).all(args.date, LIVE_MONITOR_MODEL_VERSION) as Array<{
    current_odds: number | null;
    required_odds: number | null;
    close_at: string | null;
  }>;

  let within0_5 = 0;
  let within1_0 = 0;
  let within2_0 = 0;
  let openWithin1_0 = 0;
  let minGap: number | null = null;

  for (const row of rows) {
    const current = nullableNumber(row.current_odds);
    const required = nullableNumber(row.required_odds);
    if (current === null || required === null || current >= required) continue;

    const gap = required - current;
    minGap = minGap === null ? gap : Math.min(minGap, gap);
    if (gap <= 0.5) within0_5 += 1;
    if (gap <= 1.0) {
      within1_0 += 1;
      if (closeStatus(row.close_at, settings, now).status !== "closed") openWithin1_0 += 1;
    }
    if (gap <= 2.0) within2_0 += 1;
  }

  return { watchN: rows.length, within0_5, within1_0, within2_0, openWithin1_0, minGap };
}

function readSkipAboveRequired(db: DatabaseSync, settings: BudgetRule, now: Date) {
  const rows = db.prepare(`
    SELECT
      dh.race_id,
      dh.venue,
      dh.race_no,
      dh.selection,
      dh.current_odds,
      dh.required_odds,
      dh.ev,
      dh.sample_size,
      dh.race_category,
      op.close_at
    FROM decision_history dh
    LEFT JOIN official_programs op ON op.race_id = dh.race_id
    WHERE dh.date = ?
      AND dh.model_version = ?
      AND dh.decision = 'SKIP'
      AND dh.current_odds IS NOT NULL
      AND dh.required_odds IS NOT NULL
      AND dh.current_odds >= dh.required_odds
    ORDER BY dh.current_odds - dh.required_odds DESC, dh.race_id
    LIMIT 10
  `).all(args.date, LIVE_MONITOR_MODEL_VERSION) as CandidateRow[];

  return rows.map((row) => enrichCandidate(row, settings, now)) as EnrichedCandidateRow[];
}

function countWatchBuy(db: DatabaseSync) {
  return numberValue((db.prepare(`
    SELECT COUNT(*) AS n
    FROM decision_history
    WHERE date = ? AND model_version = ? AND decision IN ('WATCH', 'BUY')
  `).get(args.date, LIVE_MONITOR_MODEL_VERSION) as { n: number }).n);
}

function readSelectionDistribution(db: DatabaseSync) {
  return db.prepare(`
    SELECT
      selection,
      SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
      SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
      COUNT(*) AS total
    FROM decision_history
    WHERE date = ? AND model_version = ?
    GROUP BY selection
    ORDER BY total DESC, selection
    LIMIT 10
  `).all(args.date, LIVE_MONITOR_MODEL_VERSION) as SelectionDistributionRow[];
}

function summarizeWindows(rows: ProgramWindowRow[], settings: BudgetRule, now: Date) {
  const summary = {
    closed: 0,
    inWindow: 0,
    tooEarly: 0,
    tooLate: 0,
    noCloseAt: 0,
    nextInWindowAt: null as string | null,
    nextCloseAt: null as string | null,
  };

  for (const row of rows) {
    if (!row.close_at) {
      summary.noCloseAt += 1;
      continue;
    }

    const minutes = minutesUntilRaceClose(args.date, row.close_at, now);
    if (minutes < 0) {
      summary.closed += 1;
    } else if (minutes < settings.minMinutesBeforeClose) {
      summary.tooLate += 1;
    } else if (minutes <= ODDS_FETCH_WINDOW_MINUTES) {
      summary.inWindow += 1;
    } else {
      summary.tooEarly += 1;
      const startAt = minutesBeforeClose(args.date, row.close_at, ODDS_FETCH_WINDOW_MINUTES);
      if (summary.nextInWindowAt === null || startAt < summary.nextInWindowAt) {
        summary.nextInWindowAt = startAt;
      }
    }

    if (minutes >= 0 && (summary.nextCloseAt === null || `${args.date}T${row.close_at}:00+09:00` < summary.nextCloseAt)) {
      summary.nextCloseAt = `${args.date}T${row.close_at}:00+09:00`;
    }
  }

  return summary;
}

function buildAlerts(input: {
  totals: TodayTotalsRow;
  oddsSummary: { races: number };
  programTotal: number;
  windows: ReturnType<typeof summarizeWindows>;
  nearMissSummary: ReturnType<typeof summarizeNearMisses>;
}) {
  const alerts: AlertRow[] = [];
  const totals = normalizeTotals(input.totals);

  if (totals.total === 0 && input.programTotal > 0) {
    alerts.push({ level: "warn", code: "no_decisions", message: "番組はあるが当日の判定がまだありません" });
  }
  if (input.programTotal > 0 && numberValue(input.oddsSummary.races) === 0) {
    alerts.push({ level: "warn", code: "no_odds", message: "当日のオッズsnapshotがまだありません" });
  }
  if (totals.buy === 0 && totals.watch > 0) {
    alerts.push({ level: "info", code: "watch_present_buy_zero", message: "WATCHはあるがBUYは0です。境界差分を確認してください" });
  }
  if (input.nearMissSummary.within1_0 > 0) {
    alerts.push({
      level: "info",
      code: "near_buy_boundary",
      message: `BUY境界まで1.0倍以内のWATCHが${input.nearMissSummary.within1_0}件あります（未締切${input.nearMissSummary.openWithin1_0}件）`,
    });
  }
  if (totals.skipAtOrAboveRequired > 0) {
    alerts.push({ level: "info", code: "skip_despite_odds", message: `必要オッズ以上だがSKIPの行が${totals.skipAtOrAboveRequired}件あります` });
  }
  if (input.windows.inWindow > 0 && numberValue(input.oddsSummary.races) < input.programTotal) {
    alerts.push({ level: "info", code: "fetch_window_open", message: "取得窓に入っているレースがあります。次回auto-odds後に再確認してください" });
  }

  return alerts;
}

function actionFor(input: {
  totals: TodayTotalsRow;
  nearMissSummary: ReturnType<typeof summarizeNearMisses>;
  oddsSummary: { races: number };
  programTotal: number;
}) {
  const totals = normalizeTotals(input.totals);
  if (totals.total === 0) return "run readiness; no decision rows for the target date/model";
  if (input.programTotal > 0 && numberValue(input.oddsSummary.races) === 0) return "inspect auto-odds logs; programs exist but odds are absent";
  if (totals.buy > 0) return "review BUY rows; keep paper observation only";
  if (input.nearMissSummary.openWithin1_0 > 0) return "observe next odds refresh; open WATCH candidates are close to BUY boundary";
  if (input.nearMissSummary.within1_0 > 0) return "review closed near-misses; current open races are not yet within 1.0 odds";
  if (totals.watch > 0) return "observe; WATCH exists but market odds are still below required odds or blocked by rules";
  return "observe; no BUY/WATCH boundary pressure detected yet";
}

function printReport(report: ReturnType<typeof buildReport>) {
  console.log(`date: ${report.date}`);
  console.log(`model: ${report.model}`);
  console.log(
    `settings: fetch_window=${report.settings.fetchWindowMinutes}min min_before_close=${report.settings.minMinutesBeforeClose}min`,
  );
  console.log(
    `programs: total=${report.programs.total} closed=${report.programs.windows.closed} in_window=${report.programs.windows.inWindow} too_early=${report.programs.windows.tooEarly} next_window=${report.programs.windows.nextInWindowAt ?? "-"}`,
  );
  console.log(
    `odds: races=${report.odds.races}/${report.programs.total} coverage=${formatPct(report.odds.raceCoveragePct)} latest=${report.odds.latestCapturedAt ?? "-"}`,
  );
  console.log(
    `decisions: total=${report.decisions.total} BUY=${report.decisions.buy} WATCH=${report.decisions.watch} SKIP=${report.decisions.skip} odds_missing=${report.decisions.oddsMissing} skip_odds_ok=${report.decisions.skipAtOrAboveRequired}`,
  );
  console.log(
    `near_miss: WATCH=${report.nearMissSummary.watchN} cumulative<=0.5=${report.nearMissSummary.within0_5} <=1.0=${report.nearMissSummary.within1_0} <=2.0=${report.nearMissSummary.within2_0} open<=1.0=${report.nearMissSummary.openWithin1_0} min_gap=${formatNumber(report.nearMissSummary.minGap, 2)}`,
  );

  if (report.alerts.length > 0) {
    console.log("alerts:");
    for (const alert of report.alerts) {
      console.log(`  ${alert.level}\t${alert.code}\t${alert.message}`);
    }
  }

  if (report.nearMisses.length > 0) {
    console.log("watch_buy_boundary:");
    for (const row of report.nearMisses) {
      console.log(`  ${formatCandidate(row)}`);
    }
    if (report.nearMissHidden > 0) {
      console.log(`  ... ${report.nearMissHidden} hidden; rerun with --limit ${report.nearMissHidden + report.nearMisses.length}`);
    }
  }

  if (report.skipAtOrAboveRequired.length > 0) {
    console.log("skip_despite_odds:");
    for (const row of report.skipAtOrAboveRequired) {
      console.log(`  ${formatCandidate(row)}`);
    }
  }

  if (report.selectionDistribution.length > 0) {
    console.log("selection_distribution:");
    for (const row of report.selectionDistribution) {
      console.log(`  ${row.selection} total=${row.total} BUY=${row.buy} WATCH=${row.watch} SKIP=${row.skip}`);
    }
  }

  console.log(`action: ${report.action}`);
}

function formatCandidate(row: EnrichedCandidateRow) {
  return `${row.decision ?? "SKIP"} ${row.race_id} ${row.venue}${String(row.race_no).padStart(2, "0")} odds=${formatNumber(row.current_odds, 1)} req=${formatNumber(row.required_odds, 1)} gap=${formatNumber(row.gap, 2)} ratio=${formatNumber(row.ratioToRequired, 3)} close=${row.close_at ?? "-"} status=${row.closeStatus}`;
}

function readSettings(db: DatabaseSync): BudgetRule {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("budget_rule") as { value: string } | undefined;
  if (!row) return DEFAULT_APP_RULE;
  return { ...DEFAULT_APP_RULE, ...JSON.parse(row.value) };
}

function parseArgs(argv: string[]) {
  const dateIndex = argv.indexOf("--date");
  const limitIndex = argv.indexOf("--limit");
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : todayJst();
  const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : DEFAULT_LIMIT;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer");

  return {
    date,
    limit,
    json: argv.includes("--json"),
  };
}

function enrichCandidate<T extends CandidateRow>(row: T, settings: BudgetRule, now: Date) {
  const current = nullableNumber(row.current_odds);
  const required = nullableNumber(row.required_odds);
  const gap = current === null || required === null ? null : required - current;
  const status = closeStatus(row.close_at ?? null, settings, now);
  return {
    ...row,
    gap,
    ratioToRequired: current === null || required === null || required === 0 ? null : current / required,
    minutesUntilClose: status.minutesUntilClose,
    closeStatus: status.status,
  };
}

function closeStatus(closeAt: string | null, settings: BudgetRule, now: Date) {
  if (!closeAt) return { status: "no_close_at" as const, minutesUntilClose: null };
  const minutes = minutesUntilRaceClose(args.date, closeAt, now);
  if (minutes < 0) return { status: "closed" as const, minutesUntilClose: minutes };
  if (minutes < settings.minMinutesBeforeClose) return { status: "too_late" as const, minutesUntilClose: minutes };
  if (minutes <= ODDS_FETCH_WINDOW_MINUTES) return { status: "in_window" as const, minutesUntilClose: minutes };
  return { status: "too_early" as const, minutesUntilClose: minutes };
}

function normalizeTotals(row: TodayTotalsRow) {
  return {
    total: numberValue(row.total),
    buy: numberValue(row.buy),
    watch: numberValue(row.watch),
    skip: numberValue(row.skip),
    oddsMissing: numberValue(row.odds_missing),
    oddsPresent: numberValue(row.odds_present),
    skipAtOrAboveRequired: numberValue(row.skip_at_or_above_required),
  };
}

function minutesBeforeClose(date: string, closeAt: string, minutes: number) {
  const millis = new Date(`${date}T${closeAt}:00+09:00`).getTime() - minutes * 60_000;
  return formatJstIso(millis);
}

function formatJstIso(millis: number) {
  return `${new Date(millis + 9 * 3600_000).toISOString().slice(0, 19)}+09:00`;
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

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatNumber(value: number | null, digits: number) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function formatPct(value: number | null) {
  return value == null ? "-" : `${Math.round(value * 1000) / 10}%`;
}

type DecisionCountRow = {
  decision: string;
  n: number;
  odds_missing: number;
  odds_present: number;
  odds_below_required: number;
  odds_at_or_above_required: number;
};

type TodayTotalsRow = {
  total: number;
  buy: number;
  watch: number;
  skip: number;
  odds_missing: number;
  odds_present: number;
  skip_at_or_above_required: number;
};

type ProgramWindowRow = {
  race_id: string;
  venue: string;
  race_no: number;
  close_at: string;
};

type CandidateRow = {
  race_id: string;
  venue: string;
  race_no: number;
  decision?: string;
  selection: string;
  current_odds: number | null;
  required_odds: number | null;
  ev: number | null;
  sample_size: number | null;
  race_category: string | null;
  close_at?: string | null;
  latest_snapshot_at?: string | null;
};

type EnrichedCandidateRow = CandidateRow & {
  gap: number | null;
  ratioToRequired: number | null;
  minutesUntilClose: number | null;
  closeStatus: "closed" | "too_late" | "in_window" | "too_early" | "no_close_at";
};

type AlertRow = {
  level: "info" | "warn";
  code: string;
  message: string;
};

type SelectionDistributionRow = {
  selection: string;
  buy: number;
  watch: number;
  skip: number;
  total: number;
};
