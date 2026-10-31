import assert from "node:assert/strict";
import test from "node:test";
import { snapshotForwardV02UntrustedGraph } from "./forwardV02UntrustedSnapshot";
import { assessForwardV02TrustPolicyPreflight, assessForwardV02TrustPolicyPreflightStrictNodeIngress as strictPreflight } from "./forwardV02TrustPolicyPreflight";

const h = (c: string) => c.repeat(64);
function fixture() {
  const envelope = {
    schemaVersion: "forward-v02-authority-metadata.0.1-untrusted",
    evidenceStage: "SHADOW_FORWARD",
    freeze: {
      cohortId: "synthetic-cohort", protocolDigest: h("a"), membershipDigest: h("b"),
      firstDecisionAt: "2026-10-24T00:00:00.0002Z",
      expectedMembership: ["synthetic-decision"], includedMembership: ["synthetic-decision"],
      excludedMembership: [],
      witness: {
        receiptId: "synthetic-receipt", issuerId: "synthetic-witness-issuer",
        receiptAt: "2026-10-24T00:00:00.0001Z",
        protocolDigest: h("a"), membershipDigest: h("b"),
        signatureDigest: h("c"), trustAnchorId: "synthetic-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision", decisionId: "synthetic-decision",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "synthetic-settlement-source", trustAnchorId: "synthetic-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{
        revisionId: "synthetic-revision", contentDigest: h("d"),
        predecessorDigest: null as string | null, sequence: 1,
        observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
      }],
    },
  };
  const policy = {
    schemaVersion: "forward-v02-trust-policy.0.1-untrusted",
    snapshotDigest: h("e"), reviewState: "REVIEWED",
    anchors: [
      {
        anchorId: "synthetic-anchor", authorityId: "synthetic-witness-issuer",
        role: "WITNESS", algorithm: "Ed25519", publicKeyDigest: h("f"),
        state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
        validUntil: "2026-10-25T00:00:00Z",
      },
      {
        anchorId: "synthetic-anchor", authorityId: "synthetic-settlement-source",
        role: "SETTLEMENT", algorithm: "Ed25519", publicKeyDigest: h("a"),
        state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
        validUntil: "2026-10-25T00:00:00Z",
      },
    ],
  };
  const refs = {
    schemaVersion: "forward-v02-proof-refs.0.1-untrusted",
    policySnapshotDigest: h("e"), witnessReceiptId: "synthetic-receipt",
    witnessProofDigest: h("b"), settlementRevisionId: "synthetic-revision",
    settlementProofDigest: h("c"),
  };
  return { envelope, policy, refs };
}
const check = (f: ReturnType<typeof fixture>) =>
  assessForwardV02TrustPolicyPreflight(f.envelope, f.policy, f.refs);
const blocked = (f: ReturnType<typeof fixture>, reason: string) => {
  const r = check(f);
  assert.deepEqual(r.blockers, [reason]);
  assert.equal(r.policyMetadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
};

test("perfect self-reported REVIEWED policy and digest-shaped proof refs cannot verify authority", () => {
  const result = check(fixture());
  assert.deepEqual(result, {
    policyMetadataConsistent: true, independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"],
  });
});
test("caller-selected issuer and matching key digests never establish independent proof", () => {
  const f = fixture();
  f.envelope.freeze.witness.issuerId = "self-signed";
  f.policy.anchors[0]!.authorityId = "self-signed";
  assert.equal(check(f).independentAuthorityVerified, false);
  assert.equal(check(f).scoringAuthorized, false);
});
test("unreviewed policy is rejected even when all anchors and refs match", () => {
  const f = fixture(); f.policy.reviewState = "DRAFT";
  blocked(f, "UNREVIEWED_POLICY");
});
test("witness authority mismatch and role swap are denied", () => {
  const mismatch = fixture(); mismatch.policy.anchors[0]!.authorityId = "other-issuer";
  blocked(mismatch, "UNBOUND_WITNESS_ANCHOR");
  const swapped = fixture(); swapped.policy.anchors[0]!.role = "SETTLEMENT";
  blocked(swapped, "DUPLICATE_POLICY_ANCHOR");
});
test("settlement source mismatch and missing settlement anchor are denied", () => {
  const mismatch = fixture(); mismatch.policy.anchors[1]!.authorityId = "other-source";
  blocked(mismatch, "UNBOUND_SETTLEMENT_ANCHOR");
  const missing = fixture(); missing.policy.anchors[1]!.anchorId = "other-anchor";
  blocked(missing, "UNBOUND_SETTLEMENT_ANCHOR");
});
test("revoked witness or settlement key cannot be treated as active", () => {
  const witness = fixture(); witness.policy.anchors[0]!.state = "REVOKED";
  blocked(witness, "REVOKED_WITNESS_ANCHOR");
  const settlement = fixture(); settlement.policy.anchors[1]!.state = "REVOKED";
  blocked(settlement, "REVOKED_SETTLEMENT_ANCHOR");
});
test("witness and settlement outside configured validity windows are denied", () => {
  const witness = fixture(); witness.policy.anchors[0]!.validUntil = "2026-10-24T00:00:00Z";
  blocked(witness, "OUT_OF_WINDOW_WITNESS_ANCHOR");
  const settlement = fixture(); settlement.policy.anchors[1]!.validFrom = "2026-10-24T00:00:02Z";
  blocked(settlement, "OUT_OF_WINDOW_SETTLEMENT_ANCHOR");
});
test("later FINAL cannot launder an earlier revision outside the settlement anchor validity window", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.observedAt = "2026-10-24T00:00:00.500Z";
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  // Proof references bind the terminal revision, not its predecessor.
  f.refs.settlementRevisionId = "synthetic-revision-2";
  f.policy.anchors[1]!.validFrom = "2026-10-24T00:00:01Z";
  // The final revision is in-window, but the provisional predecessor is not.
  blocked(f, "OUT_OF_WINDOW_SETTLEMENT_ANCHOR");
});

test("every revision inside one settlement anchor window remains consistent but never verified", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.observedAt = "2026-10-24T00:00:00.500Z";
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  // Proof references bind the terminal revision, not its predecessor.
  f.refs.settlementRevisionId = "synthetic-revision-2";
  f.policy.anchors[1]!.validFrom = "2026-10-24T00:00:00Z";
  assert.deepEqual(check(f), {
    policyMetadataConsistent: true, independentAuthorityVerified: false,
    scoringAuthorized: false,
    blockers: ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"],
  });
});

test("policy snapshot and proof reference mismatch are denied", () => {
  const policy = fixture(); policy.refs.policySnapshotDigest = h("f");
  blocked(policy, "UNBOUND_PROOF_REFS");
  const receipt = fixture(); receipt.refs.witnessReceiptId = "other-receipt";
  blocked(receipt, "UNBOUND_PROOF_REFS");
  const revision = fixture(); revision.refs.settlementRevisionId = "other-revision";
  blocked(revision, "UNBOUND_PROOF_REFS");
});
test("unsupported algorithm, invalid calendar, unknown state and duplicate role IDs fail closed", () => {
  const algorithm = fixture(); algorithm.policy.anchors[0]!.algorithm = "none";
  blocked(algorithm, "INVALID_POLICY");
  const date = fixture(); date.policy.anchors[0]!.validFrom = "2026-02-30T00:00:00Z";
  blocked(date, "INVALID_POLICY");
  const yearZero = fixture(); yearZero.policy.anchors[0]!.validFrom = "0000-01-01T00:00:00Z";
  blocked(yearZero, "INVALID_POLICY");
  const state = fixture(); state.policy.anchors[1]!.state = "UNKNOWN";
  blocked(state, "INVALID_POLICY");
  const duplicate = fixture(); duplicate.policy.anchors[1]!.role = "WITNESS";
  blocked(duplicate, "DUPLICATE_POLICY_ANCHOR");
});
test("caller injected verified flag and toJSON do not grant authority", () => {
  const f = fixture();
  (f.refs as unknown as Record<string, unknown>).verified = true;
  blocked(f, "INVALID_PROOF_REFS");
  const p = fixture();
  Object.defineProperty(p.policy.anchors, "toJSON", { value: () => [] });
  blocked(p, "INVALID_POLICY");
});
test("sparse, accessor, or extra-property policy data are rejected", () => {
  const sparse = fixture();
  sparse.policy.anchors = new Array(2) as typeof sparse.policy.anchors;
  blocked(sparse, "INVALID_POLICY");
  const accessor = fixture();
  Object.defineProperty(accessor.policy.anchors[0], "state", {
    enumerable: true, get() { throw Error("must not evaluate accessor"); },
  });
  blocked(accessor, "INVALID_POLICY");
  const extra = fixture();
  (extra.policy as unknown as Record<string, unknown>).productionConnection = true;
  blocked(extra, "INVALID_POLICY");
});
test("invalid envelope is rejected before any policy claims", () => {
  const f = fixture();
  f.envelope.freeze.includedMembership = [];
  blocked(f, "INVALID_ENVELOPE");
});

test("patched Array.prototype.push cannot forge revoked policy anchors during preflight", () => {
  const witness = fixture();
  witness.policy.anchors[0]!.state = "REVOKED";
  const settlement = fixture();
  settlement.policy.anchors[1]!.state = "REVOKED";
  const originalPush = Array.prototype.push;
  let intercepted = 0;
  try {
    Array.prototype.push = function (...items: unknown[]): number {
      const item = items.length === 1 ? items[0] : null;
      if (item !== null && typeof item === "object" &&
          Object.hasOwn(item, "role") && Object.hasOwn(item, "state")) {
        intercepted++;
        return Reflect.apply(originalPush, this, [{ ...item, state: "ACTIVE" }]);
      }
      return Reflect.apply(originalPush, this, items);
    };
    blocked(witness, "REVOKED_WITNESS_ANCHOR");
    blocked(settlement, "REVOKED_SETTLEMENT_ANCHOR");
    assert.equal(intercepted, 0);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("patched Array.prototype.push cannot erase valid anchors before policy binding", () => {
  const f = fixture();
  const originalPush = Array.prototype.push;
  let intercepted = 0;
  try {
    Array.prototype.push = function (...items: unknown[]): number {
      const item = items.length === 1 ? items[0] : null;
      if (item !== null && typeof item === "object" &&
          Object.hasOwn(item, "role") && Object.hasOwn(item, "state")) {
        intercepted++;
        return this.length;
      }
      return Reflect.apply(originalPush, this, items);
    };
    const r = check(f);
    assert.equal(r.policyMetadataConsistent, true);
    assert.equal(r.independentAuthorityVerified, false);
    assert.equal(r.scoringAuthorized, false);
    assert.equal(intercepted, 0);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("standalone preflight pins revoked policy before envelope descriptor can activate it", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let mutationCount = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "schemaVersion") {
        mutationCount++;
        f.policy.anchors[0]!.state = "ACTIVE";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = assessForwardV02TrustPolicyPreflight(envelope, f.policy, f.refs);
  assert.ok(mutationCount > 0, "envelope phase must actually mutate caller policy");
  assert.equal(f.policy.anchors[0]!.state, "ACTIVE");
  assert.deepEqual(r.blockers, ["REVOKED_WITNESS_ANCHOR"]);
  assert.equal(r.policyMetadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("standalone preflight pins mismatched proof refs before envelope descriptor can repair them", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("f");
  let mutationCount = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "schemaVersion") {
        mutationCount++;
        f.refs.policySnapshotDigest = h("e");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = assessForwardV02TrustPolicyPreflight(envelope, f.policy, f.refs);
  assert.ok(mutationCount > 0, "envelope phase must actually mutate caller proof refs");
  assert.equal(f.refs.policySnapshotDigest, h("e"));
  assert.deepEqual(r.blockers, ["UNBOUND_PROOF_REFS"]);
  assert.equal(r.policyMetadataConsistent, false);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("shared untrusted snapshot bypasses an inherited numeric index setter", () => {
  const input = Array.from({ length: 19 }, (_, i) => String(i));
  input[18] = "original";
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "17");
  let intercepted = 0;
  let snapshot: unknown;
  try {
    Object.defineProperty(Array.prototype, "17", {
      configurable: true,
      set: function (this: unknown[], item: unknown) {
        intercepted++;
        Object.defineProperty(this, "17", {
          value: item, enumerable: true, writable: true, configurable: true,
        });
        input[18] = "repaired";
      },
    });
    snapshot = snapshotForwardV02UntrustedGraph(input);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "17", previous);
    else Reflect.deleteProperty(Array.prototype, "17");
  }
  assert.equal(intercepted, 0, "snapshot must not invoke ambient index setters");
  assert.equal(input[18], "original", "later caller data must remain unchanged");
  assert.equal((snapshot as string[])[18], "original");
  assert.equal(Object.hasOwn(snapshot as object, "17"), true);
});

test("policy snapshot and anchor accumulation cannot launder an invalid later anchor via prototype setter", () => {
  const f = fixture();
  for (let i = 2; i < 19; i++) {
    f.policy.anchors[i] = { ...f.policy.anchors[0]!, anchorId: `synthetic-unused-${i}` };
  }
  f.policy.anchors[18]!.state = "UNKNOWN";
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "17");
  let intercepted = 0;
  let outcome: ReturnType<typeof check> | undefined;
  try {
    Object.defineProperty(Array.prototype, "17", {
      configurable: true,
      set: function (this: unknown[], item: unknown) {
        intercepted++;
        Object.defineProperty(this, "17", {
          value: item, enumerable: true, writable: true, configurable: true,
        });
        f.policy.anchors[18]!.state = "ACTIVE";
      },
    });
    outcome = check(f);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "17", previous);
    else Reflect.deleteProperty(Array.prototype, "17");
  }
  assert.equal(intercepted, 0, "neither snapshot nor anchor list may invoke the setter");
  assert.equal(f.policy.anchors[18]!.state, "UNKNOWN");
  assert.deepEqual(outcome?.blockers, ["INVALID_POLICY"]);
  assert.equal(outcome?.policyMetadataConsistent, false);
  assert.equal(outcome?.independentAuthorityVerified, false);
  assert.equal(outcome?.scoringAuthorized, false);
});

for (const trapName of ["getPrototypeOf", "ownKeys"] as const) {
  test(`bounded array snapshot pins an invalid item before ${trapName} repairs it`, () => {
    const source = [{ state: "REVOKED" }, { state: "ACTIVE" }];
    let traps = 0;
    const proxy = new Proxy(source, {
      getPrototypeOf(target) {
        if (trapName === "getPrototypeOf") {
          traps++;
          source[0]!.state = "ACTIVE";
        }
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        if (trapName === "ownKeys") {
          traps++;
          source[0]!.state = "ACTIVE";
        }
        return Reflect.ownKeys(target);
      },
    });
    const pinned = snapshotForwardV02UntrustedGraph(proxy) as typeof source;
    assert.equal(traps, 1);
    assert.equal(source[0]!.state, "ACTIVE");
    assert.equal(pinned[0]!.state, "REVOKED");
  });

  test(`standalone policy preflight rejects a revoked anchor repaired by ${trapName}`, () => {
    const f = fixture();
    const anchors = f.policy.anchors;
    anchors[0]!.state = "REVOKED";
    let traps = 0;
    f.policy.anchors = new Proxy(anchors, {
      getPrototypeOf(target) {
        if (trapName === "getPrototypeOf") {
          traps++;
          anchors[0]!.state = "ACTIVE";
        }
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        if (trapName === "ownKeys") {
          traps++;
          anchors[0]!.state = "ACTIVE";
        }
        return Reflect.ownKeys(target);
      },
    });
    const result = check(f);
    assert.equal(traps, 1);
    assert.equal(anchors[0]!.state, "ACTIVE");
    assert.deepEqual(result.blockers, ["REVOKED_WITNESS_ANCHOR"]);
    assert.equal(result.policyMetadataConsistent, false);
    assert.equal(result.independentAuthorityVerified, false);
    assert.equal(result.scoringAuthorized, false);
  });
}


test("strict trust-policy ingress preserves ordinary policy, revocation and reference classifications", () => {
  const valid = fixture();
  assert.deepEqual(strictPreflight(valid.envelope, valid.policy, valid.refs), check(valid));
  assert.equal(strictPreflight(valid.envelope, valid.policy, valid.refs).independentAuthorityVerified, false);
  assert.equal(strictPreflight(valid.envelope, valid.policy, valid.refs).scoringAuthorized, false);
  const revoked = fixture();
  revoked.policy.anchors[0]!.state = "REVOKED";
  assert.deepEqual(strictPreflight(revoked.envelope, revoked.policy, revoked.refs), check(revoked));
  const draft = fixture();
  draft.policy.reviewState = "DRAFT";
  assert.deepEqual(strictPreflight(draft.envelope, draft.policy, draft.refs), check(draft));
  const refs = fixture();
  refs.refs.policySnapshotDigest = h("0");
  assert.deepEqual(strictPreflight(refs.envelope, refs.policy, refs.refs), check(refs));
});

test("strict trust-policy ingress rejects root envelope Proxy before revoked-anchor repair", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let traps = 0;
  const envelope = new Proxy(f.envelope, {
    ownKeys(target) {
      traps++;
      f.policy.anchors[0]!.state = "ACTIVE";
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(strictPreflight(envelope, f.policy, f.refs).blockers, ["INVALID_ENVELOPE"]);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.state, "REVOKED");
});

test("strict trust-policy ingress rejects nested policy Proxy before proof-reference repair", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("0");
  let traps = 0;
  f.policy.anchors[0] = new Proxy(f.policy.anchors[0]!, {
    getPrototypeOf(target) {
      traps++;
      f.refs.policySnapshotDigest = h("e");
      return Reflect.getPrototypeOf(target);
    },
  });
  const result = strictPreflight(f.envelope, f.policy, f.refs);
  assert.deepEqual(result.blockers, ["INVALID_POLICY"]);
  assert.equal(result.policyMetadataConsistent, false);
  assert.equal(traps, 0);
  assert.equal(f.refs.policySnapshotDigest, h("0"));
});

test("strict trust-policy ingress rejects proof-reference Proxy before policy repair", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let traps = 0;
  const refs = new Proxy(f.refs, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.policy.anchors[0]!.state = "ACTIVE";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = strictPreflight(f.envelope, f.policy, refs);
  assert.deepEqual(result.blockers, ["INVALID_PROOF_REFS"]);
  assert.equal(result.scoringAuthorized, false);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.state, "REVOKED");
});

test("strict trust-policy ingress rejects revoked Proxy and accessor without invoking traps", () => {
  const f = fixture();
  let traps = 0;
  const revocable = Proxy.revocable(f.policy.anchors[0]!, {
    ownKeys(target) {
      traps++;
      return Reflect.ownKeys(target);
    },
  });
  revocable.revoke();
  f.policy.anchors[0] = revocable.proxy;
  assert.deepEqual(strictPreflight(f.envelope, f.policy, f.refs).blockers, ["INVALID_POLICY"]);
  assert.equal(traps, 0);

  const g = fixture();
  let getters = 0;
  Object.defineProperty(g.refs, "policySnapshotDigest", {
    enumerable: true, configurable: true,
    get() { getters++; return h("e"); },
  });
  assert.deepEqual(strictPreflight(g.envelope, g.policy, g.refs).blockers, ["INVALID_PROOF_REFS"]);
  assert.equal(getters, 0);
});

test("strict trust-policy ingress retains envelope-first snapshot error precedence", () => {
  const f = fixture();
  const invalidEnvelope = new Proxy(f.envelope, { ownKeys() { throw Error("not reached"); } });
  const invalidPolicy = new Proxy(f.policy, { ownKeys() { throw Error("not reached"); } });
  const invalidRefs = new Proxy(f.refs, { ownKeys() { throw Error("not reached"); } });
  assert.deepEqual(strictPreflight(invalidEnvelope, invalidPolicy, invalidRefs).blockers,
    ["INVALID_ENVELOPE"]);
  assert.deepEqual(strictPreflight(f.envelope, invalidPolicy, invalidRefs).blockers,
    ["INVALID_POLICY"]);
  assert.deepEqual(strictPreflight(f.envelope, f.policy, invalidRefs).blockers,
    ["INVALID_PROOF_REFS"]);
});

test("policy preflight assessments cannot be mutated into claimed authorization", () => {
  const good = fixture(), rejected = fixture();
  rejected.policy.reviewState = "DRAFT";
  const results = [check(good), check(rejected)];
  for (const assessment of results) {
    assert.equal(Object.isFrozen(assessment), true);
    assert.equal(Object.isFrozen(assessment.blockers), true);
    const original = [...assessment.blockers];
    assert.throws(() => {
      (assessment as unknown as { independentAuthorityVerified: boolean }).independentAuthorityVerified = true;
    }, TypeError);
    assert.throws(() => {
      (assessment.blockers as string[]).push("APPROVED");
    }, TypeError);
    assert.equal(assessment.independentAuthorityVerified, false);
    assert.equal(assessment.scoringAuthorized, false);
    assert.deepEqual(assessment.blockers, original);
  }
});
