/**
 * server/db.ts に decision_history audit persistence を適用するローカルパッチCLI。
 *
 * 目的:
 * - 判断した瞬間の decision.reasons / featureAdjustment / featureAdjustmentBreakdown を保存する
 * - listDecisionHistory() からも返す
 * - server/db.ts を手作業で大きく編集する前に、決まった差分だけ安全に当てる
 *
 * Usage:
 *   pnpm exec tsx scripts/patch-audit-persistence.ts --dry-run
 *   pnpm exec tsx scripts/patch-audit-persistence.ts --write
 */

import { readFileSync, writeFileSync } from "node:fs";

const TARGET = "server/db.ts";
const args = parseArgs(process.argv.slice(2));

const before = readFileSync(TARGET, "utf8");
let after = before;
const applied: string[] = [];
const skipped: string[] = [];

function replaceOnce(label: string, from: string, to: string) {
  if (after.includes(to)) {
    skipped.push(`${label}: already applied`);
    return;
  }
  if (!after.includes(from)) {
    skipped.push(`${label}: source snippet not found`);
    return;
  }
  after = after.replace(from, to);
  applied.push(label);
}

replaceOnce(
  "prepare audit values",
  `  const selectionPopularity = selectionPopularityRow?.popularity ?? null;\n\n  if (existing) {`,
  `  const selectionPopularity = selectionPopularityRow?.popularity ?? null;\n  const decisionReasonsJson = JSON.stringify(decision.reasons ?? []);\n  const featureAdjustment = typeof candidate.featureAdjustment === "number" ? candidate.featureAdjustment : 0;\n  const featureAdjustmentBreakdownJson = candidate.featureAdjustmentBreakdown\n    ? JSON.stringify(candidate.featureAdjustmentBreakdown)\n    : null;\n\n  if (existing) {`,
);

replaceOnce(
  "update audit columns",
  `    selection_popularity = ?, run_kind = ?\nWHERE id = ?`,
  `    selection_popularity = ?, run_kind = ?,\n    decision_reasons = ?, feature_adjustment = ?, feature_adjustment_breakdown = ?\nWHERE id = ?`,
);

replaceOnce(
  "update audit bind values",
  `      selectionPopularity,\n      runKind,\n      existing.id,`,
  `      selectionPopularity,\n      runKind,\n      decisionReasonsJson,\n      featureAdjustment,\n      featureAdjustmentBreakdownJson,\n      existing.id,`,
);

replaceOnce(
  "insert audit columns",
  `  model_version, race_category, sharp_signal_drop, environment_risk_level, exhibition_st_residual_sum, selection_popularity, run_kind)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  `  model_version, race_category, sharp_signal_drop, environment_risk_level, exhibition_st_residual_sum, selection_popularity, run_kind,\n  decision_reasons, feature_adjustment, feature_adjustment_breakdown)\nVALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

replaceOnce(
  "insert audit bind values",
  `    selectionPopularity,\n    runKind,\n  );`,
  `    selectionPopularity,\n    runKind,\n    decisionReasonsJson,\n    featureAdjustment,\n    featureAdjustmentBreakdownJson,\n  );`,
);

replaceOnce(
  "select audit columns",
  `       selection_popularity, run_kind, created_at`,
  `       selection_popularity, run_kind, decision_reasons, feature_adjustment, feature_adjustment_breakdown, created_at`,
);

replaceOnce(
  "return audit fields",
  `    runKind: String(row.run_kind ?? "historical-backfill") as DecisionRunKind,\n    fetchedAt: String(row.fetched_at),`,
  `    runKind: String(row.run_kind ?? "historical-backfill") as DecisionRunKind,\n    decisionReasons: parseJsonArray(row.decision_reasons),\n    featureAdjustment: row.feature_adjustment == null ? null : Number(row.feature_adjustment),\n    featureAdjustmentBreakdown: parseJsonObject(row.feature_adjustment_breakdown),\n    fetchedAt: String(row.fetched_at),`,
);

replaceOnce(
  "add json parse helpers",
  `}\n\nexport function createNotificationIfNeeded(`,
  `}\n\nfunction parseJsonArray(value: unknown): string[] {\n  if (typeof value !== "string" || value.length === 0) return [];\n  try {\n    const parsed = JSON.parse(value);\n    return Array.isArray(parsed) ? parsed.map(String) : [];\n  } catch {\n    return [];\n  }\n}\n\nfunction parseJsonObject(value: unknown): Record<string, unknown> | null {\n  if (typeof value !== "string" || value.length === 0) return null;\n  try {\n    const parsed = JSON.parse(value);\n    return parsed && typeof parsed === "object" && !Array.isArray(parsed)\n      ? parsed as Record<string, unknown>\n      : null;\n  } catch {\n    return null;\n  }\n}\n\nexport function createNotificationIfNeeded(`,
);

console.log("=== patch audit persistence ===");
console.log(`target: ${TARGET}`);
console.log(`mode: ${args.write ? "write" : "dry-run"}`);
console.log("");
console.log("applied:");
for (const item of applied) console.log(`- ${item}`);
console.log("");
console.log("skipped:");
for (const item of skipped) console.log(`- ${item}`);

if (after === before) {
  console.log("\nNo changes.");
  process.exit(0);
}

if (args.write) {
  writeFileSync(TARGET, after);
  console.log("\nUpdated server/db.ts");
} else {
  console.log("\nDry-run only. Re-run with --write to update server/db.ts");
}

type Args = { write: boolean };

function parseArgs(argv: string[]): Args {
  const parsed: Args = { write: false };
  for (const key of argv) {
    if (key === "--write") parsed.write = true;
    else if (key === "--dry-run") parsed.write = false;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:\n  pnpm exec tsx scripts/patch-audit-persistence.ts --dry-run\n  pnpm exec tsx scripts/patch-audit-persistence.ts --write\n`);
}
