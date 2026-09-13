import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-miss-to-bet-type-recovery.ts", "utf8");

test("miss recovery wrapper keeps configured database paths out of missing-file errors", () => {
  assert.match(source, /throw new Error\("MISS_RECOVERY_DB_NOT_FOUND"\)/u);
  assert.doesNotMatch(source, /MISS_RECOVERY_DB_NOT_FOUND \$\{DB_PATH\}/u);
});

test("miss recovery wrapper preserves canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("miss recovery wrapper isolates analysis before canonical report publication", () => {
  const handoff = source.indexOf("MISS_RECOVERY_DB_HANDOFF_IDENTITY_INVALID");
  const launch = source.indexOf("MISS_RECOVERY_CHILD_LAUNCH_DB_IDENTITY_INVALID");
  const workspace = source.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-miss-recovery-"))');
  const child = source.indexOf("cwd: workspace", workspace);
  const stagedMd = source.indexOf("MISS_RECOVERY_MD_STAGED_OUTPUT_IDENTITY_INVALID", child);
  const stagedJson = source.indexOf("MISS_RECOVERY_JSON_STAGED_OUTPUT_IDENTITY_INVALID", child);

  assert.ok(handoff >= 0 && launch > handoff && workspace > launch && child > workspace);
  assert.ok(stagedMd > child && stagedJson > child);
  assert.ok(!source.includes('await import("./analyze-miss-to-bet-type-recovery-internal")'));
});

test("miss recovery wrapper redacts private database provenance before canonical publication", () => {
  const stagedMd = source.indexOf("MISS_RECOVERY_MD_STAGED_OUTPUT_IDENTITY_INVALID");
  const stagedJson = source.indexOf("MISS_RECOVERY_JSON_STAGED_OUTPUT_IDENTITY_INVALID");
  const redactMd = source.indexOf('redactDbProvenance(readFileSync(verifiedMdPath, "utf8")', stagedMd);
  const redactJson = source.indexOf('redactDbProvenance(readFileSync(verifiedJsonPath, "utf8")', stagedJson);
  const publishMd = source.indexOf('atomicPublish(OUT_MD, markdown, "MD")', redactMd);
  const publishJson = source.indexOf('atomicPublish(OUT_JSON, json, "JSON")', redactJson);

  assert.ok(redactMd > stagedMd && redactJson > stagedJson);
  assert.ok(publishMd > redactMd && publishJson > redactJson);
  assert.match(source, /const OPAQUE_DB_SOURCE = "primary research database"/u);
  assert.match(source, /MISS_RECOVERY_\$\{code\}_PRIVATE_DB_PATH_REMAINS/u);
});

test("miss recovery wrapper atomically publishes verified Markdown and JSON destinations", () => {
  const exclusiveOpen = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)", exclusiveOpen);
  const tempIdentity = source.indexOf("PUBLISH_TEMP_IDENTITY_INVALID", fsync);
  const destinationGuard = source.indexOf("if (existsSync(path))", tempIdentity);
  const destinationIdentity = source.indexOf("PUBLISH_DESTINATION_IDENTITY_INVALID", destinationGuard);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", destinationIdentity);

  assert.ok(
    exclusiveOpen >= 0 &&
      fsync > exclusiveOpen &&
      tempIdentity > fsync &&
      destinationGuard > tempIdentity &&
      destinationIdentity > destinationGuard &&
      rename > destinationIdentity,
  );
});
