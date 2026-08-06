import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION,
  auditN2TrifectaImmutableRuntimeAuthority,
  buildN2TrifectaImmutableRuntimeAuthorityBinding,
  recordN2TrifectaImmutableRuntimeBlock,
  type N2TrifectaImmutableRuntimeAuthorityBinding,
  type N2TrifectaObservedRuntimeAuthority,
} from "./n2TrifectaImmutableRuntimeAuthority.js";
import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUNTIME = `/Users/test/Library/Application Support/BoatPon/trifecta-private-capture/releases/${SHA}`;

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-private-research-0001",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    stage: "ONE_VENUE_REVIEW",
    maxRequestsPerDay: 48,
    checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
    minInterRequestMs: 10_000,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

function binding(
  overrides: Partial<N2TrifectaImmutableRuntimeAuthorityBinding> = {},
): N2TrifectaImmutableRuntimeAuthorityBinding {
  return {
    authorityVersion: N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION,
    authorizationId: authorization().authorizationId,
    issuedAt: authorization().issuedAt,
    expiresAt: authorization().expiresAt,
    authoritySha: SHA,
    runtimeRoot: RUNTIME,
    privateResearchOnly: true,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
    ...overrides,
  };
}

function observed(
  overrides: Partial<N2TrifectaObservedRuntimeAuthority> = {},
): N2TrifectaObservedRuntimeAuthority {
  return {
    actualAuthoritySha: SHA,
    actualRuntimeRoot: RUNTIME,
    detachedHead: true,
    trackedWorktreeClean: true,
    ...overrides,
  };
}

test("binding inherits the exact authorization interval and private-only boundaries", () => {
  const result = buildN2TrifectaImmutableRuntimeAuthorityBinding({
    authorization: authorization(),
    authoritySha: SHA,
    runtimeRoot: RUNTIME,
  });
  assert.equal(result.authorizationId, authorization().authorizationId);
  assert.equal(result.issuedAt, authorization().issuedAt);
  assert.equal(result.expiresAt, authorization().expiresAt);
  assert.equal(result.authoritySha, SHA);
  assert.equal(result.runtimeRoot, RUNTIME);
  assert.equal(result.databaseWriteAuthorized, false);
  assert.equal(result.currentBuyConnectionAuthorized, false);
  assert.equal(result.lineConnectionAuthorized, false);
  assert.equal(result.publicPublishAuthorized, false);
  assert.equal(result.automatedBettingAuthorized, false);
});

test("exact detached clean runtime authority passes", () => {
  assert.deepEqual(auditN2TrifectaImmutableRuntimeAuthority({
    authorization: authorization(),
    binding: binding(),
    observed: observed(),
    now: "2026-08-06T00:35:00.000Z",
  }), {
    status: "PASS",
    blockers: [],
    authorizationMatched: true,
    authorityMatched: true,
    runtimeRootMatched: true,
    detachedHead: true,
    trackedWorktreeClean: true,
  });
});

test("SHA, root, attached branch, tracked dirt and authorization mismatch fail closed", () => {
  const cases: Array<{
    binding?: Partial<N2TrifectaImmutableRuntimeAuthorityBinding>;
    observed?: Partial<N2TrifectaObservedRuntimeAuthority>;
    blocker: string;
  }> = [
    { observed: { actualAuthoritySha: "f".repeat(40) }, blocker: "AUTHORITY_SHA_MISMATCH" },
    { observed: { actualRuntimeRoot: "/tmp/other-runtime" }, blocker: "RUNTIME_ROOT_MISMATCH" },
    { observed: { detachedHead: false }, blocker: "RUNTIME_HEAD_NOT_DETACHED" },
    { observed: { trackedWorktreeClean: false }, blocker: "RUNTIME_TRACKED_WORKTREE_DIRTY" },
    { binding: { authorizationId: "AUTH-N2-TRI-LOCAL-other-private-0001" }, blocker: "AUTHORIZATION_ID_MISMATCH" },
  ];
  for (const item of cases) {
    const result = auditN2TrifectaImmutableRuntimeAuthority({
      authorization: authorization(),
      binding: binding(item.binding),
      observed: observed(item.observed),
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes(item.blocker));
  }
});

test("runtime blocker evidence is private, zero-network and event-deduplicated", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-runtime-authority-"));
  try {
    const audit = auditN2TrifectaImmutableRuntimeAuthority({
      authorization: authorization(),
      binding: binding(),
      observed: observed({ detachedHead: false }),
      now: "2026-08-06T00:35:00.000Z",
    });
    const first = recordN2TrifectaImmutableRuntimeBlock({
      dataRoot: root,
      now: "2026-08-06T00:35:00.000Z",
      audit,
      binding: binding(),
      observed: observed({ detachedHead: false }),
    });
    const second = recordN2TrifectaImmutableRuntimeBlock({
      dataRoot: root,
      now: "2026-08-06T00:35:30.000Z",
      audit,
      binding: binding(),
      observed: observed({ detachedHead: false }),
    });
    assert.equal(first.status, "BLOCKED");
    assert.equal(first.eventChanged, true);
    assert.ok(first.reportRelativePath);
    assert.equal(second.eventChanged, false);
    assert.equal(second.reportRelativePath, null);
    assert.equal(first.networkRequestCount, 0);
    assert.equal(first.databaseWriteCount, 0);
    assert.equal(first.currentBuyChanged, false);
    assert.equal(first.lineChanged, false);
    assert.equal(first.publicPublished, false);
    assert.equal(first.automatedBettingChanged, false);
    assert.equal(existsSync(join(root, first.latestStatusRelativePath)), true);
    const reportDir = join(
      root,
      "data/private/trifecta-capture/reports/runtime-authority/2026-08-06",
    );
    assert.equal(readdirSync(reportDir).filter((name) => name.endsWith(".json")).length, 1);
    const latest = JSON.parse(readFileSync(
      join(root, first.latestStatusRelativePath),
      "utf8",
    )) as { eventDigest: string };
    assert.equal(latest.eventDigest, first.eventDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
