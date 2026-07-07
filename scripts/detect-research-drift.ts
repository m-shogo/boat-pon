/**
 * Drift Detection 最小CLI（read-only / Phase 4, --presentation-json は Phase 4.1）
 *
 * decision_history を baseline期間とrecent期間の2つの窓に分けて集計し、
 * それぞれを RuleEvaluationResult（src/domain/researchRule.ts）に変換したうえで
 * DriftDetectionResult（src/domain/researchDrift.ts）を出力する。
 *
 * - scripts/explore-roi.ts と同じくDB/テーブルが無い環境でも空評価+warningsで正常終了する
 * - DBへの書き込みは一切行わない（読み込み専用、PRAGMA readOnlyで接続）
 * - data/research-rules.json は --rule-id 指定時に read-only で参照するだけ（Phase 4.1）。
 *   一致するruleがあればtitle/statusを表示情報に添えるのみで、書き換えは一切行わない。
 *   一致しなければ引き続きadhoc ruleとして動く
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DecisionHistoryRow } from "../src/domain/backtest";
import type { DecisionStatus } from "../src/domain/types";
import { applyCondition, buildRuleEvaluationResult, parseCondition, type RowCondition } from "../src/domain/researchEvaluation";
import { buildDriftDetectionResult } from "../src/domain/researchDrift";
import type { ResearchRule } from "../src/domain/researchRule";
import { buildDriftDetectionViewModel } from "../src/view-models/driftViewModel.adapters";
import { buildDriftPresentation } from "../src/presentation/driftPresentationBuilder";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const RULE_STORE_PATH = process.env.BOAT_PON_RULE_STORE_PATH ?? "data/research-rules.json";
const evaluatedAt = new Date().toISOString();
const args = parseArgs(process.argv.slice(2));

const baseline = evaluateWindow(args.baselineFrom, args.baselineTo, "baseline");
const recent = evaluateWindow(args.recentFrom, args.recentTo, "recent");

const result = buildDriftDetectionResult(args.ruleId, baseline, recent, evaluatedAt);
const ruleMeta = loadRuleMeta(args.ruleId);

if (args.presentationJson) {
  const view = buildDriftDetectionViewModel(result, ruleMeta);
  console.log(JSON.stringify(buildDriftPresentation(view), null, 2));
} else if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printResult();
}

/**
 * data/research-rules.json（read-only）から ruleId 一致のルールを探すだけの関数。
 * ファイルが無い/パースできない/一致しない場合は undefined を返し、呼び出し側は
 * adhoc rule（title/statusなし）として扱う。書き込みは一切行わない。
 */
function loadRuleMeta(ruleId: string): Pick<ResearchRule, "title" | "status"> | undefined {
  if (!existsSync(RULE_STORE_PATH)) return undefined;
  try {
    const store = JSON.parse(readFileSync(RULE_STORE_PATH, "utf8")) as { rules?: ResearchRule[] };
    const rule = store.rules?.find((r) => r.ruleId === ruleId);
    if (!rule) return undefined;
    return { title: rule.title, status: rule.status };
  } catch {
    return undefined;
  }
}

function evaluateWindow(from: string, to: string, label: "baseline" | "recent") {
  const { rows: loadedRows, sourceWarnings } = loadRows(from, to);
  let rows = loadedRows;
  const conditionWarnings: string[] = [];
  if (args.condition) {
    const filtered = applyCondition(rows, args.condition);
    rows = filtered.rows;
    conditionWarnings.push(...filtered.warnings);
  }
  return buildRuleEvaluationResult({
    ruleId: args.ruleId,
    rows,
    dataWindowStart: from,
    dataWindowEnd: to,
    evaluationRunAt: evaluatedAt,
    conditionLabel: args.condition ? `${args.condition.key}=${args.condition.value}` : undefined,
    extraWarnings: [`${label} window`, ...sourceWarnings, ...conditionWarnings],
  });
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

function printResult() {
  console.log("=== Drift detector (read-only) ===");
  console.log(`ruleId: ${result.ruleId}`);
  console.log(`baseline: ${result.baselineWindow.dataWindowStart} .. ${result.baselineWindow.dataWindowEnd} (n=${result.baselineSampleSize}, roi=${(result.baselineRoi * 100).toFixed(2)}%, hitRate=${(result.baselineHitRate * 100).toFixed(2)}%)`);
  console.log(`recent:   ${result.recentWindow.dataWindowStart} .. ${result.recentWindow.dataWindowEnd} (n=${result.recentSampleSize}, roi=${(result.recentRoi * 100).toFixed(2)}%, hitRate=${(result.recentHitRate * 100).toFixed(2)}%)`);
  console.log(`roiDelta: ${(result.roiDelta * 100).toFixed(2)}pt / hitRateDelta: ${(result.hitRateDelta * 100).toFixed(2)}pt`);
  console.log(`severity: ${result.severity}`);
  if (result.signals.length) {
    console.log("signals:");
    for (const signal of result.signals) console.log(`  - [${signal.severity}] ${signal.id}: ${signal.message}`);
  }
  if (result.warnings.length) {
    console.log("warnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
}

function parseArgs(argv: string[]) {
  const parsed: {
    baselineFrom: string;
    baselineTo: string;
    recentFrom: string;
    recentTo: string;
    ruleId: string;
    json: boolean;
    presentationJson: boolean;
    condition?: RowCondition;
  } = {
    baselineFrom: "1970-01-01",
    baselineTo: "1970-01-01",
    recentFrom: "1970-01-01",
    recentTo: evaluatedAtDate(),
    ruleId: "detect-drift-adhoc",
    json: false,
    presentationJson: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // `pnpm detect:drift -- --json` forwards this separator as-is on some pnpm versions
    if (arg === "--json") parsed.json = true;
    else if (arg === "--presentation-json") parsed.presentationJson = true;
    else if (arg === "--baseline-from") parsed.baselineFrom = argv[++i] ?? parsed.baselineFrom;
    else if (arg === "--baseline-to") parsed.baselineTo = argv[++i] ?? parsed.baselineTo;
    else if (arg === "--recent-from") parsed.recentFrom = argv[++i] ?? parsed.recentFrom;
    else if (arg === "--recent-to") parsed.recentTo = argv[++i] ?? parsed.recentTo;
    else if (arg === "--rule-id") parsed.ruleId = argv[++i] ?? parsed.ruleId;
    else if (arg === "--condition") parsed.condition = parseCondition(argv[++i] ?? "");
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function evaluatedAtDate(): string {
  return evaluatedAt.slice(0, 10);
}

function printHelp() {
  console.log(`Usage:
  pnpm detect:drift [-- --baseline-from YYYY-MM-DD --baseline-to YYYY-MM-DD \\
                        --recent-from YYYY-MM-DD --recent-to YYYY-MM-DD \\
                        --rule-id <id> --condition key=value --json|--presentation-json]

Read-only. Compares two decision_history windows (baseline vs recent) as
RuleEvaluationResult and reports a DriftDetectionResult (roi/hitRate delta,
severity, signals, warnings). Does not write to the DB or to any rule store.

  --baseline-from     baseline window start (default 1970-01-01)
  --baseline-to       baseline window end (default 1970-01-01; must be set explicitly)
  --recent-from       recent window start (default 1970-01-01)
  --recent-to         recent window end (default today)
  --rule-id           ruleId label in output (default detect-drift-adhoc). If this
                      ruleId exists in data/research-rules.json (read-only lookup,
                      never written to), its title/status are attached to the
                      display output; otherwise this stays an adhoc rule
  --condition         single key=value row filter (supported keys: venue, raceNo, decision)
  --json              emit DriftDetectionResult JSON (unchanged Phase 4 shape)
  --presentation-json emit DriftDetectionPresentation JSON (Phase 4.1, renderer-ready
                      shape: severityLabel, ruleTitle/ruleStatus, same numbers as --json)`);
}
