/**
 * analyze-bet-type-risk-factors.ts — research-only fail-closed entrypoint
 *
 * The counterfactual bet-type risk analysis may run only after its historical
 * BUY population is verified as canonical settled trifecta data. This launcher
 * performs no DB writes, production decisions, notifications, or betting.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
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

const analysis = run("scripts/analyze-bet-type-risk-factors-internal.ts");
if (analysis !== 0) {
  console.error("[bet-type-risk] internal read-only analysis failed after a successful cohort preflight");
  process.exit(analysis);
}

console.log("[bet-type-risk] PASS: cohort preflight passed before risk-factor analysis");
