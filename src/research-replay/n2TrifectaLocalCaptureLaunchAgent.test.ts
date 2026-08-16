import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL,
  N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS,
  assertN2TrifectaCanonicalInstallRoot,
  buildN2TrifectaImmutableRuntimeRoot,
  buildN2TrifectaLocalCaptureAuthorization,
  buildN2TrifectaLocalCaptureLaunchAgentPlist,
} from "./n2TrifectaLocalCaptureLaunchAgent.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUNTIME = `/Users/test/Library/Application Support/BoatPon/trifecta-private-capture/releases/${SHA}`;

test("authorization remains private, one-venue, bounded and expires within 90 days", () => {
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

test("authorization launch time rejects JavaScript-normalized or timezone-ambiguous instants", () => {
  for (const now of [
    "2026-08-06T24:00:00.000Z",
    "2026-02-30T12:00:00.000Z",
    "2026-08-06T12:00:00.000",
  ]) {
    assert.throws(
      () => buildN2TrifectaLocalCaptureAuthorization({
        now,
        authorizationDays: 30,
      }),
      /INVALID_INSTANT/,
      now,
    );
  }

  const leapDayOffset = buildN2TrifectaLocalCaptureAuthorization({
    now: "2028-02-29T21:00:00+09:00",
    authorizationDays: 1,
    authorizationId: "AUTH-N2-TRI-LOCAL-leap-offset-0001",
  });
  assert.equal(leapDayOffset.issuedAt, "2028-02-29T12:00:00.000Z");
  assert.equal(leapDayOffset.expiresAt, "2028-03-01T12:00:00.000Z");
});

test("immutable runtime is outside mutable repo and runner workspace", () => {
  assert.equal(buildN2TrifectaImmutableRuntimeRoot({
    releasesRoot: "/Users/test/Library/Application Support/BoatPon/trifecta-private-capture/releases",
    authoritySha: SHA,
    canonicalRepoRoot: "/Users/test/Developer/personal/boat-pon",
  }), RUNTIME);
  assert.throws(() => buildN2TrifectaImmutableRuntimeRoot({
    releasesRoot: "/Users/test/Developer/personal/boat-pon/releases",
    authoritySha: SHA,
    canonicalRepoRoot: "/Users/test/Developer/personal/boat-pon",
  }), /RUNTIME_MUST_BE_OUTSIDE_CANONICAL_REPO/);
  assert.throws(() => buildN2TrifectaImmutableRuntimeRoot({
    releasesRoot: "/Users/test/actions-runner-boat-pon/_work/releases",
    authoritySha: SHA,
    canonicalRepoRoot: "/Users/test/Developer/personal/boat-pon",
  }), /RUNTIME_MUST_NOT_USE_RUNNER_WORKSPACE/);
});

test("launch agent runs immutable runtime tick every 30 seconds without credentials", () => {
  const canonical = "/Users/test/Developer/personal/boat-pon";
  const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
    nodePath: "/opt/homebrew/bin/node",
    tsxCliPath: `${RUNTIME}/node_modules/tsx/dist/cli.mjs`,
    tickScriptPath: `${RUNTIME}/scripts/run-n2-trifecta-local-capture-tick.ts`,
    workingDirectory: RUNTIME,
    authoritySha: SHA,
    runtimeRoot: RUNTIME,
    dataRoot: canonical,
    authorizationPath: `${canonical}/data/private/trifecta-capture/authorization.json`,
    runtimeAuthorityPath: `${canonical}/data/private/trifecta-capture/runtime-authority.json`,
    stdoutPath: `${canonical}/data/private/trifecta-capture/logs/stdout.log`,
    stderrPath: `${canonical}/data/private/trifecta-capture/logs/stderr.log`,
  });

  assert.match(plist, new RegExp(N2_TRIFECTA_LOCAL_CAPTURE_LAUNCH_AGENT_LABEL));
  assert.match(plist, new RegExp(`<integer>${N2_TRIFECTA_LOCAL_CAPTURE_START_INTERVAL_SECONDS}</integer>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  assert.match(plist, /BOAT_PON_LOCAL_CAPTURE_AUTH_PATH/);
  assert.match(plist, /BOAT_PON_LOCAL_CAPTURE_RUNTIME_AUTH_PATH/);
  assert.match(plist, /BOAT_PON_LOCAL_CAPTURE_AUTHORITY_SHA/);
  assert.match(plist, /BOAT_PON_LOCAL_CAPTURE_RUNTIME_ROOT/);
  assert.match(plist, new RegExp(SHA));
  assert.match(plist, /Application Support\/BoatPon/);
  assert.doesNotMatch(plist, /actions-runner-|\/_work\//);
  assert.doesNotMatch(plist, /token|secret|password|Current BUY|LINE_CHANNEL/iu);
  assert.doesNotMatch(plist, /KeepAlive/);
});

test("launch agent XML escapes immutable runtime paths", () => {
  const escapedRuntime = `/Users/a&b/Library/Application Support/BoatPon/releases/${SHA}`;
  const plist = buildN2TrifectaLocalCaptureLaunchAgentPlist({
    nodePath: "/opt/homebrew/bin/node",
    tsxCliPath: `${escapedRuntime}/node_modules/tsx/dist/cli.mjs`,
    tickScriptPath: `${escapedRuntime}/scripts/tick.ts`,
    workingDirectory: escapedRuntime,
    authoritySha: SHA,
    runtimeRoot: escapedRuntime,
    dataRoot: "/Users/a&b/boat-pon",
    authorizationPath: "/Users/a&b/boat-pon/auth.json",
    runtimeAuthorityPath: "/Users/a&b/boat-pon/runtime-auth.json",
    stdoutPath: "/Users/a&b/boat-pon/out.log",
    stderrPath: "/Users/a&b/boat-pon/err.log",
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
