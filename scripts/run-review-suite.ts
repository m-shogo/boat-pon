/**
 * boat-pon review suite runner.
 *
 * 複数の read-only review CLI をまとめて実行する。
 * shell 実行権限に依存しない TypeScript 版。
 *
 * Usage:
 *   pnpm exec tsx scripts/run-review-suite.ts --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));

console.log("=== boat-pon review suite ===");
console.log(`from=${args.from} to=${args.to} split=${args.splitDate}`);
console.log("read-only reports only");
console.log("");

const commands: string[][] = [
  ["pnpm", "report:review-summary", "--", "--from", args.from, "--to", args.to],
  ["pnpm", "report:rule-candidates", "--", "--from", args.from, "--to", args.to, "--min-settled", String(args.minSettled)],
  ["pnpm", "report:decision-outcomes", "--", "--from", args.from, "--to", args.to],
  ["pnpm", "report:buy-misses", "--", "--from", args.from, "--to", args.to, "--limit", "30"],
  ["pnpm", "report:missed-hits", "--", "--from", args.from, "--to", args.to, "--limit", "30"],
  ["pnpm", "report:odds-band-outcomes", "--", "--from", args.from, "--to", args.to, "--decision", "BUY"],
  ["pnpm", "report:data-quality-outcomes", "--", "--from", args.from, "--to", args.to, "--decision", "BUY"],
  ["pnpm", "report:calibration", "--", "--from", args.from, "--to", args.to, "--decision", "BUY"],
  ["pnpm", "report:venue-monthly", "--", "--from", args.from, "--to", args.to, "--decision", "BUY"],
  ["pnpm", "report:clv", "--", "--from", args.from, "--to", args.to],
  ["pnpm", "report:feature-breakdown", "--", "--from", args.from, "--to", args.to],
];

const optionalTsReports = [
  ["scripts/report-market-warnings.ts", ["--from", args.from, "--to", args.to, "--limit", "50"]],
  ["scripts/report-popularity-movement.ts", ["--from", args.from, "--to", args.to]],
  ["scripts/report-payout-sensitivity.ts", ["--from", args.from, "--to", args.to, "--decision", "BUY"]],
  ["scripts/report-time-split-stability.ts", ["--from", args.from, "--split-date", args.splitDate, "--to", args.to, "--decision", "BUY", "--min-settled", String(args.minSettled)]],
  ["scripts/report-model-version-simple.ts", ["--from", args.from, "--to", args.to, "--decision", "BUY", "--min-settled", String(Math.max(10, Math.floor(args.minSettled / 2)))]],
] as const;

for (const [file, reportArgs] of optionalTsReports) {
  if (existsSync(file)) {
    commands.push(["pnpm", "exec", "tsx", file, "--", ...reportArgs]);
  }
}

let failed = 0;
for (const command of commands) {
  console.log(`\n--- ${command.join(" ")} ---`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    failed += 1;
    console.error(`[review-suite] failed: ${command.join(" ")}`);
    if (!args.keepGoing) process.exit(result.status ?? 1);
  }
}

console.log("\n=== review suite complete ===");
if (failed > 0) {
  console.error(`[review-suite] failed commands: ${failed}`);
  process.exitCode = 1;
}

type Args = {
  from: string;
  to: string;
  splitDate: string;
  minSettled: number;
  keepGoing: boolean;
};

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  const parsed: Args = {
    from: "2026-01-01",
    to: today,
    splitDate: "2026-04-01",
    minSettled: 50,
    keepGoing: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];

    if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--split-date") { parsed.splitDate = normalizeDate(value); i += 1; }
    else if (key === "--min-settled") { parsed.minSettled = Math.max(1, Number(value)); i += 1; }
    else if (key === "--keep-going") parsed.keepGoing = true;
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
  pnpm exec tsx scripts/run-review-suite.ts --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD

Options:
  --min-settled N   Minimum settled rows for candidate/stability reports. Default: 50
  --keep-going      Continue even if one report fails

Read-only review runner. No external fetch jobs.`);
}
