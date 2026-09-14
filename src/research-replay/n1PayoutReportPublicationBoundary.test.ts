import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/research-replay-n1-payout.ts", "utf8");

test("N1 payout readiness reads canonical input through a verified descriptor and revalidates report destinations before atomic publication", () => {
  const reportRead = source.indexOf("readGovernanceFileUtf8(reportPath, root)");
  const reportParse = source.indexOf("JSON.parse(reportContents)");
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const tempFsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf("N1_PAYOUT_REPORT_TEMP_IDENTITY_INVALID");
  const destinationIdentity = source.indexOf("N1_PAYOUT_REPORT_DESTINATION_IDENTITY_INVALID");
  const atomicRename = source.indexOf("renameSync(verifiedTempPath, path)");

  assert.match(source, /import \{ readGovernanceFileUtf8 \} from "\.\.\/src\/research\/governance\/safeFs";/u);
  assert.ok(reportRead >= 0, "canonical implementation report must be read through a descriptor-bound helper");
  assert.ok(reportParse > reportRead, "implementation report must be fully descriptor-read before parse");
  assert.match(source, /N1_PAYOUT_IMPLEMENTATION_REPORT_IDENTITY_INVALID/u);
  assert.ok(tempCreate >= 0, "report publication must use exclusive temp creation");
  assert.ok(tempFsync > tempCreate, "report temp bytes must be fsynced before publication");
  assert.ok(tempIdentity > tempFsync, "report temp identity must be verified after fsync");
  assert.ok(destinationIdentity > tempIdentity, "existing report destination must be reverified after temp identity");
  assert.ok(atomicRename > destinationIdentity, "only a verified temp artifact may replace a reverified report path");
  assert.doesNotMatch(source, /readFileSync\(verifiedReportPath/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(reportPath/u);
  assert.doesNotMatch(source, /if \(writeReports\) writeFileSync/u);
});
