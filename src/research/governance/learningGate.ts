import type { LearningRecord } from "./contracts";

export type LearningAttempt = {
  fingerprintKey: string;
  attemptSignature: string;
  authorityState: {
    mainSha: string | null;
    environmentKey: string;
    materialStateKey: string;
  };
};

export type LearningGateDecision =
  | { action: "PROCEED"; learningId: null; reason: string }
  | { action: "SWITCH_METHOD"; learningId: string; reason: string }
  | { action: "BLOCK_REPEAT"; learningId: string; reason: string }
  | { action: "REUSE_GUARDRAIL"; learningId: string; reason: string; guardrail: string };

function sameMaterialState(a: LearningRecord["authorityState"], b: LearningAttempt["authorityState"]): boolean {
  // mainSha is retained as evidence, but unrelated commits must not reset the
  // retry gate. Only the relevant environment/material-state identity does.
  return a.environmentKey === b.environmentKey && a.materialStateKey === b.materialStateKey;
}

export function evaluateLearningGate(records: LearningRecord[], attempt: LearningAttempt): LearningGateDecision {
  const relevant = records
    .filter((record) => record.fingerprintKey === attempt.fingerprintKey)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const matchingAttempt = relevant.filter((record) =>
    record.attemptSignature === attempt.attemptSignature
    && sameMaterialState(record.authorityState, attempt.authorityState)
  );

  // Observational records do not suppress a known-good guardrail, but a later
  // failure must take precedence over an older success. Only decisive records
  // (failure/success) advance the retry gate for this normalized identity.
  const latestDecisive = matchingAttempt.find((record) =>
    record.classification === "NEW_FAILURE"
    || (record.classification === "VERIFIED_SUCCESS" && record.repeatPolicy === "REUSE_VERIFIED_GUARDRAIL")
  );

  if (latestDecisive?.classification === "VERIFIED_SUCCESS") {
    return {
      action: "REUSE_GUARDRAIL",
      learningId: latestDecisive.learningId,
      reason: "latest decisive learning for the matching fingerprint and attempt is a verified reusable success pattern",
      guardrail: latestDecisive.guardrail,
    };
  }

  const latestVerifiedSuccessIndex = matchingAttempt.findIndex((record) =>
    record.classification === "VERIFIED_SUCCESS"
    && record.repeatPolicy === "REUSE_VERIFIED_GUARDRAIL"
  );
  const failureWindow = latestVerifiedSuccessIndex === -1
    ? matchingAttempt
    : matchingAttempt.slice(0, latestVerifiedSuccessIndex);
  const unchangedFailures = failureWindow.filter((record) => record.classification === "NEW_FAILURE");

  if (unchangedFailures.length >= 2) {
    return {
      action: "BLOCK_REPEAT",
      learningId: unchangedFailures[0].learningId,
      reason: "two unchanged failures already exist for this fingerprint and attempt since the latest verified success",
    };
  }

  if (unchangedFailures.length === 1) {
    return {
      action: "SWITCH_METHOD",
      learningId: unchangedFailures[0].learningId,
      reason: "an unchanged failure exists after the latest verified success; repeating the same method is not learning",
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

export function detectLearningRetryViolations(records: LearningRecord[]): string[] {
  const byAttempt = new Map<string, LearningRecord[]>();
  for (const record of records) {
    const key = [
      record.fingerprintKey,
      record.attemptSignature,
      record.authorityState.environmentKey,
      record.authorityState.materialStateKey,
    ].join("|");
    const group = byAttempt.get(key) ?? [];
    group.push(record);
    byAttempt.set(key, group);
  }

  const violations: string[] = [];
  for (const [key, group] of byAttempt) {
    const ordered = group.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let failureCount = 0;
    let latestFailureId: string | null = null;
    let violationReported = false;

    for (const record of ordered) {
      if (record.classification === "VERIFIED_SUCCESS" && record.repeatPolicy === "REUSE_VERIFIED_GUARDRAIL") {
        failureCount = 0;
        latestFailureId = null;
        violationReported = false;
        continue;
      }
      if (record.classification !== "NEW_FAILURE") continue;

      failureCount += 1;
      latestFailureId = record.learningId;
      if (failureCount > 2 && !violationReported) {
        violations.push(
          `learning retry gate violated: ${failureCount} unchanged failures for ${key} (latest ${latestFailureId})`
        );
        violationReported = true;
      }
    }
  }

  return violations;
}
