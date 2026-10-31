import assert from "node:assert/strict";
import test from "node:test";
import { buildForwardV02IndependentProofRequest, buildForwardV02IndependentProofRequestStrictNodeIngress } from "./forwardV02IndependentProofRequest";

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
        signatureDigest: h("c"), trustAnchorId: "synthetic-witness-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision", decisionId: "synthetic-decision",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "synthetic-settlement-source", trustAnchorId: "synthetic-settlement-anchor",
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
        anchorId: "synthetic-witness-anchor", authorityId: "synthetic-witness-issuer",
        role: "WITNESS", algorithm: "Ed25519", publicKeyDigest: h("f"),
        state: "ACTIVE", validFrom: "2026-10-23T00:00:00Z",
        validUntil: "2026-10-25T00:00:00Z",
      },
      {
        anchorId: "synthetic-settlement-anchor", authorityId: "synthetic-settlement-source",
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
  buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);

test("valid self-reported metadata creates a request, never verified authority", () => {
  const r = check(fixture());
  assert.equal(r.metadataConsistent, true);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.deepEqual(r.blockers, ["UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL"]);
  assert.equal(r.request?.schemaVersion, "forward-v02-independent-proof-request.0.1-untrusted");
  assert.equal(r.request?.freeze.receiptId, "synthetic-receipt");
  assert.equal(r.request?.settlement.terminalRevisionId, "synthetic-revision");
});

test("request copies only proof metadata and never caller policy keys or raw evidence", () => {
  const r = check(fixture());
  const s = JSON.stringify(r.request);
  assert.ok(s.includes("synthetic-receipt"));
  assert.ok(s.includes("synthetic-revision"));
  assert.equal(Object.hasOwn(r.request ?? {}, "trusted"), false);
  for (const forbidden of ["publicKeyDigest", "signatureDigest", "anchors", "reviewState",
    "expectedTicketKey", "ticketKey", "odds", "stake", "privatePath"]) {
    assert.equal(s.includes(forbidden), false, forbidden);
  }
});

test("request and correction-chain snapshots are immutable and detached from caller", () => {
  const f = fixture();
  const r = check(f);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.blockers), true);
  assert.equal(Object.isFrozen(r.request), true);
  assert.equal(Object.isFrozen(r.request?.freeze), true);
  assert.equal(Object.isFrozen(r.request?.settlement), true);
  assert.equal(Object.isFrozen(r.request?.settlement.revisions), true);
  assert.equal(Object.isFrozen(r.request?.settlement.revisions[0]), true);
  f.envelope.freeze.witness.receiptId = "changed";
  f.envelope.settlement.revisions[0]!.revisionId = "changed";
  assert.equal(r.request?.freeze.receiptId, "synthetic-receipt");
  assert.equal(r.request?.settlement.revisions[0]?.revisionId, "synthetic-revision");
});

test("entire correction chain is retained, not just its terminal FINAL", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  // Reuse the terminal-proof-ref fixture guardrail.
  f.refs.settlementRevisionId = "synthetic-revision-2";
  const r = check(f);
  assert.equal(r.metadataConsistent, true);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.request?.settlement.terminalRevisionId, "synthetic-revision-2");
  assert.deepEqual(r.request?.settlement.revisions.map(x => x.revisionId),
    ["synthetic-revision", "synthetic-revision-2"]);
  assert.equal(r.request?.settlement.revisions[0]?.claimedSourceFinality, "PROVISIONAL");
  assert.equal(r.request?.settlement.revisions[1]?.predecessorDigest, h("d"));
});

test("stale terminal proof reference fails before request construction", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  const r = check(f);
  assert.equal(r.metadataConsistent, false);
  assert.deepEqual(r.blockers, ["UNBOUND_PROOF_REFS"]);
  assert.equal(r.request, null);
  assert.equal(r.scoringAuthorized, false);
});

test("revoked anchor and missing policy produce no request", () => {
  const revoked = fixture();
  revoked.policy.anchors[0]!.state = "REVOKED";
  const r = check(revoked);
  assert.deepEqual(r.blockers, ["REVOKED_WITNESS_ANCHOR"]);
  assert.equal(r.request, null);
  const f = fixture();
  const absent = buildForwardV02IndependentProofRequest(f.envelope, null, f.refs);
  assert.equal(absent.request, null);
  assert.equal(absent.independentAuthorityVerified, false);
});

test("caller-supplied trusted flags and private-value fields are rejected, not forwarded", () => {
  const injected = fixture();
  (injected.refs as unknown as Record<string, unknown>).independentAuthorityVerified = true;
  const r = check(injected);
  assert.deepEqual(r.blockers, ["INVALID_PROOF_REFS"]);
  assert.equal(r.request, null);
  const privateField = fixture();
  (privateField.envelope as unknown as Record<string, unknown>).rawOdds = "synthetic-private-value";
  const rejected = check(privateField);
  assert.deepEqual(rejected.blockers, ["INVALID_ENVELOPE"]);
  assert.equal(rejected.request, null);
});

test("a self-selected matching issuer and key digest cannot authorize scoring", () => {
  const f = fixture();
  f.envelope.freeze.witness.issuerId = "synthetic-self-signer";
  f.policy.anchors[0]!.authorityId = "synthetic-self-signer";
  const r = check(f);
  assert.equal(r.metadataConsistent, true);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("request preserves the entire chain when ambient Array.prototype.push drops revision copies", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("e"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  f.refs.settlementRevisionId = "synthetic-revision-2";
  const originalPush = Array.prototype.push;
  let attemptedRevisionPushes = 0;
  try {
    Array.prototype.push = function (...items: unknown[]): number {
      if (items.length === 1 && items[0] !== null &&
          typeof items[0] === "object" && Object.hasOwn(items[0], "claimedSourceFinality")) {
        attemptedRevisionPushes++;
        return this.length;
      }
      return Reflect.apply(originalPush, this, items);
    };
    const r = check(f);
    assert.equal(r.metadataConsistent, true);
    assert.equal(r.independentAuthorityVerified, false);
    assert.equal(r.scoringAuthorized, false);
    assert.equal(r.request?.settlement.revisions.length, 2);
    assert.equal(r.request?.settlement.revisions[0]?.revisionId, "synthetic-revision");
    assert.equal(r.request?.settlement.revisions[1]?.revisionId, "synthetic-revision-2");
    assert.equal(Object.isFrozen(r.request?.settlement.revisions), true);
    assert.equal(attemptedRevisionPushes, 0);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("request cannot be rewritten through a patched Array.prototype.push", () => {
  const f = fixture();
  const originalPush = Array.prototype.push;
  try {
    Array.prototype.push = function (...items: unknown[]): number {
      if (items.length === 1 && items[0] !== null &&
          typeof items[0] === "object" && Object.hasOwn(items[0], "claimedSourceFinality")) {
        return Reflect.apply(originalPush, this, [{
          revisionId: "forged-revision", contentDigest: h("f"),
          predecessorDigest: null, sequence: 1,
          claimedObservedAt: "2026-10-24T00:00:01Z", claimedSourceFinality: "FINAL",
        }]);
      }
      return Reflect.apply(originalPush, this, items);
    };
    const r = check(f);
    assert.equal(r.metadataConsistent, true);
    assert.equal(r.request?.settlement.revisions.length, 1);
    assert.equal(r.request?.settlement.revisions[0]?.revisionId, "synthetic-revision");
    assert.equal(r.request?.settlement.revisions[0]?.contentDigest, h("d"));
    assert.equal(r.independentAuthorityVerified, false);
    assert.equal(r.scoringAuthorized, false);
  } finally {
    Array.prototype.push = originalPush;
  }
});

test("descriptor-only snapshot pins a witness receipt before preflight and request copy", () => {
  const f = fixture();
  const original = f.envelope.freeze.witness;
  let directReads = 0;
  f.envelope.freeze.witness = new Proxy(original, {
    get(target, key, receiver) {
      if (key === "receiptId") {
        directReads++;
        // The old implementation read this directly in both preflight and
        // handoff, allowing a later read to expose a different receipt.
        return directReads <= 2 ? "synthetic-receipt" : "forged-receipt";
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const r = check(f);
  assert.equal(r.metadataConsistent, true);
  assert.equal(r.request?.freeze.receiptId, "synthetic-receipt");
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.equal(directReads, 0, "caller get traps must not run after descriptor snapshot");
});

test("descriptor-only snapshot retains validated correction content across the handoff", () => {
  const f = fixture();
  const original = f.envelope.settlement.revisions[0]!;
  let directReads = 0;
  f.envelope.settlement.revisions[0] = new Proxy(original, {
    get(target, key, receiver) {
      if (key === "contentDigest") {
        directReads++;
        return directReads <= 3 ? h("d") : h("f");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const r = check(f);
  assert.equal(r.metadataConsistent, true);
  assert.equal(r.request?.settlement.revisions[0]?.contentDigest, h("d"));
  assert.equal(r.request?.settlement.revisions[0]?.predecessorDigest, null);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.equal(directReads, 0, "caller revision get traps must not run during validation or copy");
});

test("proof-request builder pins revoked policy before envelope Proxy can activate it", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let mutated = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "schemaVersion") {
        mutated++;
        f.policy.anchors[0]!.state = "ACTIVE";
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = buildForwardV02IndependentProofRequest(envelope, f.policy, f.refs);
  assert.ok(mutated > 0, "envelope descriptor mutation must execute");
  assert.equal(f.policy.anchors[0]!.state, "ACTIVE");
  assert.equal(r.metadataConsistent, false);
  assert.deepEqual(r.blockers, ["REVOKED_WITNESS_ANCHOR"]);
  assert.equal(r.request, null);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("proof-request builder pins mismatched refs before envelope Proxy can repair them", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("f");
  let mutated = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "schemaVersion") {
        mutated++;
        f.refs.policySnapshotDigest = h("e");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = buildForwardV02IndependentProofRequest(envelope, f.policy, f.refs);
  assert.ok(mutated > 0, "envelope descriptor mutation must execute");
  assert.equal(f.refs.policySnapshotDigest, h("e"));
  assert.equal(r.metadataConsistent, false);
  assert.deepEqual(r.blockers, ["UNBOUND_PROOF_REFS"]);
  assert.equal(r.request, null);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("proof-request builder preserves invalid-envelope precedence after snapshot reordering", () => {
  const f = fixture();
  f.envelope.freeze.includedMembership = [];
  f.policy.anchors[0]!.state = "REVOKED";
  f.refs.policySnapshotDigest = h("f");
  const r = check(f);
  assert.deepEqual(r.blockers, ["INVALID_ENVELOPE"]);
  assert.equal(r.request, null);
  assert.equal(r.scoringAuthorized, false);
});

test("request revision handoff bypasses an inherited numeric index setter", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  for (let i = 2; i <= 19; i++) {
    const prior = f.envelope.settlement.revisions[i - 2]!;
    f.envelope.settlement.revisions.push({
      revisionId: `synthetic-revision-${i}`,
      contentDigest: i.toString(16).padStart(64, "0"),
      predecessorDigest: prior.contentDigest,
      sequence: i,
      observedAt: `2026-10-24T00:00:${String(i).padStart(2, "0")}Z`,
      sourceFinality: i === 19 ? "FINAL" : "PROVISIONAL",
    });
  }
  f.refs.settlementRevisionId = "synthetic-revision-19";
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "17");
  let intercepted = 0;
  let outcome: ReturnType<typeof check> | undefined;
  try {
    Object.defineProperty(Array.prototype, "17", {
      configurable: true,
      set: function (this: unknown[], item: unknown) {
        intercepted++;
        Object.defineProperty(this, "17", {
          value: Object.freeze({ ...(item as object), contentDigest: h("f") }),
          enumerable: true, writable: true, configurable: true,
        });
      },
    });
    outcome = check(f);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "17", previous);
    else Reflect.deleteProperty(Array.prototype, "17");
  }
  assert.equal(intercepted, 0, "validated revisions must bypass prototype setters");
  assert.equal(outcome?.metadataConsistent, true);
  assert.equal(outcome?.request?.settlement.revisions.length, 19);
  assert.equal(outcome?.request?.settlement.revisions[17]?.contentDigest, (18).toString(16).padStart(64, "0"));
  assert.equal(outcome?.request?.settlement.revisions[18]?.revisionId, "synthetic-revision-19");
  assert.equal(outcome?.independentAuthorityVerified, false);
  assert.equal(outcome?.scoringAuthorized, false);
});

test("proof-request blockers bypass inherited numeric index setters", () => {
  const f = fixture();
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, "2");
  let intercepted = 0;
  let outcome: ReturnType<typeof check> | undefined;
  try {
    Object.defineProperty(Array.prototype, "2", {
      configurable: true,
      set: function (this: unknown[], _item: unknown) {
        intercepted++;
        Object.defineProperty(this, "2", {
          value: "FORGED_BLOCKER", enumerable: true, writable: true, configurable: true,
        });
      },
    });
    outcome = check(f);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "2", previous);
    else Reflect.deleteProperty(Array.prototype, "2");
  }
  assert.equal(intercepted, 0, "blocker copies must not invoke ambient setters");
  assert.deepEqual(outcome?.blockers, [
    "UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
  assert.equal(outcome?.metadataConsistent, true);
  assert.equal(outcome?.independentAuthorityVerified, false);
  assert.equal(outcome?.scoringAuthorized, false);
});

test("strict proof request ingress matches the legacy detached metadata request", () => {
  const f = fixture();
  const strict = buildForwardV02IndependentProofRequestStrictNodeIngress(f.envelope, f.policy, f.refs);
  const legacy = check(f);
  assert.deepEqual(strict, legacy);
  assert.equal(strict.metadataConsistent, true);
  assert.equal(strict.independentAuthorityVerified, false);
  assert.equal(strict.scoringAuthorized, false);
  assert.equal(Object.isFrozen(strict.request?.settlement.revisions), true);
});

test("strict proof request ingress rejects root envelope Proxy before policy repair trap", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let traps = 0;
  const envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.policy.anchors[0]!.state = "ACTIVE";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = buildForwardV02IndependentProofRequestStrictNodeIngress(envelope, f.policy, f.refs);
  assert.deepEqual(result.blockers, ["INVALID_ENVELOPE"]);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.state, "REVOKED");
  assert.equal(result.request, null);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
});

test("strict proof request ingress rejects nested policy Proxy before proof-reference repair trap", () => {
  const f = fixture();
  f.refs.policySnapshotDigest = h("f");
  let traps = 0;
  const anchor = f.policy.anchors[0]!;
  f.policy.anchors[0] = new Proxy(anchor, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.refs.policySnapshotDigest = h("e");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = buildForwardV02IndependentProofRequestStrictNodeIngress(f.envelope, f.policy, f.refs);
  assert.deepEqual(result.blockers, ["INVALID_POLICY"]);
  assert.equal(traps, 0);
  assert.equal(f.refs.policySnapshotDigest, h("f"));
  assert.equal(result.request, null);
  assert.equal(result.scoringAuthorized, false);
});

test("strict proof request ingress rejects root proof-refs Proxy without mutating envelope", () => {
  const f = fixture();
  let traps = 0;
  const refs = new Proxy(f.refs, {
    ownKeys(target) {
      traps++;
      f.envelope.freeze.witness.receiptId = "forged-receipt";
      return Reflect.ownKeys(target);
    },
  });
  const result = buildForwardV02IndependentProofRequestStrictNodeIngress(f.envelope, f.policy, refs);
  assert.deepEqual(result.blockers, ["INVALID_PROOF_REFS"]);
  assert.equal(traps, 0);
  assert.equal(f.envelope.freeze.witness.receiptId, "synthetic-receipt");
  assert.equal(result.request, null);
  assert.equal(result.scoringAuthorized, false);
});

test("strict proof request ingress rejects nested revision Proxy before earlier-policy mutation", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  let traps = 0;
  const revision = f.envelope.settlement.revisions[0]!;
  f.envelope.settlement.revisions[0] = new Proxy(revision, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      f.policy.anchors[0]!.state = "ACTIVE";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = buildForwardV02IndependentProofRequestStrictNodeIngress(f.envelope, f.policy, f.refs);
  assert.deepEqual(result.blockers, ["INVALID_ENVELOPE"]);
  assert.equal(traps, 0);
  assert.equal(f.policy.anchors[0]!.state, "REVOKED");
  assert.equal(result.request, null);
  assert.equal(result.scoringAuthorized, false);
});

test("strict proof request ingress rejects revoked Proxy and never invokes policy accessor", () => {
  const revokedFixture = fixture();
  const revoked = Proxy.revocable(revokedFixture.refs, {});
  revoked.revoke();
  const denied = buildForwardV02IndependentProofRequestStrictNodeIngress(
    revokedFixture.envelope, revokedFixture.policy, revoked.proxy,
  );
  assert.deepEqual(denied.blockers, ["INVALID_PROOF_REFS"]);
  assert.equal(denied.request, null);

  const f = fixture();
  let getterCalls = 0;
  Object.defineProperty(f.policy.anchors[0]!, "state", {
    enumerable: true, configurable: true,
    get() { getterCalls++; return "ACTIVE"; },
  });
  const accessorDenied = buildForwardV02IndependentProofRequestStrictNodeIngress(
    f.envelope, f.policy, f.refs,
  );
  assert.deepEqual(accessorDenied.blockers, ["INVALID_POLICY"]);
  assert.equal(getterCalls, 0);
  assert.equal(accessorDenied.request, null);
  assert.equal(accessorDenied.independentAuthorityVerified, false);
  assert.equal(accessorDenied.scoringAuthorized, false);
});

test("strict proof request ingress preserves invalid-envelope priority for multiple rejected graphs", () => {
  const f = fixture();
  let traps = 0;
  const denyProxy = <T extends object>(value: T): T => new Proxy(value, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = buildForwardV02IndependentProofRequestStrictNodeIngress(
    denyProxy(f.envelope), denyProxy(f.policy), denyProxy(f.refs),
  );
  assert.deepEqual(result.blockers, ["INVALID_ENVELOPE"]);
  assert.equal(traps, 0);
  assert.equal(result.request, null);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
});


test("metadata-only settlement proof request cannot claim ticket-level return-kind coverage", () => {
  // The v0.2 candidate requires independently attributable ticket type,
  // selection, terminal revision and return kind. This older metadata-only
  // handoff deliberately carries no ticket-level classifier. A structurally
  // consistent request is therefore not proof of ordinary-vs-special payout.
  const result = check(fixture());
  assert.equal(result.metadataConsistent, true);
  assert.equal(result.request?.settlement.terminalRevisionId, "synthetic-revision");
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, [
    "UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
  const settlement = result.request?.settlement;
  assert.ok(settlement);
  for (const field of [
    "ticketType", "selection", "ticketKey", "expectedTicketKey",
    "returnKind", "terminalReturnKind", "specialPayout",
  ]) {
    assert.equal(Object.hasOwn(settlement, field), false, field);
  }
});

test("caller-supplied ticket return-kind and selection assertions are rejected before metadata-only proof handoff", () => {
  // R01/R02/R03/R04 are future independent-verifier specifications, not
  // executable proof tests. Here we lock the current untrusted handoff:
  // caller-added return-kind or exact-ticket assertions cannot masquerade
  // as independently verified evidence in the older metadata-only request.
  for (const [field, value] of [
    ["terminalReturnKind", "ORDINARY_PAYOUT"],
    ["returnKind", "SPECIAL_PAYOUT"],
    ["ticketType", "TRIFECTA"],
    ["selection", "1-2-3"],
  ] as const) {
    const f = fixture();
    (f.envelope.settlement as unknown as Record<string, unknown>)[field] = value;
    const result = check(f);
    assert.equal(result.metadataConsistent, false, field);
    assert.deepEqual(result.blockers, ["INVALID_ENVELOPE"], field);
    assert.equal(result.request, null, field);
    assert.equal(result.independentAuthorityVerified, false, field);
    assert.equal(result.scoringAuthorized, false, field);
  }
});
