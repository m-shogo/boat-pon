/**
 * audit persistence 適用後の最終補正パッチ。
 *
 * 目的:
 * - listDecisionHistory() が featureAdjustment を返すようにする
 * - server/db.ts の通常 migrate() でも audit columns を追加する
 *
 * Usage:
 *   pnpm exec tsx scripts/patch-audit-final-fixes.ts --dry-run
 *   pnpm exec tsx scripts/patch-audit-final-fixes.ts --write
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
  "return featureAdjustment",
  `    decisionReasons: row.decision_reasons == null ? [] : (() => { try { return JSON.parse(String(row.decision_reasons)) as string[]; } catch { return []; } })(),\n    featureAdjustmentBreakdown: row.feature_adjustment_breakdown == null ? null : (() => { try { return JSON.parse(String(row.feature_adjustment_breakdown)) as Record<string, number>; } catch { return null; } })(),`,
  `    decisionReasons: row.decision_reasons == null ? [] : (() => { try { return JSON.parse(String(row.decision_reasons)) as string[]; } catch { return []; } })(),\n    featureAdjustment: row.feature_adjustment == null ? null : Number(row.feature_adjustment),\n    featureAdjustmentBreakdown: row.feature_adjustment_breakdown == null ? null : (() => { try { return JSON.parse(String(row.feature_adjustment_breakdown)) as Record<string, number>; } catch { return null; } })(),`,
);

replaceOnce(
  "migrate audit columns",
  `  try {\n    db.exec("ALTER TABLE decision_history ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'historical-backfill'");\n  } catch {\n    // Existing databases already have this column.\n  }\n\n  // 検索性能向上のためのINDEX（冪等）`,
  `  try {\n    db.exec("ALTER TABLE decision_history ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'historical-backfill'");\n  } catch {\n    // Existing databases already have this column.\n  }\n  try {\n    db.exec("ALTER TABLE decision_history ADD COLUMN decision_reasons TEXT NOT NULL DEFAULT '[]'");\n  } catch {\n    // Existing databases already have this column.\n  }\n  try {\n    db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment REAL");\n  } catch {\n    // Existing databases already have this column.\n  }\n  try {\n    db.exec("ALTER TABLE decision_history ADD COLUMN feature_adjustment_breakdown TEXT");\n  } catch {\n    // Existing databases already have this column.\n  }\n\n  // 検索性能向上のためのINDEX（冪等）`,
);

console.log("=== patch audit final fixes ===");
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
  console.log(`Usage:\n  pnpm exec tsx scripts/patch-audit-final-fixes.ts --dry-run\n  pnpm exec tsx scripts/patch-audit-final-fixes.ts --write\n`);
}
