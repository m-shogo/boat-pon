/**
 * paper通知の文言を安全側に寄せるローカルパッチCLI。
 *
 * 目的:
 * - `BUY候補` / `買い目` など、購入指示に見えやすい表現を検証用表現に置換する
 * - server/db.ts 全体を直接大きく編集せず、ローカルで小さな置換だけ行う
 *
 * Usage:
 *   pnpm exec tsx scripts/patch-paper-wording.ts --dry-run
 *   pnpm exec tsx scripts/patch-paper-wording.ts --write
 */

import { readFileSync, writeFileSync } from "node:fs";

const TARGET = "server/db.ts";
const args = parseArgs(process.argv.slice(2));
const before = readFileSync(TARGET, "utf8");
let after = before;

const replacements: Array<[string, string]> = [
  ["[paper] BUY候補:", "[paper] 検証候補:"],
  ["買い目:", "候補:"],
  ["判定的中率:", "推定的中率:"],
  ["【paper観察モード】実購入なし。live ROI確認まで購入しない。", "【paper観察モード】実購入なし。検証・反省用。"],
];

const applied: string[] = [];
const missing: string[] = [];

for (const [from, to] of replacements) {
  if (after.includes(from)) {
    after = after.split(from).join(to);
    applied.push(`${from} -> ${to}`);
  } else {
    missing.push(from);
  }
}

console.log("=== patch paper wording ===");
console.log(`target: ${TARGET}`);
console.log(`mode: ${args.write ? "write" : "dry-run"}`);
console.log("");
console.log("applied candidates:");
for (const row of applied) console.log(`- ${row}`);

if (missing.length > 0) {
  console.log("\nnot found:");
  for (const row of missing) console.log(`- ${row}`);
}

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
    else if (key === "--") { /* pnpm arg separator, ignore */ }
    else throw new Error(`unknown option: ${key}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  pnpm exec tsx scripts/patch-paper-wording.ts --dry-run
  pnpm exec tsx scripts/patch-paper-wording.ts --write
`);
}
