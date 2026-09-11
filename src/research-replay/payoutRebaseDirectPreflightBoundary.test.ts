import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypointSource = readFileSync("scripts/analyze-payout-rebase.ts", "utf-8");
const internalSource = readFileSync("scripts/analyze-payout-rebase-internal.ts", "utf-8");

test("direct payout-rebase invocation runs settlement integrity preflight before verified isolated internal analysis", () => {
  const preflight = entrypointSource.indexOf('runGuarded("scripts/audit-odds-payout-gap-completeness.ts")');
  const guard = entrypointSource.indexOf("if (preflight !== 0)");
  const verify = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = entrypointSource.lastIndexOf("runIsolated(workspace, verifiedDbPath)");

  assert.ok(preflight >= 0, "direct entrypoint must invoke settlement integrity preflight");
  assert.ok(guard > preflight, "preflight result must be checked before DB identity verification");
  assert.ok(verify > guard, "DB identity must be re-verified only after settlement integrity passes");
  assert.ok(analysis > verify, "isolated payout analysis must remain downstream of DB identity verification");
  assert.match(entrypointSource, /process\.exit\(preflight\)/);
});

test("canonical payout-rebase passes only a reverified DB identity to the isolated internal child", () => {
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_MISSING/);
  assert.match(entrypointSource, /PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypointSource, /PAYOUT_REBASE_DB_CHILD_LAUNCH_IDENTITY_INVALID/);
  assert.doesNotMatch(entrypointSource, /DB not found:/);
  assert.match(entrypointSource, /BOAT_PON_DB_PATH: launchDbPath/);

  const primary = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const isolatedCall = entrypointSource.lastIndexOf("runIsolated(workspace, verifiedDbPath)");
  const launch = entrypointSource.indexOf('"PAYOUT_REBASE_DB_CHILD_LAUNCH_IDENTITY_INVALID"');
  const spawn = entrypointSource.indexOf("const result = spawnSync(", launch);
  assert.ok(primary >= 0 && isolatedCall > primary, "main flow must invoke isolated analysis only after primary DB verification");
  assert.ok(launch >= 0 && spawn > launch, "isolated child must spawn only after launch-time DB identity verification");
});

test("canonical payout-rebase rejects unsafe pre-existing Markdown and JSON paths before isolated analysis", () => {
  const dbVerify = entrypointSource.indexOf('"PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID"');
  const outputPreflight = entrypointSource.lastIndexOf("verifyExistingOutputs();");
  const workspace = entrypointSource.lastIndexOf("mkdtempSync(");

  assert.ok(outputPreflight > dbVerify, "output path preflight must follow verified DB handoff");
  assert.ok(workspace > outputPreflight, "legacy analysis must not start before output path preflight");
  assert.match(entrypointSource, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(entrypointSource, /PAYOUT_REBASE_PREEXISTING_REPORT_IDENTITY_INVALID/);
  assert.match(entrypointSource, /if \(existsSync\(OUT_JSON\)\)/u);
  assert.match(entrypointSource, /PAYOUT_REBASE_PREEXISTING_JSON_IDENTITY_INVALID/);
});

test("canonical payout-rebase runs legacy analysis only inside an isolated workspace", () => {
  assert.match(entrypointSource, /mkdtempSync\(join\(tmpdir\(\), "boat-pon-payout-rebase-"\)\)/);
  assert.match(entrypointSource, /cwd: workspace/);
  assert.match(entrypointSource, /pathToFileURL\(internalPath\)/);
  assert.match(entrypointSource, /mkdirSync\(join\(workspace, "reports"\), \{ recursive: true \}\)/);
  assert.match(entrypointSource, /rmSync\(workspace, \{ recursive: true, force: true \}\)/);
});

test("canonical payout-rebase verifies both isolated outputs before provenance sanitization and publication", () => {
  const mdIdentity = entrypointSource.indexOf('"PAYOUT_REBASE_REPORT_IDENTITY_INVALID"');
  const jsonIdentity = entrypointSource.indexOf('"PAYOUT_REBASE_JSON_IDENTITY_INVALID"');
  const mdRead = entrypointSource.indexOf('readFileSync(verifiedMdPath, "utf8")');
  const jsonRead = entrypointSource.indexOf('readFileSync(verifiedJsonPath, "utf8")');
  const parse = entrypointSource.indexOf("JSON.parse(json)");
  const mdHandoff = entrypointSource.indexOf('"PAYOUT_REBASE_REPORT_HANDOFF_IDENTITY_INVALID"');
  const jsonHandoff = entrypointSource.indexOf('"PAYOUT_REBASE_JSON_HANDOFF_IDENTITY_INVALID"');

  assert.ok(mdIdentity >= 0 && jsonIdentity > mdIdentity && mdRead > jsonIdentity && jsonRead > mdRead);
  assert.ok(parse > jsonRead && mdHandoff > parse && jsonHandoff > mdHandoff);
  assert.match(entrypointSource, /const privateMarker = `DB: \$\{dbPath\}`/u);
  assert.match(entrypointSource, /report\.replaceAll\(privateMarker, `DB: \$\{OPAQUE_DB_SOURCE\}`\)/u);
  assert.match(entrypointSource, /json: json\.split\(dbPath\)\.join\(OPAQUE_DB_SOURCE\)/u);
});

test("canonical payout-rebase publishes JSON and Markdown through exclusive fsynced temporary files", () => {
  const create = entrypointSource.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = entrypointSource.indexOf("fsyncSync(fd)", create);
  const tempIdentity = entrypointSource.indexOf("assertCanonicalSingleLinkRegularFile(tempPath, errorCode)", fsync);
  const rename = entrypointSource.indexOf("renameSync(verifiedTempPath, path)", tempIdentity);
  const jsonPublish = entrypointSource.lastIndexOf("PAYOUT_REBASE_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  const mdPublish = entrypointSource.lastIndexOf("PAYOUT_REBASE_MD_PUBLISH_TEMP_IDENTITY_INVALID");

  assert.ok(create >= 0 && fsync > create && tempIdentity > fsync && rename > tempIdentity);
  assert.ok(jsonPublish > rename && mdPublish > jsonPublish);
});

test("internal payout-rebase analysis keeps canonical read-only database boundaries", () => {
  const verify = internalSource.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = internalSource.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0, "primary DB identity guard must exist");
  assert.ok(open > verify, "SQLite must open only after canonical identity verification");
  assert.match(internalSource, /PRAGMA query_only = ON/);
});

test("internal payout-rebase still consumes official payout values only after the guarded entrypoint", () => {
  assert.match(internalSource, /race_payouts\.payout_yen/);
  assert.match(internalSource, /COALESCE/);
  assert.match(internalSource, /本番 decision ロジック変更/);
});
