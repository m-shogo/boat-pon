import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import {
  assertOfficialProgramCanaryManifest,
  N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES,
  officialProgramCanaryApprovalTarget,
  type OfficialProgramCanaryManifest,
} from "./n2OfficialProgramCanary";

export const N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION =
  "n2-official-program-canary-review-bundle-v2";
export const N2_OFFICIAL_PROGRAM_CANARY_REVIEW_POLICY_VERSION =
  "n2-official-program-canary-review-policy-v2";

export type OfficialProgramCanaryReviewStatus =
  | "READY_FOR_HUMAN_REVIEW"
  | "BLOCKED_INCOMPLETE_CANARY"
  | "BLOCKED_EXISTING_OBSERVATIONS_REVIEW_REQUIRED"
  | "BLOCKED_UNEXPECTED_PRODUCTION_APPROVAL"
  | "BLOCKED_RUNTIME_STATE";

export type OfficialProgramCanaryApprovalPreview = {
  approved: boolean;
  code: string;
  approvalId: string | null;
  blocks: string[];
};

export type OfficialProgramCanaryReviewBundleBinding = {
  bundleVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION;
  reviewPolicyVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_REVIEW_POLICY_VERSION;
  authoritySha: string;
  manifestDigest: string;
  manifestCodeGitSha: string;
  manifestGeneratedAt: string;
  selectedRaceCount: number;
  approvalTarget: ReturnType<typeof officialProgramCanaryApprovalTarget>;
  currentOfficialProgramObservationCount: number;
  currentTrifectaMarketObservationCount: number;
  currentGlobalShadowWriteEnabled: boolean;
  currentKillSwitchEngaged: boolean;
  approvalPreview: OfficialProgramCanaryApprovalPreview;
  executionContract: {
    requiredCheckoutSha: string;
    sourceMode: "EXISTING_CACHE";
    hardMaximumRaceCount: typeof N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES;
    exactManifestDigestRequired: true;
    exactProductionApprovalRequired: true;
    manifestGeneratedAtMustNotExceedBundleGeneratedAt: true;
    globalShadowWriteMustRemainDisabled: true;
    primaryDatabaseMustRemainReadOnly: true;
    productionApplyAuthorized: false;
  };
  rollbackContract: {
    automaticDeleteAllowed: false;
    appendOnlyEvidenceRetained: true;
    stopFutureCanaryOnAnyFailure: true;
    requireSeparateReviewedQuarantineOrSupersession: true;
  };
};

export type OfficialProgramCanaryReviewBundle = {
  bundleVersion: typeof N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION;
  generatedAt: string;
  status: OfficialProgramCanaryReviewStatus;
  writeAuthorized: false;
  productionApplyExecuted: false;
  humanApprovalCreated: false;
  manifest: OfficialProgramCanaryManifest;
  binding: OfficialProgramCanaryReviewBundleBinding;
  bundleDigest: string;
  reviewBlocks: string[];
  nextActions: string[];
};

function assertNonNegativeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function canonicalGenerationTimes(input: {
  manifestGeneratedAt: string;
  bundleGeneratedAt: string;
}): { manifestGeneratedAt: string; bundleGeneratedAt: string } {
  const manifestGeneratedAt = canonicalUtcTimestamp(input.manifestGeneratedAt);
  const bundleGeneratedAt = canonicalUtcTimestamp(input.bundleGeneratedAt);
  if (Date.parse(manifestGeneratedAt) > Date.parse(bundleGeneratedAt)) {
    throw new Error("MANIFEST_GENERATED_AT_AFTER_BUNDLE_GENERATED_AT");
  }
  return { manifestGeneratedAt, bundleGeneratedAt };
}

function deriveReviewStatus(input: {
  selectedRaceCount: number;
  officialObservationCount: number;
  approvalApproved: boolean;
  shadowWriteEnabled: boolean;
  killSwitchEngaged: boolean;
}): { status: OfficialProgramCanaryReviewStatus; blocks: string[] } {
  const blocks: string[] = [];
  if (input.selectedRaceCount !== N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES) {
    blocks.push(`CANARY_SELECTION_NOT_EXACTLY_${N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES}`);
  }
  if (input.officialObservationCount > 0) {
    blocks.push("EXISTING_OFFICIAL_PROGRAM_OBSERVATIONS_REQUIRE_REVIEW");
  }
  if (input.approvalApproved) blocks.push("PRODUCTION_APPROVAL_ALREADY_ACTIVE");
  if (input.shadowWriteEnabled) blocks.push("GLOBAL_SHADOW_WRITE_ENABLED");
  if (input.killSwitchEngaged) blocks.push("KILL_SWITCH_ENGAGED");

  if (input.shadowWriteEnabled || input.killSwitchEngaged) {
    return { status: "BLOCKED_RUNTIME_STATE", blocks };
  }
  if (input.approvalApproved) {
    return { status: "BLOCKED_UNEXPECTED_PRODUCTION_APPROVAL", blocks };
  }
  if (input.officialObservationCount > 0) {
    return { status: "BLOCKED_EXISTING_OBSERVATIONS_REVIEW_REQUIRED", blocks };
  }
  if (input.selectedRaceCount !== N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES) {
    return { status: "BLOCKED_INCOMPLETE_CANARY", blocks };
  }
  return { status: "READY_FOR_HUMAN_REVIEW", blocks };
}

export function buildOfficialProgramCanaryReviewBundle(input: {
  manifest: OfficialProgramCanaryManifest;
  authoritySha: string;
  generatedAt: string;
  currentOfficialProgramObservationCount: number;
  currentTrifectaMarketObservationCount: number;
  currentGlobalShadowWriteEnabled: boolean;
  currentKillSwitchEngaged: boolean;
  approvalPreview: OfficialProgramCanaryApprovalPreview;
}): OfficialProgramCanaryReviewBundle {
  assertOfficialProgramCanaryManifest(input.manifest);
  if (!/^[a-f0-9]{7,40}$/.test(input.authoritySha)) throw new Error("INVALID_REVIEW_AUTHORITY_SHA");
  if (input.authoritySha !== input.manifest.binding.codeGitSha) {
    throw new Error("REVIEW_AUTHORITY_MANIFEST_CODE_SHA_MISMATCH");
  }
  assertNonNegativeInteger(
    input.currentOfficialProgramObservationCount,
    "INVALID_OFFICIAL_PROGRAM_OBSERVATION_COUNT",
  );
  assertNonNegativeInteger(
    input.currentTrifectaMarketObservationCount,
    "INVALID_TRIFECTA_MARKET_OBSERVATION_COUNT",
  );
  if (typeof input.approvalPreview.approved !== "boolean"
    || typeof input.approvalPreview.code !== "string"
    || !Array.isArray(input.approvalPreview.blocks)
    || input.approvalPreview.blocks.some((block) => typeof block !== "string")) {
    throw new Error("INVALID_APPROVAL_PREVIEW");
  }
  const times = canonicalGenerationTimes({
    manifestGeneratedAt: input.manifest.generatedAt,
    bundleGeneratedAt: input.generatedAt,
  });
  const review = deriveReviewStatus({
    selectedRaceCount: input.manifest.binding.items.length,
    officialObservationCount: input.currentOfficialProgramObservationCount,
    approvalApproved: input.approvalPreview.approved,
    shadowWriteEnabled: input.currentGlobalShadowWriteEnabled,
    killSwitchEngaged: input.currentKillSwitchEngaged,
  });
  const approvalTarget = officialProgramCanaryApprovalTarget(input.manifest.manifestDigest);
  const binding: OfficialProgramCanaryReviewBundleBinding = {
    bundleVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION,
    reviewPolicyVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_POLICY_VERSION,
    authoritySha: input.authoritySha,
    manifestDigest: input.manifest.manifestDigest,
    manifestCodeGitSha: input.manifest.binding.codeGitSha,
    manifestGeneratedAt: times.manifestGeneratedAt,
    selectedRaceCount: input.manifest.binding.items.length,
    approvalTarget,
    currentOfficialProgramObservationCount: input.currentOfficialProgramObservationCount,
    currentTrifectaMarketObservationCount: input.currentTrifectaMarketObservationCount,
    currentGlobalShadowWriteEnabled: input.currentGlobalShadowWriteEnabled,
    currentKillSwitchEngaged: input.currentKillSwitchEngaged,
    approvalPreview: {
      approved: input.approvalPreview.approved,
      code: input.approvalPreview.code,
      approvalId: input.approvalPreview.approvalId,
      blocks: [...input.approvalPreview.blocks],
    },
    executionContract: {
      requiredCheckoutSha: input.authoritySha,
      sourceMode: "EXISTING_CACHE",
      hardMaximumRaceCount: N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES,
      exactManifestDigestRequired: true,
      exactProductionApprovalRequired: true,
      manifestGeneratedAtMustNotExceedBundleGeneratedAt: true,
      globalShadowWriteMustRemainDisabled: true,
      primaryDatabaseMustRemainReadOnly: true,
      productionApplyAuthorized: false,
    },
    rollbackContract: {
      automaticDeleteAllowed: false,
      appendOnlyEvidenceRetained: true,
      stopFutureCanaryOnAnyFailure: true,
      requireSeparateReviewedQuarantineOrSupersession: true,
    },
  };
  const bundle: OfficialProgramCanaryReviewBundle = {
    bundleVersion: N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION,
    generatedAt: times.bundleGeneratedAt,
    status: review.status,
    writeAuthorized: false,
    productionApplyExecuted: false,
    humanApprovalCreated: false,
    manifest: input.manifest,
    binding,
    bundleDigest: canonicalHash(binding),
    reviewBlocks: review.blocks,
    nextActions: [
      "Review the exact 20 selected identities, exclusion counts, manifest digest and required checkout SHA.",
      "Do not create an approval until the rollback and evidence review is complete.",
      "Any later apply must check out the exact authority SHA and re-resolve the exact production approval at apply time.",
      "Keep global shadow writes disabled and do not consume N2-011's final attempt yet.",
    ],
  };
  assertOfficialProgramCanaryReviewBundle(bundle);
  return bundle;
}

export function assertOfficialProgramCanaryReviewBundle(
  bundle: OfficialProgramCanaryReviewBundle,
): void {
  if (bundle.bundleVersion !== N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION
    || bundle.binding.bundleVersion !== N2_OFFICIAL_PROGRAM_CANARY_REVIEW_BUNDLE_VERSION
    || bundle.binding.reviewPolicyVersion !== N2_OFFICIAL_PROGRAM_CANARY_REVIEW_POLICY_VERSION) {
    throw new Error("REVIEW_BUNDLE_VERSION_MISMATCH");
  }
  const times = canonicalGenerationTimes({
    manifestGeneratedAt: bundle.manifest.generatedAt,
    bundleGeneratedAt: bundle.generatedAt,
  });
  assertOfficialProgramCanaryManifest(bundle.manifest);
  if (bundle.writeAuthorized !== false
    || bundle.productionApplyExecuted !== false
    || bundle.humanApprovalCreated !== false
    || bundle.binding.executionContract.productionApplyAuthorized !== false
    || bundle.binding.executionContract.manifestGeneratedAtMustNotExceedBundleGeneratedAt !== true
    || bundle.binding.executionContract.hardMaximumRaceCount !== N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES
    || bundle.binding.executionContract.requiredCheckoutSha !== bundle.binding.authoritySha
    || bundle.binding.manifestDigest !== bundle.manifest.manifestDigest
    || bundle.binding.manifestCodeGitSha !== bundle.manifest.binding.codeGitSha
    || bundle.binding.manifestGeneratedAt !== times.manifestGeneratedAt
    || bundle.binding.authoritySha !== bundle.manifest.binding.codeGitSha) {
    throw new Error("REVIEW_BUNDLE_SAFETY_CONTRACT_MISMATCH");
  }
  if (bundle.bundleDigest !== canonicalHash(bundle.binding)) {
    throw new Error("REVIEW_BUNDLE_DIGEST_MISMATCH");
  }
  const expectedTarget = officialProgramCanaryApprovalTarget(bundle.manifest.manifestDigest);
  if (canonicalHash(bundle.binding.approvalTarget) !== canonicalHash(expectedTarget)) {
    throw new Error("REVIEW_BUNDLE_APPROVAL_TARGET_MISMATCH");
  }
}
