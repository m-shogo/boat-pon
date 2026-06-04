/**
 * decision_history の audit persistence 接続状態を確認する read-only CLI。
 *
 * 目的:
 * - DBカラムが存在するか
 * - server/db.ts の insert/list に audit fields が見えているか
 * - 100点化の本丸が残っているかを明確にする
 *
 * Usage:
 *   pnpm exec tsx scripts/check-audit-persistence.ts
 *   pnpm exec tsx scripts/check-audit-persistence.ts --strict
 */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const SERVER_DB = "server/db.ts";
const strict = process.argv.includes("--strict");

const checks: Array<{ ok: boolean; name: string; detail: string; next?: string }> = [];

checkServerSource();
checkDbColumns();

const okCount = checks.filter((check) => check.ok).length;
const score = Math.round((okCount / checks.length) * 100);

console.log("=== audit persistence check ===");
console.log(`score: ${score}/100 (${okCount}/${checks.length})`);
console.log("");

for (const check of checks) {
  console.log(`${check.ok ? "✅" : "❌"} ${check.name}`);
  console.log(`   ${check.detail}`);
  if (!check.ok && check.next) console.log(`   next: ${check.next}`);
}

if (strict && score < 100) process.exitCode = 1;

function checkServerSource() {
  if (!existsSync(SERVER_DB)) {
    add(false, "server/db.ts exists", "server/db.ts missing", "restore server/db.ts");
    return;
  }

  const source = readFileSync(SERVER_DB, "utf8");
  add(source.includes("decision_reasons"), "server mentions decision_reasons", "source should include decision_reasons", "wire decision_reasons into schema/select/insert/update");
  add(source.includes("feature_adjustment"), "server mentions feature_adjustment", "source should include feature_adjustment", "wire feature_adjustment into schema/select/insert/update");
  add(source.includes("feature_adjustment_breakdown"), "server mentions feature_adjustment_breakdown", "source should include feature_adjustment_breakdown", "wire feature_adjustment_breakdown into schema/select/insert/update");
  add(source.includes("decisionReasons"), "API row exposes decisionReasons", "listDecisionHistory should expose decisionReasons", "parse decision_reasons JSON and return decisionReasons");
  add(source.includes("featureAdjustmentBreakdown"), "API row exposes featureAdjustmentBreakdown", "listDecisionHistory should expose featureAdjustmentBreakdown", "parse feature_adjustment_breakdown JSON and return featureAdjustmentBreakdown");
  add(!source.includes("[paper] BUY候補"), "paper wording safe", source.includes("[paper] BUY候補") ? "still contains [paper] BUY候補" : "BUY候補 wording not found", "run pnpm exec tsx scripts/patch-paper-wording.ts --write");
}

function checkDbColumns() {
  if (!existsSync(DB_PATH)) {
    add(false, "DB exists", `${DB_PATH} missing`, "run with the local DB or set BOAT_PON_DB_PATH");
    return;
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const columns = db.prepare("PRAGMA table_info(decision_history)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    add(names.has("decision_reasons"), "DB column decision_reasons", "decision_history.decision_reasons", "run pnpm migrate:decision-audit");
    add(names.has("feature_adjustment"), "DB column feature_adjustment", "decision_history.feature_adjustment", "run pnpm migrate:decision-audit");
    add(names.has("feature_adjustment_breakdown"), "DB column feature_adjustment_breakdown", "decision_history.feature_adjustment_breakdown", "run pnpm migrate:decision-audit");
  } finally {
    db.close();
  }
}

function add(ok: boolean, name: string, detail: string, next?: string) {
  checks.push({ ok, name, detail, next });
}
