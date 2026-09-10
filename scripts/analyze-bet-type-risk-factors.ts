/**
 * analyze-bet-type-risk-factors.ts — research-only fail-closed entrypoint
 *
 * The counterfactual bet-type risk analysis may run only after its historical
 * BUY population is verified as canonical settled trifecta data. This launcher
 * performs no DB writes, production decisions, notifications, or betting.
 */

import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[bet-type-risk] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-bet-type-risk-factors-cohort.ts");
if (preflight !== 0) {
  console.error("[bet-type-risk] FAIL CLOSED: canonical historical cohort preflight did not pass; risk-factor ROI output was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID",
);

const analysis = run("scripts/analyze-bet-type-risk-factors-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
});
if (analysis !== 0) {
  console.error("[bet-type-risk] internal read-only analysis failed after a successful cohort preflight");
  process.exit(analysis);
}

console.log("[bet-type-risk] PASS: cohort preflight passed before risk-factor analysis");
