import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
  N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS,
  assertN2TrifectaCanonicalInstallRoot,
  buildN2TrifectaLocalCaptureAuthorization,
  buildN2TrifectaLocalCaptureLaunchAgentPlist,
} from "./n2TrifectaLocalCaptureLaunchAgent.js";

test("authorization is private, one-venue, bounded and expires within 90 days", () => {
  const authorization = buildN2TrifectaLocalCaptureAuthorization({
    now: "2026-08-06T12:00:00.000Z",
    authorizationDays: 30,
    authorizationId: "AUTH-N2-TRI-LOCAL-install-test-0001",
  });
  assert.equal(authorization.stage, "ONE_VENUE_REVIEW");
  assert.equal(authorization.maxRequestsPerDay, 48);
  assert.deepEqual(authorization.checkpointLabels, ["T-30", "T-20", "T-10", "T-5"]);
  assert.equal(authorization.minInterRequestMs, 10_000);
  assert.equal(authorization.privateResearchOnly, true);
  assert.equal(authorization.publicRedistributionAuthorized, false);
  assert.equal(authorization.databaseWriteAuthorized, false);
  assert.equal(authorization.currentBuyConnectionAuthorized, false);
  assert.equal(authorization.lineConnectionAuthorized, false);
  assert.equal(authorization.automatedBettingAuthorized, false);
  assert.equal(authorization.expiresAt, "2026-09-05T12:00:00.000Z");

  assert.throws(
    () => buildN2TrifectaLocalCaptureAuthorization({
      now: "2026-08-06T12:00:00.000Z",
      authorizationDays: 91,
    }),
    /AUTHORIZATION_DAYS_OUT_OF_RANGE/,
  );
});

test("launch agent runs a short tick every 30 seconds without embedding credentials", () => {
  const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
    nodePath: "/opt/homebrew/bin/node",
    tsxCliPath: "/Users/test/boat-pon/node_modules/tsx/dist/cli.mjs",
    tickScriptPath: "/Users/test/boat-pon/scripts/run-n2-trifecta-local-capture-tick.ts",
    workingDirectory: "/Users/test/boat-pon",
    dataRoot: "/Users/test/boat-pon",
    authorizationPath: "/Users/test/boat-pon/data/private/trifecta-capture/authorization.json",
    stdoutPath: "/Users/test/boat-pon/data/private/trifecta-capture/logs/stdout.log",
    stderrPath: "/Users/test/boat-pon/data/private/trifecta-capture/logs/stderr.log",
  });

  assert.match(plist, new RegExp(N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL));
  assert.match(plist, new RegExp(`<integer>${N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS}</integer>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  assert.match(plist, /BOAT_PON_LOCAL_CAPTURE_AUTH_PATH/);
  assert.match(plist, /data\/private\/trifecta-capture\/authorization\.json/);
  assert.doesNotMatch(plist, /token|secret|password|Current BUY|LINE_CHANNEL/iu);
  assert.doesNotMatch(plist, /KeepAlive/);
});

test("launch agent XML escapes paths", () => {
  const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
    nodePath: "/opt/homebrew/bin/node",
    tsxCliPath: "/Users/a&b/node_modules/tsx/dist/cli.mjs",
    tickScriptPath: "/Users/a&b/scripts/tick.ts",
    workingDirectory: "/Users/a&b",
    dataRoot: "/Users/a&b",
    authorizationPath: "/Users/a&b/auth.json",
    stdoutPath: "/Users/a&b/out.log",
    stderrPath: "/Users/a&b/err.log",
  });
  assert.match(plist, /a&amp;b/);
  assert.doesNotMatch(plist, /a&b/);
});


test("installer rejects disposable runner worktrees but print-only remains portable", () => {
  assert.throws(
    () => assertN2TrifectaCanonicalInstallRoot({
      currentRepoRoot: "/Users/test/actions-runner/_work/boat-pon/boat-pon",
      configuredRepoRoot: "/Users/test/Developer/personal/boat-pon",
      printOnly: false,
    }),
    /INSTALL_REQUIRES_CANONICAL_REPO/,
  );
  assert.doesNotThrow(() => assertN2TrifectaCanonicalInstallRoot({
    currentRepoRoot: "/Users/test/Developer/personal/boat-pon",
    configuredRepoRoot: "/Users/test/Developer/personal/boat-pon",
    printOnly: false,
  }));
  assert.doesNotThrow(() => assertN2TrifectaCanonicalInstallRoot({
    currentRepoRoot: "/tmp/preview",
    configuredRepoRoot: "/Users/test/Developer/personal/boat-pon",
    printOnly: true,
  }));
});
