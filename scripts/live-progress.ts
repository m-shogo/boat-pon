import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { formatLiveLogLine, tailLiveLog } from "./live-log-utils";

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
  const lines = tailLiveLog(path, 40);
  if (lines.length === 0) continue;
  console.log("");
  console.log(`=== ${path} tail ===`);
  for (const line of lines) console.log(formatLiveLogLine(line));
}
