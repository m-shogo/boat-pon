/**
 * ROI Explorer 最小CLI（read-only / Phase 2）
 *
 * decision_history を期間で絞り、RuleEvaluationResult 型
 * （src/domain/researchRule.ts）で出力する。
 *
 * - DBや必須テーブルが無い環境では研究結果を作らずfail-closeする
 * - realized ROI は canonical race_payouts.payout_yen のみを使う
 * - unsupported/ambiguous official settlement は集計前にfail-closeする
 * - 探索用なので isForwardTested / isProductionEligible は常に false
 * - Production昇格処理は行わない
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DecisionHistoryRow } from "../src/domain/backtest";
import type { DecisionStatus } from "../src/domain/types";
import type { ResearchRule } from "../src/domain/researchRule";
import { applyCondition, buildRuleEvaluationResult } from "../src/domain/researchEvaluation";
import { parseRoiExplorerOptions } from "../src/research-replay/roiExplorerOptions";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import { buildResearchSummaryViewModel, buildRuleCardViewModel } from "../src/view-models/researchViewModel.adapters";
import type { ResearchSummaryViewModel } from "../src/view-models/researchViewModel";
import { buildResearchPresentation } from "../src/presentation/presentationBuilder";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const evaluationRunAt = new Date().toISOString();
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printHelp();
  process.exit(0);
}
const args = parseRoiExplorerOptions(rawArgs, evaluationRunAt.slice(0, 10));

const dataWindowStart = args.from;
const dataWindowEnd = args.to;

const { rows: loadedRows, sourceWarnings } = loadRows(dataWindowStart, dataWindowEnd);

let rows = loadedRows;
const conditionWarnings: string[] = [];
if (args.condition) {
  const filtered = applyCondition(rows, args.condition);
  rows = filtered.rows;
  conditionWarnings.push(...filtered.warnings);
}

const result = buildRuleEvaluationResult({
  ruleId: args.ruleId,
  rows,
  dataWindowStart,
  dataWindowEnd,
  evaluationRunAt,
  conditionLabel: args.condition ? `${args.condition.key}=${args.condition.value}` : undefined,
  extraWarnings: [...sourceWarnings, ...conditionWarnings],
});

if (args.presentationJson) {
  console.log(JSON.stringify(buildResearchPresentation(buildViewModelSummary()), null, 2));
} else if (args.viewJson) {
  console.log(JSON.stringify(buildViewModelSummary(), null, 2));
} else if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printResult();
}

/**
 * 探索用CLIの単発実行なので、ここで作るResearchRuleは常にcandidate段階の使い捨て。
 * 永続化されたルールのライフサイクル管理はPhase 3の役割。
 */
function buildViewModelSummary(): ResearchSummaryViewModel {
  const syntheticRule: ResearchRule = {
    ruleId: result.ruleId,
    status: "candidate",
    createdAt: result.metadata.evaluationRunAt,
    updatedAt: result.metadata.evaluationRunAt,
    reasonSummary: result.reasonSummary,
    warnings: result.warnings,
  };
  const card = buildRuleCardViewModel(syntheticRule, result, {
    title: args.condition ? `${args.ruleId} (${args.condition.key}=${args.condition.value})` : args.ruleId,
  });
  return buildResearchSummaryViewModel([card]);
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
    ${payoutBetTypeSql("dh.bet_type")} AS payout_bet_type,
    dh.result
  FROM decision_history dh
  WHERE dh.date >= ? AND dh.date <= ?
    AND dh.decision = 'BUY'
    AND dh.returned = 0
    AND dh.result IS NOT NULL
), invalid AS (
  SELECT s.race_id
  FROM settled_buy s
  WHERE TRIM(s.result) = ''
     OR s.payout_bet_type IS NULL
     OR (SELECT COUNT(*)
         FROM race_payouts rp
         WHERE rp.race_id = s.race_id
           AND rp.bet_type = s.payout_bet_type
           AND rp.combination = s.result) != 1
     OR (SELECT COUNT(*)
         FROM race_payouts rp
         WHERE rp.race_id = s.race_id
           AND rp.bet_type = s.payout_bet_type
           AND rp.combination = s.result
           AND rp.returned = 0
           AND rp.payout_yen IS NOT NULL
           AND rp.payout_yen > 0) != 1
)
SELECT COUNT(*) AS invalid FROM invalid
`).get(from, to) as { invalid: number | bigint | null };

  const invalid = Number(row.invalid ?? 0);
  if (!Number.isSafeInteger(invalid) || invalid < 0) {
    throw new Error("ROI_EXPLORER_SETTLEMENT_COUNT_INVALID");
  }
  if (invalid > 0) {
    throw new Error("ROI_EXPLORER_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED");
  }
}

function loadRows(from: string, to: string): { rows: DecisionHistoryRow[]; sourceWarnings: string[] } {
  if (!existsSync(DB_PATH)) {
    throw new Error("ROI_EXPLORER_PRIMARY_DB_MISSING");
  }

  const primaryDbPath = assertCanonicalSingleLinkRegularFile(
    DB_PATH,
    "ROI_EXPLORER_PRIMARY_DB_IDENTITY_INVALID",
  );
  const db = new DatabaseSync(primaryDbPath, { readOnly: true });
  db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='decision_history'").get() != null;
    if (!hasTable) {
      throw new Error("ROI_EXPLORER_DECISION_HISTORY_TABLE_MISSING");
    }
    const hasPayoutTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='race_payouts'").get() != null;
    if (!hasPayoutTable) {
      throw new Error("ROI_EXPLORER_OFFICIAL_PAYOUT_TABLE_MISSING");
    }

    assertOfficialSettlementIntegrity(db, from, to);

    const raw = db.prepare(`
SELECT dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection, dh.estimated_hit_rate, dh.required_odds, dh.current_odds,
       dh.ev, dh.decision, dh.actually_bought, dh.stake_yen, dh.recommended_stake_yen, dh.sample_size,
       dh.result,
       CASE WHEN dh.decision = 'BUY' AND dh.returned = 0 AND dh.result IS NOT NULL AND TRIM(dh.result) != '' AND dh.selection = dh.result THEN (
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
  console.log("=== ROI explorer (read-only) ===");
  console.log(`ruleId: ${result.ruleId}`);
  console.log(`window: ${result.metadata.dataWindowStart} .. ${result.metadata.dataWindowEnd}`);
  console.log(`evaluationRunAt: ${result.metadata.evaluationRunAt}`);
  console.log(`sampleSize (settled non-returned BUY): ${result.metadata.sampleSize}`);
  console.log(`hitRate: ${(result.hitRate * 100).toFixed(2)}%`);
  console.log(`roi: ${(result.roi * 100).toFixed(2)}%`);
  console.log(`confidence: ${result.confidence.toFixed(3)}`);
  console.log(`maxDrawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`forwardTested: ${result.isForwardTested} / productionEligible: ${result.isProductionEligible}`);
  console.log(`summary: ${result.reasonSummary}`);
  if (result.warnings.length) {
    console.log("warnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm explore:roi [-- --from YYYY-MM-DD --to YYYY-MM-DD --rule-id <id> --condition key=value --json|--view-json|--presentation-json]

Read-only. Aggregates decision_history into a RuleEvaluationResult.
ROI uses canonical race_payouts.payout_yen for settled non-returned BUY rows.
Missing required research sources, blank settled BUY results, and every denominator
row must fail closed or map to exactly one positive non-refund official winning-result
settlement; evaluation never fabricates an empty result for a missing source and never
falls back to current_odds or legacy decision payout.

  --from              data window start (default 1970-01-01)
  --to                data window end (default today)
  --rule-id           ruleId label in output (default explore-roi-adhoc)
  --condition         single key=value row filter (supported keys: venue, raceNo, decision)
  --json              emit RuleEvaluationResult JSON (domain shape, unchanged)
  --view-json         emit a ResearchSummaryViewModel JSON (UI/Fable-ready display
                      contract: opportunity score, warning badges, lifecycle steps,
                      metrics)
  --presentation-json emit a ResearchSummaryPresentation JSON (renderer-independent
                      Presentation Layer contract, see docs/ai/07-PRESENTATION-LAYER.md)

If more than one of --json/--view-json/--presentation-json is passed,
--presentation-json wins over --view-json, which wins over --json.`);
}
