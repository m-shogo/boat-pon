/**
 * ROI Explorer 最小CLI（read-only / Phase 2）
 *
 * decision_history を期間で絞り、RuleEvaluationResult 型
 * （src/domain/researchRule.ts）で出力する。
 *
 * - DBやテーブルが無い環境では空の評価結果 + warnings を返して正常終了する
 * - 探索用なので isForwardTested / isProductionEligible は常に false
 * - Production昇格処理は行わない
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DecisionHistoryRow } from "../src/domain/backtest";
import type { DecisionStatus } from "../src/domain/types";
import { buildRuleEvaluationResult } from "../src/domain/researchEvaluation";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const args = parseArgs(process.argv.slice(2));

const evaluationRunAt = new Date().toISOString();
const dataWindowStart = args.from ?? "1970-01-01";
const dataWindowEnd = args.to ?? evaluationRunAt.slice(0, 10);

const { rows, sourceWarnings } = loadRows(dataWindowStart, dataWindowEnd);

const result = buildRuleEvaluationResult({
  ruleId: args.ruleId,
  rows,
  dataWindowStart,
  dataWindowEnd,
  evaluationRunAt,
  extraWarnings: sourceWarnings,
});

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printResult();
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
  console.log("=== ROI explorer (read-only) ===");
  console.log(`ruleId: ${result.ruleId}`);
  console.log(`window: ${result.metadata.dataWindowStart} .. ${result.metadata.dataWindowEnd}`);
  console.log(`evaluationRunAt: ${result.metadata.evaluationRunAt}`);
  console.log(`sampleSize (settled BUY): ${result.metadata.sampleSize}`);
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

function parseArgs(argv: string[]) {
  const parsed: { from?: string; to?: string; ruleId: string; json: boolean } = {
    ruleId: "explore-roi-adhoc",
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--from") parsed.from = argv[++i];
    else if (arg === "--to") parsed.to = argv[++i];
    else if (arg === "--rule-id") parsed.ruleId = argv[++i] ?? parsed.ruleId;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm explore:roi [-- --from YYYY-MM-DD --to YYYY-MM-DD --rule-id <id> --json]

Read-only. Aggregates decision_history into a RuleEvaluationResult.

  --from     data window start (default 1970-01-01)
  --to       data window end (default today)
  --rule-id  ruleId label in output (default explore-roi-adhoc)
  --json     emit RuleEvaluationResult JSON`);
}
