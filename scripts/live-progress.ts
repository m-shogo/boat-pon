import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LOG_PATHS = [
  "data/logs/progress.log",
  "data/logs/auto-odds.log",
  "data/logs/auto-odds-err.log",
];

process.stdout.write(execFileSync(process.execPath, ["--import", "tsx", "scripts/live-b1-monitor.ts"], { encoding: "utf8" }));
console.log("");
process.stdout.write(execFileSync(process.execPath, ["--import", "tsx", "scripts/live-readiness.ts"], { encoding: "utf8" }));

for (const path of LOG_PATHS) {
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, "utf8").trimEnd().split("\n").filter(Boolean).slice(-40);
  if (lines.length === 0) continue;
  console.log("");
  console.log(`=== ${path} tail ===`);
  for (const line of lines) console.log(line);
}
