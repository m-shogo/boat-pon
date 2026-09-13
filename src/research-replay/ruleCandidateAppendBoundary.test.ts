import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/append-rule-candidates.ts", "utf8");

test("rule candidate append is identity-checked, idempotent, and atomically published", () => {
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?args\.input/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?args\.output/u,
  );
  assert.match(source, /createHash\("sha256"\)/u);
  assert.match(source, /boat-pon-rule-candidate:\$\{appendId\}/u);
  assert.match(source, /if \(current\?\.includes\(marker\)\) return false/u);
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(
    source,
    /writeFileSync\(fd, content, "utf-8"\);\s*fsyncSync\(fd\);/u,
  );
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\([\s\S]*?tempPath[\s\S]*?renameSync\(verifiedTempPath, path\)/u,
  );
  assert.doesNotMatch(
    source,
    /writeFileSync\(args\.output/u,
  );
});

test("rule candidate append serializes competing writers before reading the append ledger", () => {
  const lockHelper = source.indexOf("function withOutputLock");
  const parentIdentity = source.indexOf("RULE_CANDIDATE_APPEND_PARENT_IDENTITY_INVALID", lockHelper);
  const lockCreate = source.indexOf('openSync(lockPath, "wx", 0o600)', parentIdentity);
  const acquired = source.indexOf("lockAcquired = true", lockCreate);
  const lockIdentity = source.indexOf("RULE_CANDIDATE_APPEND_LOCK_IDENTITY_INVALID", acquired);
  const lockedCall = source.indexOf("const appended = withOutputLock(args.output", 0);
  const currentRead = source.indexOf("const current = existsSync(args.output)", lockedCall);
  const ownedCleanup = source.indexOf("if (lockAcquired) rmSync(lockPath, { force: true })", lockIdentity);

  assert.ok(lockHelper >= 0);
  assert.ok(parentIdentity > lockHelper);
  assert.ok(lockCreate > parentIdentity);
  assert.ok(acquired > lockCreate);
  assert.ok(lockIdentity > acquired);
  assert.ok(ownedCleanup > lockIdentity);
  assert.ok(lockedCall >= 0 && currentRead > lockedCall);
  assert.match(source, /const lockPath = `\$\{path\}\.lock`/u);
  assert.match(source, /let lockAcquired = false/u);
  assert.match(source, /!stat\.isDirectory\(\) \|\| stat\.isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\(path\) !== resolvedPath/u);
});

test("rule candidate append fails closed if the ledger changes before replacement", () => {
  const helper = source.indexOf("function atomicPublish");
  const tempIdentity = source.indexOf("rule-candidate append temporary output", helper);
  const destinationExists = source.indexOf("const destinationExists = existsSync(path)", tempIdentity);
  const missingRace = source.indexOf("expectedCurrent !== null && !destinationExists", destinationExists);
  const snapshotCompare = source.indexOf("latest !== expectedCurrent", missingRace);
  const concurrentError = source.indexOf("RULE_CANDIDATE_APPEND_CONCURRENT_MODIFICATION", destinationExists);
  const parentHandoff = source.indexOf("RULE_CANDIDATE_APPEND_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", snapshotCompare);
  const rename = source.indexOf("renameSync(verifiedTempPath, path)", parentHandoff);

  assert.ok(helper >= 0);
  assert.ok(tempIdentity > helper);
  assert.ok(destinationExists > tempIdentity);
  assert.ok(missingRace > destinationExists);
  assert.ok(snapshotCompare > missingRace);
  assert.ok(concurrentError > destinationExists);
  assert.ok(parentHandoff > snapshotCompare);
  assert.ok(rename > parentHandoff);
  assert.match(source, /if \(latest\.includes\(marker\)\) return false/u);
});
