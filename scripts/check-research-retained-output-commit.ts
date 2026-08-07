import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateRetainedOutputCommit } from "../src/automation/researchRetainedOutputCommitGate";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function gitLines(args: string[]): string[] {
  const output = execFileSync("git", args, { encoding: "utf8" });
  return output.split("\n").map((value) => value.trim()).filter(Boolean);
}

const repoRoot = resolve(process.cwd());
const relevantRoots = ["reports/automation/retained-outputs", "reports/automation/history"];
const changedPaths = [...new Set([
  ...gitLines(["diff", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["diff", "--cached", "--name-only", "--", ...relevantRoots]),
  ...gitLines(["ls-files", "--others", "--exclude-standard", "--", ...relevantRoots]),
])].sort();

const result = validateRetainedOutputCommit({
  changedPaths,
  expectedRunId: argument("run-id"),
  readText: (relativePath) => readFileSync(resolve(repoRoot, relativePath), "utf8"),
});

console.log(JSON.stringify({
  gateVersion: "research-retained-output-commit-gate-v1",
  ...result,
  currentBuyConnectionAuthorized: false,
  lineConnectionAuthorized: false,
  databaseWriteAuthorized: false,
  publicPublishAuthorized: false,
  automatedBettingAuthorized: false,
  productionApplyAuthorized: false,
}, null, 2));
