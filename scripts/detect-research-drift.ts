/**
 * Drift Detection 最小CLI（read-only / Phase 4, --presentation-json は Phase 4.1）
 *
 * decision_history を baseline期間とrecent期間の2つの窓に分けて集計し、
 * それぞれを RuleEvaluationResult（src/domain/researchRule.ts）に変換したうえで
 * DriftDetectionResult（src/domain/researchDrift.ts）を出力する。
 *
 * - scripts/explore-roi.ts と同じくDB/テーブルが無い環境でも空評価+warningsで正常終了する
 * - DBへの書き込みは一切行わない（canonical identity検証 + readOnly + query_only）
 * - realized ROI は canonical race_payouts.payout_yen のみを使い、unsupported/ambiguous settlement は fail-close
 * - data/research-rules.json は --rule-id 指定時に read-only で参照するだけ（Phase 4.1）。
 *   一致するruleがあればtitle/statusを表示情報に添えるのみで、書き換えは一切行わない。
 *   一致しなければ引き続きadhoc ruleとして動く
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DecisionHistoryRow } from "../src/domain/backtest";
import type { DecisionStatus } from "../src/domain/types";
import { applyCondition, buildRuleEvaluationResult } from "../src/domain/researchEvaluation";
import { buildDriftDetectionResult } from "../src/domain/researchDrift";
import type { ResearchRule } from "../src/domain/researchRule";
import { parseDriftReportOptions } from "../src/research-replay/driftReportOptions";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import { buildDriftDetectionViewModel } from "../src/view-models/driftViewModel.adapters";
import { buildDriftPresentation } from "../src/presentation/driftPresentationBuilder";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const RULE_STORE_PATH = process.env.BOAT_PON_RULE_STORE_PATH ?? "data/research-rules.json";
const evaluatedAt = new Date().toISOString();
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}
const args = parseDriftReportOptions(rawArgs, evaluatedAt.slice(0, 10));

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

function payoutBetTypeSql(column: string): string {
  return `CASE ${column}
    WHEN '3連単' THEN 'trifecta'
    WHEN '3連複' THEN 'trio'
    WHEN '2連単' THEN 'exacta'
    WHEN '2連複' THEN 'quinella'
    WHEN '拡連複' THEN 'wide'
    WHEN 'trifecta' THEN 'trifecta'
    WHEN 'trio' THEN 'trio'
    WHEN 'exacta' THEN 'exacta'
    WHEN 'quinella' THEN 'quinella'
    WHEN 'wide' THEN 'wide'
    ELSE NULL
  END`;
}

function assertOfficialSettlementIntegrity(db: DatabaseSync, from: string, to: string): void {
  const row = db.prepare(`
WITH settled_buy AS (
  SELECT DISTINCT
    dh.race_id,
    dh.bet_type,
    ${payoutBetTypeSql("dh.bet_type")} AS payout_bet_type,
    dh.selection,
    dh.result
  FROM decision_history dh
  WHERE dh.date >= ? AND dh.date <= ?
    AND dh.decision = 'BUY'
    AND dh.returned = 0
    AND dh.result IS NOT NULL
    AND dh.result != ''
), invalid AS (
  SELECT s.race_id
  FROM settled_buy s
  WHERE s.payout_bet_type IS NULL
     OR (s.selection = s.result AND (
       (SELECT COUNT(*)
        FROM race_payouts rp
        WHERE rp.race_id = s.race_id
          AND rp.bet_type = s.payout_bet_type
          AND rp.combination = s.selection) != 1
       OR
       (SELECT COUNT(*)
        FROM race_payouts rp
        WHERE rp.race_id = s.race_id
          AND rp.bet_type = s.payout_bet_type
          AND rp.combination = s.selection
          AND rp.returned = 0
          AND rp.payout_yen IS NOT NULL
          AND rp.payout_yen > 0) != 1
     ))
)
SELECT COUNT(*) AS invalid FROM invalid
`).get(from, to) as { invalid: number | bigint | null };

  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("RESEARCH_DRIFT_SETTLEMENT_COUNT_INVALID");
  }
  if (invalid > 0) {
    throw new Error("RESEARCH_DRIFT_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED");
  }
}

function loadRows(from: string, to: string): { rows: DecisionHistoryRow[]; sourceWarnings: string[] } {
  if (!existsSync(DB_PATH)) {
    return { rows: [], sourceWarnings: ["research database not found; produced empty evaluation"] };
  }

  const primaryDbPath = assertCanonicalSingleLinkRegularFile(
    DB_PATH,
    "RESEARCH_DRIFT_PRIMARY_DB_IDENTITY_INVALID",
  );
  const db = new DatabaseSync(primaryDbPath, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decision_history'").get() != null;
    if (!hasTable) {
      return { rows: [], sourceWarnings: ["decision_history table not found; produced empty evaluation"] };
    }
    const hasPayoutTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='race_payouts'").get() != null;
    if (!hasPayoutTable) {
      throw new Error("RESEARCH_DRIFT_OFFICIAL_PAYOUT_TABLE_MISSING");
    }

    assertOfficialSettlementIntegrity(db, from, to);

    const raw = db.prepare(`
SELECT dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.estimated_hit_rate, dh.required_odds, dh.current_odds,
       dh.ev, dh.decision, dh.actually_bought, dh.stake_yen, dh.recommended_stake_yen, dh.sample_size,
       dh.result,
       CASE WHEN dh.decision = 'BUY' AND dh.returned = 0 AND dh.result IS NOT NULL AND dh.result != '' AND dh.selection = dh.result THEN (
         SELECT rp.payout_yen
         FROM race_payouts rp
         WHERE rp.race_id = dh.race_id
           AND rp.bet_type = ${payoutBetTypeSql("dh.bet_type")}
           AND rp.combination = dh.selection
           AND rp.returned = 0
           AND rp.payout_yen IS NOT NULL
           AND rp.payout_yen > 0
         LIMIT 1
       ) ELSE 0 END AS official_payout_yen,
       dh.popularity, dh.returned, dh.source, dh.fetched_at, dh.created_at
FROM decision_history dh
WHERE dh.date >= ? AND dh.date <= ?
ORDER BY dh.date, dh.id
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
      payoutYen: row.official_payout_yen == null ? null : Number(row.official_payout_yen),
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

function printHelp() {
  console.log(`Usage:
  pnpm detect:drift [-- --baseline-from YYYY-MM-DD --baseline-to YYYY-MM-DD \\
                        --recent-from YYYY-MM-DD --recent-to YYYY-MM-DD \\
                        --rule-id <id> --condition key=value --json|--presentation-json]

Read-only. Compares two decision_history windows (baseline vs recent) as
RuleEvaluationResult and reports a DriftDetectionResult (roi/hitRate delta,
severity, signals, warnings). Realized ROI uses canonical race_payouts.payout_yen;
unsupported or ambiguous winning settlements fail closed. Does not write to the
DB or to any rule store.

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
