import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateLearning, type LearningRecord } from "./contracts";
import { evaluateLearningGate } from "./learningGate";
import { appendRecordIdempotent, appendRecordStrict, listRecords, validateAllRegistries } from "./registryStore";

const base: LearningRecord = {
  learningId: "LEARN-example-1",
  classification: "NEW_FAILURE",
  fingerprintKey: "research.registry.same-attempt",
  subsystem: "research-governance",
  operation: "append",
  symptom: "same attempt failed",
  rootCauseClass: "UNCHANGED_FAILURE",
  attemptSignature: "method-a",
  authorityState: { mainSha: "0123456789abcdef0123456789abcdef01234567", environmentKey: "ci" },
  evidenceRefs: ["github-actions/run-1"],
  lesson: "do not repeat unchanged work",
  guardrail: "switch method before retry",
  repeatPolicy: "BLOCK_SAME_ATTEMPT_UNTIL_CHANGE",
  createdAt: "2026-09-18T00:00:00Z",
  productionConnection: false,
};

test("learning contract is fail-closed and privacy-safe", () => {
  assert.equal(validateLearning(base).valid, true);
  assert.equal(validateLearning({ ...base, productionConnection: true }).valid, false);
  assert.equal(validateLearning({ ...base, evidenceRefs: ["/Users/example/private.json"] }).valid, false);
  assert.equal(validateLearning({ ...base, evidenceRefs: ["data/private/raw.json"] }).valid, false);
  assert.equal(validateLearning({ ...base, authorityState: { ...base.authorityState, mainSha: "short" } }).valid, false);
});

test("learning registry is append-only, digest checked, and idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "learning-reg-"));
  assert.equal(appendRecordStrict(root, "learnings", base).code, "OK");
  assert.equal(appendRecordIdempotent(root, "learnings", base).code, "ALREADY_RECORDED");
  assert.equal(appendRecordIdempotent(root, "learnings", { ...base, lesson: "changed" }).code, "CONFLICT");
  assert.equal(listRecords<LearningRecord>(root, "learnings").length, 1);
  assert.equal(validateAllRegistries(root).ok, true);
});

test("one unchanged failure switches method; two block the third identical attempt", () => {
  const second = { ...base, learningId: "LEARN-example-2", createdAt: "2026-09-18T01:00:00Z" };
  const attempt = {
    fingerprintKey: base.fingerprintKey,
    attemptSignature: base.attemptSignature,
    authorityState: base.authorityState,
  };

  assert.equal(evaluateLearningGate([base], attempt).action, "SWITCH_METHOD");
  assert.equal(evaluateLearningGate([base, second], attempt).action, "BLOCK_REPEAT");
});

test("material authority/environment change permits a new attempt with prior learning visible", () => {
  const decision = evaluateLearningGate([base], {
    fingerprintKey: base.fingerprintKey,
    attemptSignature: base.attemptSignature,
    authorityState: { mainSha: "1111111111111111111111111111111111111111", environmentKey: "ci-v2" },
  });
  assert.equal(decision.action, "PROCEED");
  assert.match(decision.reason, /prior learning exists/);
});

test("latest verified success is reused as a guardrail", () => {
  const success: LearningRecord = {
    ...base,
    learningId: "LEARN-success-1",
    classification: "VERIFIED_SUCCESS",
    guardrail: "use method-b",
    repeatPolicy: "REUSE_VERIFIED_GUARDRAIL",
    createdAt: "2026-09-18T02:00:00Z",
  };
  const decision = evaluateLearningGate([base, success], {
    fingerprintKey: base.fingerprintKey,
    attemptSignature: "method-b",
    authorityState: base.authorityState,
  });
  assert.equal(decision.action, "REUSE_GUARDRAIL");
  if (decision.action === "REUSE_GUARDRAIL") assert.equal(decision.guardrail, "use method-b");
});
