import assert from "node:assert/strict";
import test from "node:test";
import { assessForwardV02AuthorityMetadata } from "./forwardV02AuthorityMetadata";

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
        membershipDigest: h("b"), signatureDigest: h("c"),
        trustAnchorId: "caller-selected-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision-1", decisionId: "synthetic-decision-1",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "caller-selected-source", trustAnchorId: "caller-selected-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{ revisionId: "synthetic-revision-1", contentDigest: h("d"),
        predecessorDigest: null as string | null, sequence: 1,
        observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL" }],
    },
  };
}
const check = (x: unknown) => assessForwardV02AuthorityMetadata(x);

test("perfect synthetic witness and terminal metadata remain UNATTESTED and unscorable", () => {
  assert.deepEqual(check(envelope()), {
    metadataConsistent: true, freezeStatus: "STRUCTURALLY_VALID_UNATTESTED",
    settlementStatus: "STRUCTURALLY_VALID_UNATTESTED",
    independentAuthorityVerified: false, scoringAuthorized: false,
    blockers: ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"],
  });
});
test("caller signature, digest and issuer strings cannot create independent authority", () => {
  const e = envelope(); e.freeze.witness.signatureDigest = h("f");
  e.freeze.witness.issuerId = "self-signed";
  assert.equal(check(e).scoringAuthorized, false);
  assert.equal(check(e).independentAuthorityVerified, false);
  assert.deepEqual(check(e).blockers.slice(0, 2), ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE"]);
});
test("post-outcome manifest backdated createdAt cannot be substituted for a witness", () => {
  const e = envelope() as unknown as Record<string, unknown>;
  e.createdAt = "2026-10-23T00:00:00Z";
  assert.deepEqual(check(e).blockers, ["INVALID_EVIDENCE_SHAPE"]);
});
test("witness receipt at or after first decision fails, including submilliseconds", () => {
  for (const at of ["2026-10-24T00:00:00.0002Z", "2026-10-24T00:00:00.0003Z"]) {
    const e = envelope(); e.freeze.witness.receiptAt = at;
    assert.equal(check(e).freezeStatus, "AFTER_DECISION");
  }
});
test("missing eligible membership cannot be hidden by a matching caller digest", () => {
  const e = envelope(); e.freeze.excludedMembership = [];
  assert.equal(check(e).freezeStatus, "MISSING_MEMBERSHIP");
});
test("duplicate or unknown membership identities fail closed", () => {
  const duplicate = envelope(); duplicate.freeze.excludedMembership = ["synthetic-decision-1"];
  assert.equal(check(duplicate).freezeStatus, "CONFLICT");
  const unknown = envelope(); unknown.freeze.excludedMembership = ["synthetic-other"];
  assert.equal(check(unknown).freezeStatus, "CONFLICT");
});
test("witness commitment mismatch fails closed", () => {
  const e = envelope(); e.freeze.witness.membershipDigest = h("e");
  assert.equal(check(e).freezeStatus, "CONFLICT");
});
test("historical or untouched holdout relabeling cannot claim prospective authority", () => {
  for (const stage of ["HISTORICAL", "VALIDATION", "UNTOUCHED_HOLDOUT"]) {
    const e = envelope(); e.evidenceStage = stage;
    assert.equal(check(e).freezeStatus, "UNSUPPORTED_STAGE");
  }
});
test("same revision identity with different content is a conflict", () => {
  const e = envelope(); e.settlement.revisions.push({
    ...e.settlement.revisions[0]!, contentDigest: h("e"), predecessorDigest: h("d"),
    sequence: 2, observedAt: "2026-10-24T00:00:02Z",
  });
  assert.equal(check(e).settlementStatus, "CONFLICT");
});
test("missing predecessor and forked revision ordering fail closed", () => {
  const missing = envelope(); missing.settlement.revisions.push({
    ...missing.settlement.revisions[0]!, revisionId: "synthetic-revision-2",
    contentDigest: h("e"), predecessorDigest: h("f"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z",
  });
  assert.equal(check(missing).settlementStatus, "INCOMPLETE_REVISION_CHAIN");
  const fork = envelope(); fork.settlement.revisions.push({
    ...fork.settlement.revisions[0]!, revisionId: "synthetic-revision-2",
    contentDigest: h("e"), predecessorDigest: h("d"), sequence: 1,
    observedAt: "2026-10-24T00:00:02Z",
  });
  assert.equal(check(fork).settlementStatus, "INVALID_EVIDENCE_SHAPE");
});
test("a later provisional or revoked revision cannot establish terminality", () => {
  for (const finality of ["PROVISIONAL", "REVOKED"]) {
    const e = envelope(); e.settlement.revisions.push({
      revisionId: "synthetic-revision-2", contentDigest: h("e"),
      predecessorDigest: h("d"), sequence: 2,
      observedAt: "2026-10-24T00:00:02Z", sourceFinality: finality,
    });
    assert.equal(check(e).settlementStatus, "UNRESOLVED_FINALITY");
  }
});
test("terminal revisions with ambiguous order fail closed", () => {
  const e = envelope(); e.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
  });
  assert.equal(check(e).settlementStatus, "CONFLICT");
});
test("a later FINAL cannot launder predecision provisional settlement revisions", () => {
  for (const at of [
    "2026-10-23T23:59:59Z",
    "2026-10-24T00:00:00.0001Z",
    "2026-10-24T00:00:00.0002Z",
  ]) {
    const e = envelope();
    e.settlement.revisions[0]!.observedAt = at;
    e.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
    e.settlement.revisions.push({
      revisionId: "synthetic-revision-2", contentDigest: h("e"),
      predecessorDigest: h("d"), sequence: 2,
      observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
    });
    assert.equal(check(e).settlementStatus, "UNRESOLVED_FINALITY");
    assert.equal(check(e).scoringAuthorized, false);
  }
});
test("postdecision provisional-to-final correction chain remains structurally valid but unverified", () => {
  const e = envelope();
  e.settlement.revisions[0]!.observedAt = "2026-10-24T00:00:00.00021Z";
  e.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  e.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  assert.equal(check(e).metadataConsistent, true);
  assert.equal(check(e).independentAuthorityVerified, false);
  assert.equal(check(e).scoringAuthorized, false);
});

test("decision and ticket mismatch are unresolved identity", () => {
  for (const field of ["decisionId", "ticketKey"] as const) {
    const e = envelope(); e.settlement[field] = "synthetic-other";
    assert.equal(check(e).settlementStatus, "UNRESOLVED_IDENTITY");
  }
});
test("refund, void, and cancelled rows cannot be labeled evaluable", () => {
  for (const disposition of ["REFUNDED", "VOID", "CANCELLED", "UNRESOLVED"]) {
    const e = envelope(); e.settlement.disposition = disposition;
    assert.equal(check(e).settlementStatus, "UNRESOLVED_REFUND_OR_INVALIDATION");
  }
});
test("caller-selected or absent trust anchor never verifies a source", () => {
  const e = envelope(); e.settlement.trustAnchorId = "another-caller-anchor";
  assert.equal(check(e).independentAuthorityVerified, false);
  const absent = envelope(); absent.settlement.trustAnchorId = "";
  assert.equal(check(absent).settlementStatus, "INVALID_EVIDENCE_SHAPE");
});
test("a structurally perfect correction chain remains unverified", () => {
  const e = envelope(); e.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  assert.equal(check(e).metadataConsistent, true);
  assert.equal(check(e).scoringAuthorized, false);
});
test("unknown fields, accessors, sparse arrays, and toJSON are denied", () => {
  const unknown = envelope() as unknown as Record<string, unknown>; unknown.productionConnection = true;
  assert.equal(check(unknown).metadataConsistent, false);
  const accessor = envelope();
  Object.defineProperty(accessor.freeze.witness, "receiptAt", { enumerable: true, get() { throw Error("accessor"); } });
  assert.equal(check(accessor).metadataConsistent, false);
  const sparse = envelope(); sparse.settlement.revisions = new Array(1) as typeof sparse.settlement.revisions;
  assert.equal(check(sparse).metadataConsistent, false);
  const toJSON = envelope();
  Object.defineProperty(toJSON.freeze.expectedMembership, "toJSON", { value: () => [] });
  assert.equal(check(toJSON).metadataConsistent, false);
});
test("invalid dates and fractional chronological inversion are rejected", () => {
  for (const bad of ["2026-02-30T00:00:00Z", "2026-10-24T24:00:00Z", "2026-10-24T00:00:00-00:00"]) {
    const e = envelope(); e.freeze.firstDecisionAt = bad;
    assert.equal(check(e).metadataConsistent, false);
  }
  const e = envelope(); e.freeze.witness.receiptAt = "2026-10-24T00:00:00.00021Z";
  assert.equal(check(e).freezeStatus, "AFTER_DECISION");
});

test("no-op Array.prototype iterator cannot bypass frozen membership coverage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...descriptor, value: function* () { /* synthetic no-op iterator */ },
    });
    const complete = check(envelope());
    assert.equal(complete.metadataConsistent, true);
    assert.equal(complete.scoringAuthorized, false);
    const missing = envelope(); missing.freeze.excludedMembership = [];
    assert.equal(check(missing).freezeStatus, "MISSING_MEMBERSHIP");
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
  }
});

test("frozen-excluded decision cannot be relabeled as evaluable SETTLED", () => {
  const e = envelope();
  e.settlement.expectedDecisionId = "synthetic-decision-2";
  e.settlement.decisionId = "synthetic-decision-2";
  assert.equal(check(e).freezeStatus, "STRUCTURALLY_VALID_UNATTESTED");
  assert.equal(check(e).settlementStatus, "CONFLICT");
  assert.equal(check(e).metadataConsistent, false);
  assert.equal(check(e).scoringAuthorized, false);
});

test("excluded decision may retain non-evaluable refund evidence without scoring", () => {
  const e = envelope();
  e.settlement.expectedDecisionId = "synthetic-decision-2";
  e.settlement.decisionId = "synthetic-decision-2";
  e.settlement.disposition = "REFUNDED";
  e.settlement.evaluable = false;
  assert.equal(check(e).metadataConsistent, true);
  assert.equal(check(e).independentAuthorityVerified, false);
  assert.equal(check(e).scoringAuthorized, false);
});

test("all-excluded frozen cohort cannot admit an evaluable terminal result", () => {
  const e = envelope();
  e.freeze.includedMembership = [];
  e.freeze.excludedMembership = ["synthetic-decision-1", "synthetic-decision-2"];
  assert.equal(check(e).freezeStatus, "STRUCTURALLY_VALID_UNATTESTED");
  assert.equal(check(e).settlementStatus, "CONFLICT");
  assert.equal(check(e).scoringAuthorized, false);
});

test("standalone authority metadata pins an invalid root version before a late Proxy repair", () => {
  const e = envelope();
  e.schemaVersion = "invalid-initial-version";
  let repaired = false;
  const input = new Proxy(e, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "settlement") {
        repaired = true;
        target.schemaVersion = "forward-v02-authority-metadata.0.1-untrusted";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(input);
  assert.equal(repaired, true, "the later descriptor trap must actually run");
  assert.equal(result.metadataConsistent, false);
  assert.deepEqual(result.blockers, ["INVALID_EVIDENCE_SHAPE"]);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
});

test("standalone authority metadata pins an invalid witness commitment before a late Proxy repair", () => {
  const e = envelope();
  e.freeze.witness.membershipDigest = h("e");
  let repaired = false;
  e.freeze.witness = new Proxy(e.freeze.witness, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "trustAnchorId") {
        repaired = true;
        target.membershipDigest = h("b");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = check(e);
  assert.equal(repaired, true, "the later witness descriptor trap must actually run");
  assert.equal(result.metadataConsistent, false);
  assert.equal(result.freezeStatus, "CONFLICT");
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
});

test("authority metadata assessments cannot be mutated into claimed authorization", () => {
  const results = [
    check(envelope()),
    check({}),
    check({ ...envelope(), evidenceStage: "HISTORICAL" }),
  ];
  for (const assessment of results) {
    assert.equal(Object.isFrozen(assessment), true);
    assert.equal(Object.isFrozen(assessment.blockers), true);
    const original = [...assessment.blockers];
    assert.throws(() => {
      (assessment as unknown as { scoringAuthorized: boolean }).scoringAuthorized = true;
    }, TypeError);
    assert.throws(() => {
      (assessment.blockers as string[]).push("VERIFIED");
    }, TypeError);
    assert.equal(assessment.scoringAuthorized, false);
    assert.equal(assessment.independentAuthorityVerified, false);
    assert.deepEqual(assessment.blockers, original);
  }
});
