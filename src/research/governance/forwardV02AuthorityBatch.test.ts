import assert from "node:assert/strict";
import test from "node:test";
import { assessForwardV02AuthorityBatch } from "./forwardV02AuthorityBatch";

const h = (c: string) => c.repeat(64);
function envelope() {
  return {
    schemaVersion: "forward-v02-authority-metadata.0.1-untrusted",
    evidenceStage: "SHADOW_FORWARD",
    freeze: {
      cohortId: "synthetic-cohort", protocolDigest: h("a"), membershipDigest: h("b"),
      firstDecisionAt: "2026-10-24T00:00:00.0002Z",
      expectedMembership: ["synthetic-decision-1", "synthetic-decision-2"],
      includedMembership: ["synthetic-decision-1"], excludedMembership: ["synthetic-decision-2"],
      witness: {
        receiptId: "synthetic-receipt", issuerId: "caller-selected-issuer",
        receiptAt: "2026-10-24T00:00:00.0001Z", protocolDigest: h("a"),
        membershipDigest: h("b"), signatureDigest: h("c"), trustAnchorId: "caller-selected-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision-1", decisionId: "synthetic-decision-1",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "caller-selected-source", trustAnchorId: "caller-selected-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{
        revisionId: "synthetic-revision-1", contentDigest: h("d"),
        predecessorDigest: null as string | null, sequence: 1,
        observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
      }],
    },
  };
}
const copy = (e: ReturnType<typeof envelope>) => structuredClone(e);
const check = (x: unknown) => assessForwardV02AuthorityBatch(x);

test("idempotent repeated envelope remains internally consistent but never independently verified", () => {
  const e = envelope();
  assert.deepEqual(check([e, copy(e)]), {
    metadataConsistent: true, independentAuthorityVerified: false, scoringAuthorized: false,
    blockers: ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"],
  });
});
test("one cohort witness may cover different decisions with distinct source revision identities", () => {
  const first = envelope(), second = copy(first);
  second.settlement.expectedDecisionId = "synthetic-decision-2";
  second.settlement.decisionId = "synthetic-decision-2";
  second.settlement.disposition = "REFUNDED";
  second.settlement.evaluable = false;
  second.settlement.revisions[0]!.revisionId = "synthetic-revision-2";
  assert.equal(check([first, second]).metadataConsistent, true);
  assert.equal(check([first, second]).scoringAuthorized, false);
});
test("issuer-scoped receipt reuse for another cohort is a conflict even with matching digests", () => {
  const first = envelope(), second = copy(first);
  second.freeze.cohortId = "synthetic-other-cohort";
  assert.deepEqual(check([first, second]).blockers, ["RECEIPT_REPLAY_CONFLICT"]);
});
test("same receipt cannot silently replace the included/excluded frozen partition", () => {
  const first = envelope(), second = copy(first);
  second.freeze.includedMembership = ["synthetic-decision-2"];
  second.freeze.excludedMembership = ["synthetic-decision-1"];
  second.settlement.expectedDecisionId = "synthetic-decision-2";
  second.settlement.decisionId = "synthetic-decision-2";
  assert.deepEqual(check([first, second]).blockers, ["RECEIPT_REPLAY_CONFLICT"]);
});
test("source-scoped revision ID with different digest is a conflict", () => {
  const first = envelope(), second = copy(first);
  second.freeze.witness.receiptId = "synthetic-receipt-2";
  second.settlement.revisions[0]!.contentDigest = h("e");
  assert.deepEqual(check([first, second]).blockers, ["SOURCE_REVISION_REPLAY_CONFLICT"]);
});
test("source-scoped revision ID cannot be replayed for a different decision with identical digest", () => {
  const first = envelope(), second = copy(first);
  second.settlement.expectedDecisionId = "synthetic-decision-2";
  second.settlement.decisionId = "synthetic-decision-2";
  second.settlement.disposition = "REFUNDED";
  second.settlement.evaluable = false;
  assert.deepEqual(check([first, second]).blockers, ["SOURCE_REVISION_REPLAY_CONFLICT"]);
});
test("different issuer and source namespaces do not create a false collision", () => {
  const first = envelope(), second = copy(first);
  second.freeze.witness.issuerId = "other-untrusted-issuer";
  second.freeze.cohortId = "other-synthetic-cohort";
  second.settlement.sourceId = "other-untrusted-source";
  assert.equal(check([first, second]).metadataConsistent, true);
  assert.equal(check([first, second]).independentAuthorityVerified, false);
});
test("individually invalid envelopes are denied before cross-envelope reconciliation", () => {
  const first = envelope(), second = copy(first);
  second.freeze.witness.receiptAt = second.freeze.firstDecisionAt;
  assert.deepEqual(check([first, second]).blockers, ["INVALID_ENVELOPE"]);
});
test("sparse, accessor, and extra-property batches fail closed", () => {
  const sparse = new Array(2); sparse[0] = envelope();
  assert.deepEqual(check(sparse).blockers, ["INVALID_BATCH"]);
  const accessor = [envelope()];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { throw Error("getter"); } });
  assert.deepEqual(check(accessor).blockers, ["INVALID_BATCH"]);
  const extra = [envelope()] as Array<ReturnType<typeof envelope>> & { surprise?: boolean };
  extra.surprise = true;
  assert.deepEqual(check(extra).blockers, ["INVALID_BATCH"]);
});
test("empty and non-array batches cannot claim authority", () => {
  for (const value of [[], {}, null, "synthetic"]) {
    assert.equal(check(value).metadataConsistent, false);
    assert.equal(check(value).independentAuthorityVerified, false);
    assert.equal(check(value).scoringAuthorized, false);
  }
});

test("batch replay pins first cohort before later array descriptor mutates its receipt commitment", () => {
  const first = envelope(), second = copy(first);
  second.freeze.cohortId = "synthetic-other-cohort";
  let secondDescriptorReads = 0;
  const input = new Proxy([first, second], {
    getOwnPropertyDescriptor(target, key) {
      if (key === "1" && ++secondDescriptorReads === 1) {
        first.freeze.cohortId = "synthetic-other-cohort";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = check(input);
  assert.ok(secondDescriptorReads >= 1, "later array descriptor mutation must execute");
  assert.equal(first.freeze.cohortId, "synthetic-other-cohort");
  assert.deepEqual(r.blockers, ["RECEIPT_REPLAY_CONFLICT"]);
  assert.equal(r.metadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("batch replay pins first revision before later array descriptor rewrites its content digest", () => {
  const first = envelope(), second = copy(first);
  second.settlement.revisions[0]!.contentDigest = h("e");
  let secondDescriptorReads = 0;
  const input = new Proxy([first, second], {
    getOwnPropertyDescriptor(target, key) {
      if (key === "1" && ++secondDescriptorReads === 1) {
        first.settlement.revisions[0]!.contentDigest = h("e");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = check(input);
  assert.ok(secondDescriptorReads >= 1, "later array descriptor mutation must execute");
  assert.equal(first.settlement.revisions[0]!.contentDigest, h("e"));
  assert.deepEqual(r.blockers, ["SOURCE_REVISION_REPLAY_CONFLICT"]);
  assert.equal(r.metadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("live batch length getter cannot repair a conflicting receipt before snapshot", () => {
  const first = envelope(), second = copy(first);
  first.freeze.cohortId = "synthetic-other-cohort";
  let lengthGetterCalls = 0;
  const input = new Proxy([first, second], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthGetterCalls++;
        first.freeze.cohortId = "synthetic-cohort";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const r = check(input);
  assert.equal(lengthGetterCalls, 0, "caller-controlled length getter must not run");
  assert.equal(first.freeze.cohortId, "synthetic-other-cohort");
  assert.deepEqual(r.blockers, ["RECEIPT_REPLAY_CONFLICT"]);
  assert.equal(r.metadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("live batch toJSON has trap cannot repair a conflicting source revision before snapshot", () => {
  const first = envelope(), second = copy(first);
  first.settlement.revisions[0]!.contentDigest = h("e");
  let hasTrapCalls = 0;
  const input = new Proxy([first, second], {
    has(target, key) {
      if (key === "toJSON") {
        hasTrapCalls++;
        first.settlement.revisions[0]!.contentDigest = h("d");
      }
      return Reflect.has(target, key);
    },
  });
  const r = check(input);
  assert.equal(hasTrapCalls, 0, "caller-controlled membership trap must not run");
  assert.equal(first.settlement.revisions[0]!.contentDigest, h("e"));
  assert.deepEqual(r.blockers, ["SOURCE_REVISION_REPLAY_CONFLICT"]);
  assert.equal(r.metadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("batch denial and unverified assessments are runtime-immutable, including blockers", () => {
  const assessments = [
    check([envelope()]),
    check([]),
    check([envelope(), { invalid: true }]),
  ];
  for (const assessment of assessments) {
    assert.equal(assessment.independentAuthorityVerified, false);
    assert.equal(assessment.scoringAuthorized, false);
    assert.equal(Object.isFrozen(assessment), true);
    assert.equal(Object.isFrozen(assessment.blockers), true);
    const originalBlockers = [...assessment.blockers];
    assert.throws(() => {
      (assessment as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (assessment.blockers as string[]).push("SCORING_APPROVED");
    }, TypeError);
    assert.equal(assessment.scoringAuthorized, false);
    assert.deepEqual(assessment.blockers, originalBlockers);
  }
});
