import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialProgramCanaryManifest,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";
import {
  assertOfficialProgramCanaryReviewBundle,
  buildOfficialProgramCanaryReviewBundle,
} from "./n2OfficialProgramCanaryReviewBundle";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function raw(rate: number): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: rate + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function rows(count = 20): OfficialProgramCanarySourceRow[] {
  return Array.from({ length: count }, (_, index) => {
    const venue = index < 12 ? "桐生" : "戸田";
    const raceNo = (index % 12) + 1;
    return {
      raceId: `20040101-${venue}-${String(raceNo).padStart(2, "0")}`,
      date: "2004-01-01",
      venue,
      raceNo,
      closeAt: "23:00",
      sourceFile: `/private/cache/${index}.json`,
      rawJson: raw(5 + index / 100),
      importedAt: "2004-01-01 01:00:00",
    };
  });
}

function manifest(count = 20) {
  return buildOfficialProgramCanaryManifest({
    rows: rows(count),
    cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-07" },
    maxRaces: 20,
    codeGitSha: SHA,
    generatedAt: "2004-01-08T00:00:00Z",
  });
}

function bundle(overrides: Partial<Parameters<typeof buildOfficialProgramCanaryReviewBundle>[0]> = {}) {
  return buildOfficialProgramCanaryReviewBundle({
    manifest: manifest(),
    authoritySha: SHA,
    generatedAt: "2004-01-08T00:00:00Z",
    currentOfficialProgramObservationCount: 0,
    currentTrifectaMarketObservationCount: 0,
    currentGlobalShadowWriteEnabled: false,
    currentKillSwitchEngaged: false,
    approvalPreview: {
      approved: false,
      code: "HUMAN_APPROVAL_MISSING",
      approvalId: null,
      blocks: ["APPROVAL_HUMAN_APPROVAL_MISSING"],
    },
    ...overrides,
  });
}

test("exact 20-race bundle is ready only for human review and never authorizes apply", () => {
  const result = bundle();
  assert.equal(result.status, "READY_FOR_HUMAN_REVIEW");
  assert.equal(result.writeAuthorized, false);
  assert.equal(result.productionApplyExecuted, false);
  assert.equal(result.humanApprovalCreated, false);
  assert.equal(result.binding.executionContract.productionApplyAuthorized, false);
  assert.equal(result.binding.executionContract.requiredCheckoutSha, SHA);
  assert.equal(result.binding.executionContract.hardMaximumRaceCount, 20);
  assert.equal(result.binding.rollbackContract.automaticDeleteAllowed, false);
  assert.doesNotThrow(() => assertOfficialProgramCanaryReviewBundle(result));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("rawJson"), false);
  assert.equal(serialized.includes("/private/cache"), false);
});

test("incomplete selection, existing observations, active approval and runtime hazards block review", () => {
  assert.equal(bundle({ manifest: manifest(19) }).status, "BLOCKED_INCOMPLETE_CANARY");
  assert.equal(bundle({ currentOfficialProgramObservationCount: 1 }).status,
    "BLOCKED_EXISTING_OBSERVATIONS_REVIEW_REQUIRED");
  assert.equal(bundle({
    approvalPreview: {
      approved: true,
      code: "APPROVED",
      approvalId: "unexpected-approval",
      blocks: [],
    },
  }).status, "BLOCKED_UNEXPECTED_PRODUCTION_APPROVAL");
  assert.equal(bundle({ currentGlobalShadowWriteEnabled: true }).status, "BLOCKED_RUNTIME_STATE");
  assert.equal(bundle({ currentKillSwitchEngaged: true }).status, "BLOCKED_RUNTIME_STATE");
});

test("SHA mismatch and binding tampering fail closed", () => {
  assert.throws(() => bundle({ authoritySha: "abcdef1" }), /REVIEW_AUTHORITY_MANIFEST_CODE_SHA_MISMATCH/);
  const result = bundle();
  const tampered = structuredClone(result);
  tampered.binding.executionContract.productionApplyAuthorized = true as false;
  assert.throws(() => assertOfficialProgramCanaryReviewBundle(tampered), /SAFETY_CONTRACT/);
  const digestTampered = structuredClone(result);
  digestTampered.bundleDigest = "0".repeat(64);
  assert.throws(() => assertOfficialProgramCanaryReviewBundle(digestTampered), /DIGEST_MISMATCH/);
});
