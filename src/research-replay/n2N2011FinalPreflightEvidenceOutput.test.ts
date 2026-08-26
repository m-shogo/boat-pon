import assert from "node:assert/strict";
import test from "node:test";
import { assertN2N2011FinalPreflightEvidenceOutputSafe } from "./n2N2011FinalPreflightEvidenceOutput";

const root = "/repo/boat-pon";
const canonicalRepo = "/srv/boat-data";
const primaryDbPath = "/srv/boat-data/data/boat.sqlite";
const sidecarDbPath = "/srv/boat-data/data/research-replay.sqlite";

function assertSafe(evidencePath: string): void {
  assertN2N2011FinalPreflightEvidenceOutputSafe({
    root,
    canonicalRepo,
    primaryDbPath,
    sidecarDbPath,
    evidencePath,
  });
}

test("n2-011 preflight evidence allows canonical validation and external scratch paths", () => {
  assert.doesNotThrow(() => assertSafe("/repo/boat-pon/reports/automation/validation/n2-011.json"));
  assert.doesNotThrow(() => assertSafe("/tmp/n2-011.json"));
});

test("n2-011 preflight evidence rejects runner repository authority and source paths", () => {
  for (const evidencePath of [
    "/repo/boat-pon/scripts/preflight-n2-011-final-audit.ts",
    "/repo/boat-pon/config/research-automation-policy.json",
    "/repo/boat-pon/automation/control/task-queue-state.json",
    "/repo/boat-pon/reports/n2/n2-pit-audit.json",
    "/repo/boat-pon/reports/automation/validation-other/n2-011.json",
  ]) {
    assert.throws(() => assertSafe(evidencePath), /N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN/);
  }
});

test("n2-011 preflight evidence rejects canonical repository authority and source paths", () => {
  for (const evidencePath of [
    "/srv/boat-data/scripts/preflight-n2-011-final-audit.ts",
    "/srv/boat-data/config/research-automation-policy.json",
    "/srv/boat-data/automation/control/task-queue-state.json",
    "/srv/boat-data/reports/n2/n2-pit-audit.json",
  ]) {
    assert.throws(() => assertSafe(evidencePath), /N2_011_PREFLIGHT_EVIDENCE_CANONICAL_REPO_PATH_FORBIDDEN/);
  }
});

test("n2-011 preflight evidence rejects canonical database and data paths", () => {
  for (const evidencePath of [
    primaryDbPath,
    `${primaryDbPath}-wal`,
    `${primaryDbPath}-shm`,
    sidecarDbPath,
    `${sidecarDbPath}-wal`,
    `${sidecarDbPath}-shm`,
  ]) {
    assert.throws(() => assertSafe(evidencePath), /N2_011_PREFLIGHT_EVIDENCE_DATABASE_PATH_FORBIDDEN/);
  }
  for (const evidencePath of [
    "/srv/boat-data/data/tmp/n2-011.json",
    "/srv/boat-data/data/archive.json",
  ]) {
    assert.throws(() => assertSafe(evidencePath), /N2_011_PREFLIGHT_EVIDENCE_DATA_PATH_FORBIDDEN/);
  }
});
