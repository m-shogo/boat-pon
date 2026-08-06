import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const plist = readFileSync(
  resolve(root, "docs/launchd/com.boatpon.daily-programs.plist"),
  "utf8",
);
const dailyScript = readFileSync(resolve(root, "scripts/daily-programs.sh"), "utf8");
const fetchScript = readFileSync(resolve(root, "scripts/fetch-official-programs.ts"), "utf8");
const readinessScript = readFileSync(
  resolve(root, "scripts/check-official-program-live-readiness.ts"),
  "utf8",
);

test("program refresh uses five bounded early checkpoints and RunAtLoad", () => {
  const schedulePairs = [...plist.matchAll(
    /<key>Hour<\/key><integer>(\d+)<\/integer>\s*<key>Minute<\/key><integer>(\d+)<\/integer>/gu,
  )].map((match) => `${match[1]}:${match[2].padStart(2, "0")}`);
  assert.deepEqual(schedulePairs, ["1:00", "4:30", "6:00", "7:00", "7:30"]);
  assert.equal(schedulePairs.length, 5);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/u);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Background<\/string>/u);
  assert.doesNotMatch(plist, /<key>StartInterval<\/key>/u);
});

test("daily program job force-refreshes only today and verifies readiness", () => {
  assert.match(dailyScript, /BOAT_PON_SKIP_EXISTING=1/u);
  assert.match(dailyScript, /BOAT_PON_FORCE_PROGRAM_REFRESH_DATES="\$TODAY"/u);
  assert.match(dailyScript, /check-official-program-live-readiness\.ts "\$TODAY"/u);
  assert.doesNotMatch(dailyScript, /BOAT_PON_FORCE_PROGRAM_REFRESH_DATES="\$FROM"/u);
});

test("forced refresh preserves old cache until atomic replacement succeeds", () => {
  assert.match(fetchScript, /replaceDownloadWithRetry\(url, lzhPath\)/u);
  assert.match(fetchScript, /await rename\(temporary, dest\)/u);
  assert.match(fetchScript, /await rm\(temporary, \{ force: true \}\)/u);
  assert.match(fetchScript, /await rm\(txtPath, \{ force: true \}\)/u);
  assert.match(fetchScript, /structurally incomplete official program inventory/u);
  assert.match(fetchScript, /BEGIN IMMEDIATE/u);
  assert.match(fetchScript, /ROLLBACK/u);
});

test("readiness inspection is strictly read-only", () => {
  assert.match(readinessScript, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/u);
  assert.match(readinessScript, /PRAGMA query_only = ON/u);
  assert.match(readinessScript, /databaseWriteCount: 0/u);
  assert.doesNotMatch(readinessScript, /INSERT|UPDATE|DELETE|REPLACE/iu);
});
