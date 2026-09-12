import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-exacta-backfill-quality.ts", "utf8");

test("exacta backfill quality keeps canonical read-only DB isolation", () => {
  assert.match(source, /EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_DB_CHILD_LAUNCH_IDENTITY_INVALID/u);
  assert.match(source, /cwd: workspace/u);
});

test("exacta backfill quality reverifies existing destinations immediately before atomic replacement", () => {
  assert.match(source, /EXACTA_BACKFILL_QUALITY_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(source, /EXACTA_BACKFILL_QUALITY_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  const create = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", create);
  const tempIdentity = source.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode)", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf(
    "assertCanonicalSingleLinkRegularFile(path, destinationErrorCode)",
    destinationGuard,
  );
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);
  assert.ok(
    create >= 0 &&
      fsync > create &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
  );
});
