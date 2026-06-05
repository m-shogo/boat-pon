/**
 * docs/review-log-template.md から日付付きレビュー記録を作る小さな補助CLI。
 *
 * Usage:
 *   pnpm exec tsx scripts/create-review-log.ts --date 2026-06-04 --from 2026-01-01 --to 2026-06-03 --split-date 2026-04-01
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const TEMPLATE_PATH = "docs/review-log-template.md";
const args = parseArgs(process.argv.slice(2));

if (!existsSync(TEMPLATE_PATH)) {
  console.error(`[create-review-log] template not found: ${TEMPLATE_PATH}`);
  process.exit(1);
}

const outPath = `docs/reviews/${args.date}-review.md`;
if (existsSync(outPath) && !args.force) {
  console.error(`[create-review-log] already exists: ${outPath}`);
  console.error("Use --force to overwrite.");
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });

const template = readFileSync(TEMPLATE_PATH, "utf8");
const command = `pnpm exec tsx scripts/run-review-suite.ts --from ${args.from} --to ${args.to} --split-date ${args.splitDate} --min-settled ${args.minSettled}`;
const content = template
  .replace("- 実施日:", `- 実施日: ${args.date}`)
  .replace("- 対象期間:", `- 対象期間: ${args.from}〜${args.to}`)
  .replace("- split date:", `- split date: ${args.splitDate}`)
  .replace("- 実行コマンド:", `- 実行コマンド: ${command}`)
  .replace("pnpm exec tsx scripts/run-review-suite.ts --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD --min-settled 50", command);

writeFileSync(outPath, content);
console.log(`[create-review-log] created: ${outPath}`);

type Args = {
  date: string;
  from: string;
  to: string;
  splitDate: string;
  minSettled: number;
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  const parsed: Args = {
    date: today,
    from: "2026-01-01",
    to: today,
    splitDate: "2026-04-01",
    minSettled: 50,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--date") { parsed.date = normalizeDate(value); i += 1; }
    else if (key === "--from") { parsed.from = normalizeDate(value); i += 1; }
    else if (key === "--to") { parsed.to = normalizeDate(value); i += 1; }
    else if (key === "--split-date") { parsed.splitDate = normalizeDate(value); i += 1; }
    else if (key === "--min-settled") { parsed.minSettled = Math.max(1, Number(value)); i += 1; }
    else if (key === "--force") parsed.force = true;
    else if (key === "--help" || key === "-h") { printHelp(); process.exit(0); }
    else if (key === "--") { /* pnpm separator */ }
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
  pnpm exec tsx scripts/create-review-log.ts --date YYYY-MM-DD --from YYYY-MM-DD --to YYYY-MM-DD --split-date YYYY-MM-DD

Options:
  --min-settled N  Default: 50
  --force          Overwrite existing review log
`);
}
