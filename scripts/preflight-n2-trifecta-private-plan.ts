import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { readN2TrifectaRealPlanPreflight } from "../src/research-replay/n2TrifectaRealPlanPreflight";

const root = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(join(root, "config/research-automation-policy.json"), "utf8"),
) as Record<string, unknown>;
const dataRoot = resolve(String(policy.dataRoot ?? policy.repoPath ?? root));
const primaryDbPath = resolve(
  process.env.BOAT_PON_PRIMARY_DB_PATH
    ?? join(dataRoot, "data/boat.sqlite"),
);
const now = process.env.BOAT_PON_PREFLIGHT_NOW?.trim()
  || new Date().toISOString();
const outputPath = resolve(
  process.env.BOAT_PON_PREFLIGHT_REPORT_PATH
    ?? join(root, "reports/automation/validation/n2-trifecta-real-plan-preflight.json"),
);

const report = readN2TrifectaRealPlanPreflight({
  primaryDbPath,
  now,
  executionLocation: "Mac self-hosted",
});
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 3;
