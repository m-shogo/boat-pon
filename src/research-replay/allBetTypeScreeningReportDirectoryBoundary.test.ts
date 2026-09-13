import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/run-all-bet-type-screening-safe.ts", "utf8");

test("all-bet-type screening publication rejects redirected report directories", () => {
  assert.ok(source.includes('lstatSync(path)'));
  assert.ok(source.includes('stat.isSymbolicLink()'));
  assert.ok(source.includes('realpathSync(path) !== resolvedPath'));
  assert.ok(source.includes('ALL_BET_TYPE_SCREENING_REPORTS_DIRECTORY_IDENTITY_INVALID'));
  assert.ok(source.includes('ALL_BET_TYPE_SCREENING_${code}_PUBLISH_PARENT_IDENTITY_INVALID'));
  assert.ok(source.includes('ALL_BET_TYPE_SCREENING_${code}_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID'));

  const parentCheck = source.indexOf('PUBLISH_PARENT_IDENTITY_INVALID');
  const tempOpen = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const parentHandoffCheck = source.indexOf('PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID');
  const rename = source.indexOf('renameSync(verifiedTempPath, path)');

  assert.ok(parentCheck >= 0 && parentCheck < tempOpen, "parent identity must be checked before temp creation");
  assert.ok(parentHandoffCheck >= 0 && parentHandoffCheck < rename, "parent identity must be rechecked before canonical rename");
});
