import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION,
  auditN2TrifectaImmutableRuntimeAuthority,
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

const authorization: N2TrifectaLocalCaptureAuthorization = {
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

const binding: N2TrifectaImmutableRuntimeAuthorityBinding = {
  authorityVersion: N2_TRIFECTA_IMMUTABLE_RUNTIME_AUTHORITY_VERSION,
  authorizationId: authorization.authorizationId,
  issuedAt: authorization.issuedAt,
  expiresAt: authorization.expiresAt,
  authoritySha: SHA,
  runtimeRoot: RUNTIME,
  privateResearchOnly: true,
  databaseWriteAuthorized: false,
  currentBuyConnectionAuthorized: false,
  lineConnectionAuthorized: false,
  publicPublishAuthorized: false,
  automatedBettingAuthorized: false,
};

const observed: N2TrifectaObservedRuntimeAuthority = {
  actualAuthoritySha: SHA,
  actualRuntimeRoot: RUNTIME,
  detachedHead: false,
  trackedWorktreeClean: true,
};

function rehashWithNow(content: string, now: string): string {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  parsed.now = now;
  const { outputDigest: _outputDigest, ...core } = parsed;
  parsed.outputDigest = canonicalHash(core);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

test("cross-day rehashed runtime blocker evidence cannot suppress the current JST partition", () => {
  const probeRoot = mkdtempSync(join(tmpdir(), "boat-pon-runtime-block-partition-probe-"));
  const root = mkdtempSync(join(tmpdir(), "boat-pon-runtime-block-partition-forged-"));
  try {
    const now = "2026-08-06T00:35:00.000Z";
    const audit = auditN2TrifectaImmutableRuntimeAuthority({
      authorization,
      binding,
      observed,
      now,
    });
    const probe = recordN2TrifectaImmutableRuntimeBlock({
      dataRoot: probeRoot,
      now,
      audit,
      binding,
      observed,
    });
    assert.ok(probe.reportRelativePath);

    const forgedNow = "2026-08-05T14:59:59.000Z";
    const latestSource = join(probeRoot, probe.latestStatusRelativePath);
    const reportSource = join(probeRoot, probe.reportRelativePath!);
    const latestTarget = join(root, probe.latestStatusRelativePath);
    const reportTarget = join(root, probe.reportRelativePath!);
    mkdirSync(dirname(latestTarget), { recursive: true });
    mkdirSync(dirname(reportTarget), { recursive: true });
    writeFileSync(
      latestTarget,
      rehashWithNow(readFileSync(latestSource, "utf8"), forgedNow),
      "utf8",
    );
    writeFileSync(
      reportTarget,
      rehashWithNow(readFileSync(reportSource, "utf8"), forgedNow),
      "utf8",
    );

    const recorded = recordN2TrifectaImmutableRuntimeBlock({
      dataRoot: root,
      now,
      audit,
      binding,
      observed,
    });

    assert.equal(recorded.eventChanged, true);
    assert.ok(recorded.reportRelativePath);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
