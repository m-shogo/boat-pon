import type { LearningRecord } from "./contracts";

export type LearningAttempt = {
  fingerprintKey: string;
  attemptSignature: string;
  authorityState: {
    mainSha: string | null;
    environmentKey: string;
  };
};

export type LearningGateDecision =
  | { action: "PROCEED"; learningId: null; reason: string }
  | { action: "SWITCH_METHOD"; learningId: string; reason: string }
  | { action: "BLOCK_REPEAT"; learningId: string; reason: string }
  | { action: "REUSE_GUARDRAIL"; learningId: string; reason: string; guardrail: string };

function sameAuthority(a: LearningRecord["authorityState"], b: LearningAttempt["authorityState"]): boolean {
  return a.mainSha === b.mainSha && a.environmentKey === b.environmentKey;
}

export function evaluateLearningGate(records: LearningRecord[], attempt: LearningAttempt): LearningGateDecision {
  const relevant = records
    .filter((record) => record.fingerprintKey === attempt.fingerprintKey)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const latest = relevant[0];
  if (
    latest?.classification === "VERIFIED_SUCCESS"
    && latest.repeatPolicy === "REUSE_VERIFIED_GUARDRAIL"
  ) {
    return {
      action: "REUSE_GUARDRAIL",
      learningId: latest.learningId,
      reason: "latest matching fingerprint has a verified reusable success pattern",
      guardrail: latest.guardrail,
    };
  }

  const unchangedFailures = relevant.filter((record) =>
    record.classification === "NEW_FAILURE"
    && record.attemptSignature === attempt.attemptSignature
    && sameAuthority(record.authorityState, attempt.authorityState)
  );

  if (unchangedFailures.length >= 2) {
    return {
      action: "BLOCK_REPEAT",
      learningId: unchangedFailures[0].learningId,
      reason: "two unchanged failures already exist for this fingerprint and attempt",
    };
  }

  if (unchangedFailures.length === 1) {
    return {
      action: "SWITCH_METHOD",
      learningId: unchangedFailures[0].learningId,
      reason: "an unchanged failure already exists; repeating the same method is not learning",
    };
  }

  return {
    action: "PROCEED",
    learningId: null,
    reason: relevant.length === 0
      ? "no prior learning fingerprint matched"
      : "prior learning exists, but authority/environment or attempt materially differs",
  };
}
