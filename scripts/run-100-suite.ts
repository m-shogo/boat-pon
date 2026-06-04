/**
 * boat-pon 100点化確認スイート。
 *
 * 目的:
 * - 100点化に必要なチェックを順番に実行する
 * - 外部fetchはしない
 * - DB削除やDROP TABLEはしない
 * - backupはsafe版を使う
 *
 * Usage:
 *   pnpm exec tsx scripts/run-100-suite.ts
 *   pnpm exec tsx scripts/run-100-suite.ts --keep-going
 *   pnpm exec tsx scripts/run-100-suite.ts --with-review --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
 */

import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

const commands: string[][] = [
  ["pnpm", "check:100"],
  ["pnpm", "audit:persistence"],
  ["pnpm", "typecheck:scripts"],
  ["pnpm", "test"],
  ["pnpm", "audit:doctor"],
  ["pnpm", "backup"],
];

if (args.withReview) {
  commands.push([
    "pnpm",
    "review:suite",
    "--",
    "--from",
    args.from,
    "--to",
    args.to,
    "--split-date",
    args.splitDate,
    "--keep-going",
  ]);
}

console.log("=== boat-pon 100 suite ===");
console.log(`withReview=${args.withReview} keepGoing=${args.keepGoing}`);
console.log("No external fetch jobs are included.");
console.log("");

let failed = 0;
for (const command of commands) {
  console.log(`\n--- ${command.join(" ")} ---`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    failed += 1;
    console.error(`[100-suite] failed: ${command.join(" ")}`);
    if (!args.keepGoing) process.exit(result.status ?? 1);
  }
}

console.log("\n=== boat-pon 100 suite complete ===");
if (failed > 0) {
  console.error(`[100-suite] failed commands: ${failed}`);
  process.exitCode = 1;
}

type Args = {
  keepGoing: boolean;
  withReview: boolean;
  from: string;
  to: string;
  splitDate: string;
};

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  const parsed: Args = {
    keepGoing: false,
    withReview: false,
    from: "2026-01-01",
    to: today,
    splitDate: "2026-04-01",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--keep-going") parsed.keepGoing = true;
    else if (key === "--with-review") parsed.withReview = true;
    else if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--split-date") { parsed.splitDate = normalizeDate(value); i += 1; }
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`unknown option: ${key}`);
  }

  return parsed;
}

function normalizeDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`date must be YYYY-MM-DD: ${value ?? ""}`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/run-100-suite.ts [--keep-going]
  pnpm exec tsx scripts/run-100-suite.ts --with-review --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD [--keep-going]

Runs:
  pnpm check:100
  pnpm audit:persistence
  pnpm typecheck:scripts
  pnpm test
  pnpm audit:doctor
  pnpm backup

Optional:
  pnpm review:suite -- --from ... --to ... --split-date ... --keep-going
`);
}
