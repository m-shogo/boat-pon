import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-promising-bet-type-strategies.ts", "utf8");

test("promising bet publication prepares every staged artifact before canonical writes", () => {
  assert.ok(source.includes("PROMISING_BET_DB_CHILD_HANDOFF_IDENTITY_INVALID"));
  assert.ok(source.includes("BOAT_PON_DB_PATH: childDbPath"));
  assert.ok(source.includes("PROMISING_BET_${output.code}_STAGED_READ_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${output.code}_STAGED_HANDOFF_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_REPORTS_DIRECTORY_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${code}_PUBLISH_PARENT_IDENTITY_INVALID"));
  assert.ok(source.includes("PROMISING_BET_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID"));

  const stagedValidation = source.indexOf("const stagedOutputs = OUTPUTS.map");
  const preparedReads = source.indexOf("const preparedOutputs = stagedOutputs.map");
  const canonicalMkdir = source.indexOf('mkdirSync("reports", { recursive: true });');
  const publishLoop = source.indexOf("for (const { output, content } of preparedOutputs)");

  assert.ok(stagedValidation >= 0);
  assert.ok(preparedReads > stagedValidation);
  assert.ok(canonicalMkdir > preparedReads, "canonical report directory must not be touched until all staged artifacts are validated and read");
  assert.ok(publishLoop > canonicalMkdir, "canonical publication must start only after the full staged set is prepared");
});
