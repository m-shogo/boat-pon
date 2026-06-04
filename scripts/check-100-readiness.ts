/**
 * boat-pon 100点化 readiness checklist.
 *
 * 目的:
 * - 100点に近づくための残タスクを read-only で一覧化する
 * - ここで追加済みのレビュー基盤と、まだローカル実装が必要な本丸を分けて確認する
 *
 * Usage:
 *   pnpm exec tsx scripts/check-100-readiness.ts
 */

import { existsSync, readFileSync } from "node:fs";

const checks: Check[] = [];

checkFiles();
checkPackageScripts();
checkDbSourceHints();

const okCount = checks.filter((check) => check.ok).length;
const total = checks.length;
const score = Math.round((okCount / total) * 100);

console.log("=== boat-pon 100 readiness ===");
console.log(`score: ${score}/100 (${okCount}/${total})`);
console.log("");

for (const check of checks) {
  const mark = check.ok ? "✅" : "❌";
  console.log(`${mark} [${check.area}] ${check.name}`);
  console.log(`   ${check.message}`);
  if (!check.ok && check.next) console.log(`   next: ${check.next}`);
}

console.log("");
console.log("note: 100 readiness is about safety, reviewability, and improvement loop completeness. It does not mean guaranteed profit.");

if (process.argv.includes("--strict") && score < 100) {
  process.exitCode = 1;
}

type Check = {
  ok: boolean;
  area: string;
  name: string;
  message: string;
  next?: string;
};

function add(ok: boolean, area: string, name: string, message: string, next?: string) {
  checks.push({ ok, area, name, message, next });
}

function checkFiles() {
  const requiredFiles = [
    ["review-suite", "scripts/run-review-suite.ts"],
    ["review-log-template", "docs/review-log-template.md"],
    ["review-log-creator", "scripts/create-review-log.ts"],
    ["safe-backup", "scripts/backup-db-safe.ts"],
    ["decision-audit-migration", "scripts/migrate-decision-audit.ts"],
    ["audit-doctor", "scripts/decision-audit-doctor.ts"],
    ["rule-candidates", "scripts/report-rule-candidates.ts"],
    ["market-warnings", "scripts/report-market-warnings.ts"],
    ["popularity-movement", "scripts/report-popularity-movement.ts"],
    ["payout-sensitivity", "scripts/report-payout-sensitivity.ts"],
    ["time-split-stability", "scripts/report-time-split-stability.ts"],
    ["model-version-simple", "scripts/report-model-version-simple.ts"],
  ];

  for (const [name, path] of requiredFiles) {
    add(existsSync(path), "file", name, `${path} ${existsSync(path) ? "exists" : "missing"}`, `add ${path}`);
  }
}

function checkPackageScripts() {
  if (!existsSync("package.json")) {
    add(false, "package", "package.json", "package.json missing");
    return;
  }

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  const expectedScripts = [
    ["report:review-summary", "registered summary report"],
    ["report:rule-candidates", "registered rule candidate report"],
    ["report:decision-outcomes", "registered decision outcome report"],
    ["report:buy-misses", "registered BUY miss report"],
    ["report:missed-hits", "registered missed hit report"],
    ["report:odds-band-outcomes", "registered odds band report"],
    ["report:data-quality-outcomes", "registered data quality report"],
    ["report:calibration", "registered calibration report"],
    ["backup:safe", "registered safe backup"],
  ];

  for (const [name, message] of expectedScripts) {
    add(Boolean(scripts[name]), "package-script", name, scripts[name] ? message : "missing", `add scripts.${name}`);
  }

  const optionalNotYetRegistered = [
    "report:market-warnings",
    "report:popularity-movement",
    "report:payout-sensitivity",
    "report:time-split-stability",
    "report:model-version-simple",
  ];

  for (const name of optionalNotYetRegistered) {
    add(Boolean(scripts[name]), "package-script", name, scripts[name] ? "registered" : "not registered yet", `add scripts.${name}; run-review-suite can still call existing files directly for some reports`);
  }

  const backup = scripts.backup;
  add(
    backup === "tsx scripts/backup-db-safe.ts",
    "package-script",
    "backup default safe",
    backup ? `backup=${backup}` : "backup missing",
    "set backup to tsx scripts/backup-db-safe.ts and keep old one as backup:legacy",
  );
}

function checkDbSourceHints() {
  if (!existsSync("server/db.ts")) {
    add(false, "server", "server/db.ts", "server/db.ts missing");
    return;
  }

  const source = readFileSync("server/db.ts", "utf8");
  add(
    source.includes("decision_reasons"),
    "server",
    "decision reasons persisted",
    source.includes("decision_reasons") ? "server/db.ts mentions decision_reasons" : "server/db.ts does not mention decision_reasons",
    "persist decision_reasons in insertDecisionHistory UPDATE/INSERT",
  );
  add(
    source.includes("feature_adjustment_breakdown"),
    "server",
    "feature breakdown persisted",
    source.includes("feature_adjustment_breakdown") ? "server/db.ts mentions feature_adjustment_breakdown" : "server/db.ts does not mention feature_adjustment_breakdown",
    "persist feature_adjustment_breakdown in insertDecisionHistory UPDATE/INSERT",
  );
  add(
    source.includes("[paper] 検証候補") || !source.includes("[paper] BUY候補"),
    "server",
    "paper wording safe",
    source.includes("[paper] BUY候補") ? "still uses BUY候補 wording" : "BUY候補 wording not found",
    "change notification wording from BUY候補 to 検証候補",
  );
}
