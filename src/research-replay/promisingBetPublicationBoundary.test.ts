import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");

test("promising bet publication prepares every staged artifact and destination before canonical writes", () => {
  assert.ok(source.includes("PROMISING_BET_DB_CHILD_HANDOFF_IDENTITY_INVALID"));
  assert.ok(source.includes("BOAT_PON_DB_PATH: childDbPath"));
  assert.ok(source.includes("PROMISING_BET_${output.code}_STAGED_READ_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${output.code}_STAGED_HANDOFF_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_REPORTS_DIRECTORY_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${output.code}_PREPUBLISH_DESTINATION_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${code}_PUBLISH_PARENT_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID"));

  const stagedValidation = source.indexOf("const stagedOutputs = OUTPUTS.map");
  const preparedReads = source.indexOf("const preparedOutputs = stagedOutputs.map");
  const canonicalMkdir = source.indexOf('mkdirSync("reports", { recursive: true });');
  const reportsIdentity = source.indexOf(
    'assertCanonicalDirectory("reports", "PROMISING_BET_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    canonicalMkdir,
  );
  const completePreflight = source.indexOf("verifyExistingDestinations();", reportsIdentity);
  const publishLoop = source.indexOf("for (const { output, content } of preparedOutputs)", completePreflight);

  assert.ok(stagedValidation >= 0);
  assert.ok(preparedReads > stagedValidation);
  assert.ok(canonicalMkdir > preparedReads, "canonical report directory must not be touched until all staged artifacts are validated and read");
  assert.ok(reportsIdentity > canonicalMkdir, "canonical reports identity must be verified before destination preflight");
  assert.ok(completePreflight > reportsIdentity, "the complete paired destination set must be verified before publication");
  assert.ok(publishLoop > completePreflight, "canonical publication must start only after every destination is preflighted");
});
