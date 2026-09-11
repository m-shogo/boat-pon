import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/research-replay-n1-payout.ts", "utf8");

test("N1 payout readiness verifies canonical input and publishes reports atomically", () => {
  const reportIdentity = source.indexOf("N1_PAYOUT_IMPLEMENTATION_REPORT_IDENTITY_INVALID");
  const reportRead = source.indexOf('readFileSync(verifiedReportPath, "utf8")');
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const tempFsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf("N1_PAYOUT_REPORT_TEMP_IDENTITY_INVALID");
  const atomicRename = source.indexOf("renameSync(verifiedTempPath, path)");

  assert.ok(reportIdentity >= 0, "canonical implementation report must have an opaque identity failure code");
  assert.ok(reportRead > reportIdentity, "implementation report must be identity-verified before read/parse");
  assert.ok(tempCreate >= 0, "report publication must use exclusive temp creation");
  assert.ok(tempFsync > tempCreate, "report temp bytes must be fsynced before publication");
  assert.ok(tempIdentity > tempFsync, "report temp identity must be verified after fsync");
  assert.ok(atomicRename > tempIdentity, "only a verified temp artifact may replace a report path");
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(reportPath/u);
  assert.doesNotMatch(source, /if \(writeReports\) writeFileSync/u);
});
