/**
 * Daily Research Report 最小CLI（read-only / Phase 5, --rules-file は Phase 5.1）
 *
 * decision_history を1日1回分の研究レポートとしてまとめる。ROI Explorer
 * （src/domain/researchEvaluation.ts の buildRuleEvaluationResult）とDrift Detection
 * （src/domain/researchDrift.ts の buildDriftDetectionResult）の結果を、そのまま
 * src/domain/dailyResearchReport.ts の buildDailyResearchReport / buildMultiRuleDailyResearchReport
 * へ渡して要約するだけで、ROI/Drift計算そのものはやり直さない。
 *
 * - explore-roi.ts / detect-research-drift.ts と同じくDB/テーブルが無い環境でも
 *   空評価+warningsで正常終了する
 * - DBへの書き込みは一切行わない（読み込み専用、PRAGMA readOnlyで接続）
 * - reports/* への自動出力はしない。標準出力にJSONを出すだけ
 * - --rules-file <path> は data/research-rules.json 形式（{ rules: ResearchRule[] }）の
 *   ファイルを read-only で読み込むだけ。書き込みは一切行わない。指定しない場合は
 *   従来通り単一のadhocレポート（ruleId固定）のまま動く。指定してもファイルが無い場合は
 *   警告を出してadhocレポートにフォールバックする
 * - archivedステータスのルールは初期状態では集計から除外する（Phase 5.2以降で
 *   --include-archivedを検討、今回は未実装。docs/ai/11-DAILY-RESEARCH-REPORT.md参照）
 * - これは研究レポートであり、買い推奨・Production昇格の判断ではない
 *   （docs/ai/11-DAILY-RESEARCH-REPORT.md参照）
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DecisionHistoryRow } from "../src/domain/backtest";
import type { DecisionStatus } from "../src/domain/types";
import type { ResearchRule } from "../src/domain/researchRule";
import { buildRuleEvaluationResult } from "../src/domain/researchEvaluation";
import { buildDriftDetectionResult } from "../src/domain/researchDrift";
import { buildDailyResearchReport, buildMultiRuleDailyResearchReport } from "../src/domain/dailyResearchReport";
import { buildDriftDetectionViewModel } from "../src/view-models/driftViewModel.adapters";
import { buildDailyResearchReportAggregatePresentation, buildDailyResearchReportPresentation } from "../src/presentation/dailyResearchReportBuilder";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const RULE_ID = "daily-research-report-adhoc";
const RECENT_WINDOW_DAYS = 30;

const generatedAt = new Date().toISOString();
const args = parseArgs(process.argv.slice(2));
const reportDate = args.date ?? generatedAt.slice(0, 10);

const recentTo = reportDate;
const recentFrom = shiftDate(reportDate, -RECENT_WINDOW_DAYS);
const baselineTo = shiftDate(recentFrom, -1);
const baselineFrom = "1970-01-01";

const roiEvaluation = evaluateRoiWindow("1970-01-01", reportDate);
const baselineEvaluation = evaluateDriftWindow(baselineFrom, baselineTo, "baseline");
const recentEvaluation = evaluateDriftWindow(recentFrom, recentTo, "recent");
const driftResult = buildDriftDetectionResult(RULE_ID, baselineEvaluation, recentEvaluation, generatedAt);

const rules = args.rulesFile ? loadRulesFile(args.rulesFile) : undefined;

if (rules) {
  runMultiRule(rules);
} else {
  runSingleAdhoc();
}

function runSingleAdhoc() {
  const report = buildDailyResearchReport({ reportDate, generatedAt, roiEvaluation, driftResult });

  if (args.presentationJson) {
    const driftView = buildDriftDetectionViewModel(driftResult);
    console.log(JSON.stringify(buildDailyResearchReportPresentation(report, driftView), null, 2));
  } else if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSingleResult(report);
  }
}

function runMultiRule(rulesList: ResearchRule[]) {
  const aggregate = buildMultiRuleDailyResearchReport({
    reportDate,
    generatedAt,
    rules: rulesList.map((rule) => ({
      ruleId: rule.ruleId,
      title: rule.title,
      status: rule.status,
      roiEvaluation,
      driftResult,
    })),
  });

  if (args.presentationJson) {
    const driftViews = aggregate.ruleReports.map((ruleReport, index) =>
      buildDriftDetectionViewModel(
        { ...driftResult, ruleId: ruleReport.ruleId },
        { title: rulesList[index].title, status: rulesList[index].status },
      ),
    );
    console.log(JSON.stringify(buildDailyResearchReportAggregatePresentation(aggregate, driftViews), null, 2));
  } else if (args.json) {
    console.log(JSON.stringify(aggregate, null, 2));
  } else {
    printMultiRuleResult(aggregate);
  }
}

/**
 * data/research-rules.json 形式のファイルを read-only で読み込む。書き込みは一切行わない。
 * ファイルが無い/パースできない場合は undefined を返し、呼び出し側はadhocレポートへ
 * フォールバックする。archivedステータスのルールは初期状態では除外する。
 */
function loadRulesFile(path: string): ResearchRule[] | undefined {
  if (!existsSync(path)) {
    console.error(`--rules-file "${path}" not found; falling back to a single adhoc report`);
    return undefined;
  }
  try {
    const store = JSON.parse(readFileSync(path, "utf8")) as { rules?: ResearchRule[] };
    const rules = store.rules ?? [];
    return rules.filter((rule) => rule.status !== "archived");
  } catch (error) {
    console.error(`--rules-file "${path}" could not be parsed (${(error as Error).message}); falling back to a single adhoc report`);
    return undefined;
  }
}

function evaluateRoiWindow(from: string, to: string) {
  const { rows, sourceWarnings } = loadRows(from, to);
  return buildRuleEvaluationResult({
    ruleId: RULE_ID,
    rows,
    dataWindowStart: from,
    dataWindowEnd: to,
    evaluationRunAt: generatedAt,
    extraWarnings: sourceWarnings,
  });
}

function evaluateDriftWindow(from: string, to: string, label: "baseline" | "recent") {
  const { rows, sourceWarnings } = loadRows(from, to);
  return buildRuleEvaluationResult({
    ruleId: RULE_ID,
    rows,
    dataWindowStart: from,
    dataWindowEnd: to,
    evaluationRunAt: generatedAt,
    extraWarnings: [`${label} window`, ...sourceWarnings],
  });
}

function shiftDate(dateStr: string, offsetDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function loadRows(from: string, to: string): { rows: DecisionHistoryRow[]; sourceWarnings: string[] } {
  if (!existsSync(DB_PATH)) {
    return { rows: [], sourceWarnings: [`db not found at ${DB_PATH}; produced empty evaluation`] };
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decision_history'").get() != null;
    if (!hasTable) {
      return { rows: [], sourceWarnings: ["decision_history table not found; produced empty evaluation"] };
    }

    const raw = db.prepare(`
SELECT id, race_id, date, venue, race_no, selection, estimated_hit_rate, required_odds, current_odds,
       ev, decision, actually_bought, stake_yen, recommended_stake_yen, sample_size,
       result, payout_yen, popularity, returned, source, fetched_at, created_at
FROM decision_history
WHERE date >= ? AND date <= ?
ORDER BY date, id
`).all(from, to) as Array<Record<string, unknown>>;

    const rows = raw.map((row): DecisionHistoryRow => ({
      id: Number(row.id),
      raceId: String(row.race_id),
      date: String(row.date),
      venue: String(row.venue),
      raceNo: Number(row.race_no),
      selection: String(row.selection),
      estimatedHitRate: Number(row.estimated_hit_rate),
      requiredOdds: Number(row.required_odds),
      currentOdds: row.current_odds == null ? null : Number(row.current_odds),
      ev: row.ev == null ? null : Number(row.ev),
      decision: String(row.decision) as DecisionStatus,
      actuallyBought: Boolean(row.actually_bought),
      stakeYen: Number(row.stake_yen ?? 0),
      recommendedStakeYen: Number(row.recommended_stake_yen ?? 0),
      sampleSize: Number(row.sample_size ?? 0),
      result: row.result == null ? null : String(row.result),
      payoutYen: row.payout_yen == null ? null : Number(row.payout_yen),
      popularity: row.popularity == null ? null : Number(row.popularity),
      returned: Boolean(row.returned),
      source: String(row.source ?? ""),
      fetchedAt: String(row.fetched_at ?? ""),
      createdAt: String(row.created_at ?? ""),
    }));
    return { rows, sourceWarnings: [] };
  } finally {
    db.close();
  }
}

function printSingleResult(report: ReturnType<typeof buildDailyResearchReport>) {
  console.log("=== Daily Research Report (read-only, not a buy recommendation) ===");
  console.log(`reportDate: ${report.metadata.reportDate}`);
  console.log(`generatedAt: ${report.metadata.generatedAt}`);
  console.log(`roi: ${(report.roiSummary.roi * 100).toFixed(2)}% (n=${report.roiSummary.sampleSize}, forwardTested=${report.roiSummary.isForwardTested})`);
  console.log(`drift: severity=${report.driftSummary.severity} (baseline ${(report.driftSummary.baselineRoi * 100).toFixed(2)}% -> recent ${(report.driftSummary.recentRoi * 100).toFixed(2)}%)`);
  console.log("findings:");
  for (const finding of report.findings) console.log(`  - [${finding.severity}] ${finding.title}: ${finding.detail}`);
  console.log("nextActions:");
  for (const action of report.nextActions) console.log(`  - ${action}`);
  if (report.dataQualityNotes.length) {
    console.log("dataQualityNotes:");
    for (const note of report.dataQualityNotes) console.log(`  - ${note}`);
  }
  if (report.warnings.length) {
    console.log("warnings:");
    for (const warning of report.warnings) console.log(`  - ${warning.message}`);
  }
}

function printMultiRuleResult(aggregate: ReturnType<typeof buildMultiRuleDailyResearchReport>) {
  console.log("=== Daily Research Report: multi-rule (read-only, not a buy recommendation) ===");
  console.log(`reportDate: ${aggregate.metadata.reportDate}`);
  console.log(`generatedAt: ${aggregate.metadata.generatedAt}`);
  console.log(
    `summary: totalRules=${aggregate.summary.totalRules} critical=${aggregate.summary.criticalDriftCount} ` +
    `warning=${aggregate.summary.warningDriftCount} unknown=${aggregate.summary.unknownDriftCount} ` +
    `forwardUntested=${aggregate.summary.forwardUntestedCount} nonProduction=${aggregate.summary.nonProductionStatusCount}`,
  );
  for (const ruleReport of aggregate.ruleReports) {
    console.log(`--- ${ruleReport.ruleId} (status=${ruleReport.status ?? "n/a"}, title=${ruleReport.title ?? "n/a"}) ---`);
    console.log(`  drift severity=${ruleReport.driftSummary.severity}`);
    for (const finding of ruleReport.findings) console.log(`  - [${finding.severity}] ${finding.title}: ${finding.detail}`);
  }
  console.log("overallNextActions:");
  for (const action of aggregate.overallNextActions) console.log(`  - ${action}`);
}

function parseArgs(argv: string[]) {
  const parsed: { date?: string; json: boolean; presentationJson: boolean; rulesFile?: string } = {
    json: false,
    presentationJson: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // `pnpm daily:research-report -- --json` forwards this separator as-is on some pnpm versions
    if (arg === "--json") parsed.json = true;
    else if (arg === "--presentation-json") parsed.presentationJson = true;
    else if (arg === "--date") parsed.date = argv[++i];
    else if (arg === "--rules-file") parsed.rulesFile = argv[++i];
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm daily:research-report [-- --date YYYY-MM-DD --json|--presentation-json]
  pnpm daily:research-report [-- --date YYYY-MM-DD --rules-file <path> --json|--presentation-json]

Read-only. Summarizes ROI Explorer (all-time up to --date) and Drift Detection
(baseline: all-time before the recent window; recent: the ${RECENT_WINDOW_DAYS} days
ending at --date) into a DailyResearchReport. This is a research report, not a
buy recommendation or a production-promotion decision.

  --date              report date (default today, UTC)
  --rules-file        path to a research-rules.json-shaped file ({ rules: ResearchRule[] }),
                      read-only. Every non-archived rule gets the same shared ROI/Drift
                      evaluation, labeled with its ruleId/title/status (Phase 5.1: rules do
                      not yet store a queryable filter condition, so this is NOT a per-rule
                      filtered evaluation — see docs/ai/11-DAILY-RESEARCH-REPORT.md). Missing
                      or unparsable file falls back to the single adhoc report unchanged.
                      Without this flag, behavior is unchanged from Phase 5 (single adhoc report).
  --json              emit DailyResearchReport JSON (domain shape), or
                      DailyResearchReportAggregate JSON when --rules-file is given
  --presentation-json emit DailyResearchReportPresentation JSON (renderer-ready,
                      reuses the existing DriftDetectionPresentation for driftSummary), or
                      DailyResearchReportAggregatePresentation JSON when --rules-file is given

If both --json and --presentation-json are passed, --presentation-json wins.

Not implemented yet (Phase 5.2 candidate): --include-archived to include archived rules.`);
}
