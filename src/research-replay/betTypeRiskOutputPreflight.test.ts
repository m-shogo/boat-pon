import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-bet-type-risk-factors.ts", "utf8");

test("bet-type risk keeps canonical reports untouched until isolated staged output is verified", () => {
  const dbVerify = entrypoint.indexOf('"BET_TYPE_RISK_PRIMARY_DB_IDENTITY_INVALID"');
  const launchVerify = entrypoint.indexOf('"BET_TYPE_RISK_CHILD_LAUNCH_DB_IDENTITY_INVALID"');
  const workspace = entrypoint.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-bet-type-risk-"))');
  const analysis = entrypoint.indexOf("const analysis = spawnSync", workspace);
  const stagedMdVerify = entrypoint.indexOf('"BET_TYPE_RISK_MD_STAGED_OUTPUT_IDENTITY_INVALID"', analysis);
  const stagedJsonVerify = entrypoint.indexOf('"BET_TYPE_RISK_JSON_STAGED_OUTPUT_IDENTITY_INVALID"', stagedMdVerify);
  const publishMd = entrypoint.indexOf('atomicPublish(OUT_MD, markdown, "MD")', stagedJsonVerify);

  assert.ok(dbVerify >= 0, "primary DB identity must be verified");
  assert.ok(launchVerify > dbVerify, "DB identity must be reverified immediately before child launch");
  assert.ok(workspace > launchVerify && analysis > workspace, "legacy analyzer must run only inside an isolated workspace");
  assert.ok(stagedMdVerify > analysis && stagedJsonVerify > stagedMdVerify, "both staged reports must be identity-verified before publication");
  assert.ok(publishMd > stagedJsonVerify, "canonical publication must occur only after staged output verification");
  assert.match(entrypoint, /cwd: workspace/u);
  assert.match(entrypoint, /if \(existsSync\(path\)\)/u);
  assert.match(entrypoint, /PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.doesNotMatch(entrypoint, /run\("scripts\/analyze-bet-type-risk-factors-internal\.ts"/u);
  assert.doesNotMatch(entrypoint, /BET_TYPE_RISK_PREEXISTING_REPORT_IDENTITY_INVALID/u);
});
