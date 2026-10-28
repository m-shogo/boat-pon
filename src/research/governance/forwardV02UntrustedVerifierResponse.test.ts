import assert from "node:assert/strict";
import test from "node:test";
import { assessForwardV02UntrustedVerifierResponse, assessForwardV02UntrustedVerifierResponseStrictNodeIngress, digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import { buildForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";

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
  const response = {
    schemaVersion: "forward-v02-independent-proof-response.0.2-untrusted",
    requestSchemaVersion: "forward-v02-independent-proof-request.0.1-untrusted",
    requestBindingDigest: "",
    policySnapshotDigest: h("e"), cohortId: "synthetic-cohort",
    witnessReceiptId: "synthetic-receipt", witnessProofDigest: h("b"),
    terminalRevisionId: "synthetic-revision", settlementProofDigest: h("c"),
    revisionContentDigests: [h("d")],
    claimedVerifierId: "synthetic-verifier",
    claimedWitnessStatus: "VERIFIED", claimedSettlementStatus: "VERIFIED",
  };
  const built = buildForwardV02IndependentProofRequest(envelope, policy, refs);
  assert.ok(built.request);
  response.requestBindingDigest = digestForwardV02UntrustedRequest(built.request);
  return { envelope, policy, refs, response };
}
const check = (f: ReturnType<typeof fixture>) =>
  assessForwardV02UntrustedVerifierResponse(f.envelope, f.policy, f.refs, f.response);

test("matching claimed VERIFIED response is structurally consistent but never authenticated", () => {
  const r = check(fixture());
  assert.equal(r.requestMetadataConsistent, true);
  assert.equal(r.responseMetadataConsistent, true);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
  assert.deepEqual(r.blockers, [
    "UNTRUSTED_VERIFIER_RESPONSE", "UNVERIFIED_WITNESS",
    "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.blockers), true);
});

test("response does not bypass invalid, revoked or missing request policy", () => {
  const f = fixture();
  f.policy.anchors[0]!.state = "REVOKED";
  const revoked = check(f);
  assert.equal(revoked.requestMetadataConsistent, false);
  assert.equal(revoked.responseMetadataConsistent, false);
  assert.deepEqual(revoked.blockers, ["REQUEST_NOT_READY"]);
  assert.equal(revoked.scoringAuthorized, false);
});

test("caller-selected verifier name and matching self-reported proof remain untrusted", () => {
  const f = fixture();
  f.response.claimedVerifierId = "official-verified-issuer";
  assert.equal(check(f).independentAuthorityVerified, false);
  f.response.claimedWitnessStatus = "REJECTED";
  assert.equal(check(f).scoringAuthorized, false);
});

test("mismatched witness, policy or settlement proof references fail closed", () => {
  const fields = ["witnessReceiptId", "policySnapshotDigest", "settlementProofDigest"] as const;
  for (const key of fields) {
    const f = fixture();
    f.response[key] = "synthetic-mismatch";
    const r = check(f);
    assert.equal(r.responseMetadataConsistent, false, key);
    assert.deepEqual(r.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  }
});

test("all correction revisions must be bound in order, not just terminal revision", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("f"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  f.refs.settlementRevisionId = "synthetic-revision-2";
  f.response.terminalRevisionId = "synthetic-revision-2";
  f.response.revisionContentDigests = [h("d"), h("f")];
  const rebuilt = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(rebuilt.request);
  f.response.requestBindingDigest = digestForwardV02UntrustedRequest(rebuilt.request);
  assert.equal(check(f).responseMetadataConsistent, true);
  f.response.revisionContentDigests = [h("f"), h("d")];
  assert.deepEqual(check(f).blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  f.response.revisionContentDigests = [h("f")];
  assert.deepEqual(check(f).blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
});

test("injected authority flags, raw values, and unknown statuses are rejected", () => {
  const f = fixture();
  (f.response as unknown as Record<string, unknown>).scoringAuthorized = true;
  assert.deepEqual(check(f).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  const raw = fixture();
  (raw.response as unknown as Record<string, unknown>).rawOdds = "synthetic-secret";
  assert.deepEqual(check(raw).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  const status = fixture();
  status.response.claimedSettlementStatus = "AUTHORIZED";
  assert.deepEqual(check(status).blockers, ["INVALID_VERIFIER_RESPONSE"]);
});

test("sparse and accessor-based revision arrays fail closed without invoking getters", () => {
  const sparse = fixture();
  sparse.response.revisionContentDigests = new Array<string>(1);
  assert.deepEqual(check(sparse).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  const accessor = fixture();
  let getterCalls = 0;
  Object.defineProperty(accessor.response.revisionContentDigests, "0", {
    enumerable: true, configurable: true, get() { getterCalls++; return h("d"); },
  });
  assert.deepEqual(check(accessor).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(getterCalls, 0);
});

test("response descriptor accessors fail closed without execution", () => {
  const f = fixture();
  let getterCalls = 0;
  Object.defineProperty(f.response, "claimedWitnessStatus", {
    enumerable: true, configurable: true, get() { getterCalls++; return "VERIFIED"; },
  });
  assert.deepEqual(check(f).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(getterCalls, 0);
});

test("a patched array iterator cannot omit predecessor digests", () => {
  const f = fixture();
  const original = Array.prototype[Symbol.iterator];
  let called = 0;
  try {
    Array.prototype[Symbol.iterator] = function* () {
      called++;
      yield h("d");
    } as typeof original;
    const r = check(f);
    assert.equal(r.responseMetadataConsistent, true);
    assert.equal(r.independentAuthorityVerified, false);
    assert.equal(r.scoringAuthorized, false);
    assert.equal(called, 0);
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
});


test("whole-request transcript rejects previously unbound metadata changes", () => {
  const mutations: Array<{ name: string; mutate: (f: ReturnType<typeof fixture>) => void }> = [
    { name: "protocol", mutate: f => {
      f.envelope.freeze.protocolDigest = h("f");
      f.envelope.freeze.witness.protocolDigest = h("f");
    } },
    { name: "membership", mutate: f => {
      f.envelope.freeze.membershipDigest = h("f");
      f.envelope.freeze.witness.membershipDigest = h("f");
    } },
    { name: "decision clock", mutate: f => {
      f.envelope.freeze.firstDecisionAt = "2026-10-24T00:00:00.0003Z";
    } },
    { name: "witness issuer", mutate: f => {
      f.envelope.freeze.witness.issuerId = "synthetic-other-issuer";
      f.policy.anchors[0]!.authorityId = "synthetic-other-issuer";
    } },
    { name: "witness clock", mutate: f => {
      f.envelope.freeze.witness.receiptAt = "2026-10-24T00:00:00.00015Z";
    } },
    { name: "settlement source", mutate: f => {
      f.envelope.settlement.sourceId = "synthetic-other-source";
      f.policy.anchors[1]!.authorityId = "synthetic-other-source";
    } },
    { name: "revision clock", mutate: f => {
      f.envelope.settlement.revisions[0]!.observedAt = "2026-10-24T00:00:02Z";
    } },
    { name: "revision identity", mutate: f => {
      f.envelope.settlement.revisions[0]!.revisionId = "synthetic-revision-renamed";
      f.refs.settlementRevisionId = "synthetic-revision-renamed";
      f.response.terminalRevisionId = "synthetic-revision-renamed";
    } },
  ];
  for (const { name, mutate } of mutations) {
    const f = fixture();
    mutate(f);
    const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
    assert.equal(built.metadataConsistent, true, name);
    assert.ok(built.request, name);
    assert.notEqual(digestForwardV02UntrustedRequest(built.request), f.response.requestBindingDigest, name);
    const assessed = check(f);
    assert.equal(assessed.requestMetadataConsistent, true, name);
    assert.equal(assessed.responseMetadataConsistent, false, name);
    assert.deepEqual(assessed.blockers, ["UNBOUND_VERIFIER_RESPONSE"], name);
    assert.equal(assessed.scoringAuthorized, false, name);
  }
});

test("self-recomputed complete transcript remains a claim, never independent authority", () => {
  const f = fixture();
  f.envelope.freeze.protocolDigest = h("f");
  f.envelope.freeze.witness.protocolDigest = h("f");
  const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(built.request);
  f.response.requestBindingDigest = digestForwardV02UntrustedRequest(built.request);
  const assessed = check(f);
  assert.equal(assessed.responseMetadataConsistent, true);
  assert.equal(assessed.independentAuthorityVerified, false);
  assert.equal(assessed.scoringAuthorized, false);
});

test("malformed or missing request transcript is denied", () => {
  const malformed = fixture();
  malformed.response.requestBindingDigest = "not-a-digest";
  assert.deepEqual(check(malformed).blockers, ["INVALID_VERIFIER_RESPONSE"]);
  const missing = fixture();
  delete (missing.response as Record<string, unknown>).requestBindingDigest;
  assert.deepEqual(check(missing).blockers, ["INVALID_VERIFIER_RESPONSE"]);
});

test("untrusted verifier response cannot borrow a binding corrected during request preflight", () => {
  const f = fixture();
  const originalBinding = f.response.requestBindingDigest;
  f.response.requestBindingDigest = h("0");
  let mutated = false;
  const changingEnvelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "freeze" && !mutated) {
        mutated = true;
        f.response.requestBindingDigest = originalBinding;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = assessForwardV02UntrustedVerifierResponse(
    changingEnvelope, f.policy, f.refs, f.response,
  );
  assert.equal(mutated, true, "preflight mutation must execute");
  assert.equal(r.requestMetadataConsistent, true);
  assert.equal(r.responseMetadataConsistent, false);
  assert.deepEqual(r.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("untrusted verifier response cannot borrow revision digests corrected during preflight", () => {
  const f = fixture();
  f.response.revisionContentDigests[0] = h("0");
  let mutated = false;
  const changingEnvelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "freeze" && !mutated) {
        mutated = true;
        f.response.revisionContentDigests[0] = h("d");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = assessForwardV02UntrustedVerifierResponse(
    changingEnvelope, f.policy, f.refs, f.response,
  );
  assert.equal(mutated, true, "nested revision mutation must execute");
  assert.equal(r.requestMetadataConsistent, true);
  assert.equal(r.responseMetadataConsistent, false);
  assert.deepEqual(r.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("standalone request digest rejects an initially malformed freeze descriptor instead of a later repaired getter", () => {
  const f = fixture();
  const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(built.request);
  const expected = digestForwardV02UntrustedRequest(built.request);
  assert.equal(digestForwardV02UntrustedRequest(structuredClone(built.request)), expected);
  let descriptorReads = 0;
  let getterReads = 0;
  const freeze = new Proxy({ ...built.request.freeze }, {
    get(target, key, receiver) {
      if (key === "claimedFirstDecisionAt") getterReads++;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      const d = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === "claimedFirstDecisionAt" && d) {
        descriptorReads++;
        return { ...d, value: null };
      }
      return d;
    },
  });
  const untrusted = { ...built.request, freeze };
  assert.throws(() => digestForwardV02UntrustedRequest(untrusted), /INVALID_UNTRUSTED_REQUEST/);
  assert.ok(descriptorReads > 0, "adversarial descriptor must actually be inspected");
  assert.equal(getterReads, 0, "caller getter must never repair a malformed digest input");
});

test("standalone request digest rejects an initially malformed revision rather than hashing a repaired getter", () => {
  const f = fixture();
  const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(built.request);
  let descriptorReads = 0;
  let getterReads = 0;
  const revision = new Proxy({ ...built.request.settlement.revisions[0]! }, {
    get(target, key, receiver) {
      if (key === "contentDigest") getterReads++;
      return Reflect.get(target, key, receiver);
    },
    getOwnPropertyDescriptor(target, key) {
      const d = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === "contentDigest" && d) {
        descriptorReads++;
        return { ...d, value: null };
      }
      return d;
    },
  });
  const untrusted = {
    ...built.request,
    settlement: { ...built.request.settlement, revisions: [revision] },
  };
  assert.throws(() => digestForwardV02UntrustedRequest(untrusted), /INVALID_UNTRUSTED_REQUEST/);
  assert.ok(descriptorReads > 0, "adversarial correction descriptor must actually be inspected");
  assert.equal(getterReads, 0, "caller getter must never repair a correction digest");
});

test("standalone request transcript rejects malformed nested SHA digests before correlation", () => {
  const f = fixture();
  f.envelope.settlement.revisions[0]!.sourceFinality = "PROVISIONAL";
  f.envelope.settlement.revisions.push({
    revisionId: "synthetic-revision-2", contentDigest: h("f"),
    predecessorDigest: h("d"), sequence: 2,
    observedAt: "2026-10-24T00:00:02Z", sourceFinality: "FINAL",
  });
  f.refs.settlementRevisionId = "synthetic-revision-2";
  const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
  assert.ok(built.request);
  const validDigest = digestForwardV02UntrustedRequest(built.request);
  const mutations = [
    ["freeze", "protocolDigest"],
    ["freeze", "membershipDigest"],
    ["freeze", "witnessProofDigest"],
    ["settlement", "settlementProofDigest"],
    ["revision0", "contentDigest"],
    ["revision1", "predecessorDigest"],
  ] as const;
  for (const [target, field] of mutations) {
    const copy = structuredClone(built.request) as unknown as Record<string, unknown>;
    const settlement = copy.settlement as Record<string, unknown>;
    const revisions = settlement.revisions as Record<string, unknown>[];
    const node = target === "freeze"
      ? copy.freeze as Record<string, unknown>
      : target === "settlement"
        ? settlement
        : revisions[target === "revision0" ? 0 : 1]!;
    node[field] = "not-a-sha256-digest";
    assert.throws(
      () => digestForwardV02UntrustedRequest(copy as unknown as NonNullable<typeof built.request>),
      /INVALID_UNTRUSTED_REQUEST/,
      `${target}.${field} must be rejected rather than hashed`,
    );
  }
  assert.equal(digestForwardV02UntrustedRequest(built.request), validDigest);
  assert.equal(built.scoringAuthorized, false);
  assert.equal(built.independentAuthorityVerified, false);
});

test("verifier response cannot hide an extra revision digest by changing array length between checks", () => {
  const f = fixture();
  let lengthReads = 0;
  f.response.revisionContentDigests = new Proxy([h("d"), h("f")], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthReads++;
        return lengthReads === 1 ? 2 : 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const r = check(f);
  assert.equal(r.requestMetadataConsistent, true);
  assert.equal(r.responseMetadataConsistent, false);
  assert.deepEqual(r.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  assert.equal(lengthReads, 0, "untrusted length getter must never be consulted");
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("verifier response rejects a proxy that hides a configurable revision index and spoofs length", () => {
  const f = fixture();
  let ownKeysCalls = 0;
  let lengthReads = 0;
  f.response.revisionContentDigests = new Proxy([h("d"), h("f")], {
    ownKeys() {
      ownKeysCalls++;
      return ["0", "length"];
    },
    get(target, key, receiver) {
      if (key === "length") {
        lengthReads++;
        return 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const r = check(f);
  assert.ok(ownKeysCalls > 0, "adversarial ownKeys trap must actually execute");
  assert.equal(lengthReads, 0, "descriptor length must override caller getter");
  assert.equal(r.requestMetadataConsistent, true);
  assert.equal(r.responseMetadataConsistent, false);
  assert.deepEqual(r.blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(r.independentAuthorityVerified, false);
  assert.equal(r.scoringAuthorized, false);
});

test("verifier response cannot repair nested revision digests via a toJSON has trap", () => {
  const f = fixture();
  f.response.revisionContentDigests[0] = h("0");
  let hasCalls = 0;
  const response = new Proxy(f.response, {
    has(target, key) {
      if (key === "toJSON") {
        hasCalls++;
        target.revisionContentDigests[0] = h("d");
      }
      return Reflect.has(target, key);
    },
  });
  const assessed = assessForwardV02UntrustedVerifierResponse(
    f.envelope, f.policy, f.refs, response,
  );
  assert.equal(hasCalls, 0, "response snapshot must not invoke a caller has trap");
  assert.equal(assessed.requestMetadataConsistent, true);
  assert.equal(assessed.responseMetadataConsistent, false);
  assert.deepEqual(assessed.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  assert.equal(assessed.independentAuthorityVerified, false);
  assert.equal(assessed.scoringAuthorized, false);
});

test("verifier response pins nested digests before later scalar descriptor side effects", () => {
  const f = fixture();
  f.response.revisionContentDigests[0] = h("0");
  let descriptorReads = 0;
  const response = new Proxy(f.response, {
    getOwnPropertyDescriptor(target, key) {
      if (key === "claimedVerifierId") {
        descriptorReads++;
        target.revisionContentDigests[0] = h("d");
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const assessed = assessForwardV02UntrustedVerifierResponse(
    f.envelope, f.policy, f.refs, response,
  );
  assert.ok(descriptorReads > 0, "late descriptor mutation must execute");
  assert.equal(assessed.requestMetadataConsistent, true);
  assert.equal(assessed.responseMetadataConsistent, false);
  assert.deepEqual(assessed.blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
  assert.equal(assessed.independentAuthorityVerified, false);
  assert.equal(assessed.scoringAuthorized, false);
});

test("untrusted verifier blockers bypass inherited numeric index setters", () => {
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
  assert.equal(intercepted, 0, "verifier blocker copies must bypass ambient setters");
  assert.deepEqual(outcome?.blockers, [
    "UNTRUSTED_VERIFIER_RESPONSE", "UNVERIFIED_WITNESS",
    "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
  assert.equal(outcome?.requestMetadataConsistent, true);
  assert.equal(outcome?.responseMetadataConsistent, true);
  assert.equal(outcome?.independentAuthorityVerified, false);
  assert.equal(outcome?.scoringAuthorized, false);
});


const strictResponseCheck = (f: ReturnType<typeof fixture>) =>
  assessForwardV02UntrustedVerifierResponseStrictNodeIngress(
    f.envelope, f.policy, f.refs, f.response,
  );

test("strict Node response ingress preserves matching untrusted and mismatched semantics", () => {
  const f = fixture();
  assert.deepEqual(strictResponseCheck(f), check(f));
  assert.equal(strictResponseCheck(f).independentAuthorityVerified, false);
  assert.equal(strictResponseCheck(f).scoringAuthorized, false);
  f.response.requestBindingDigest = h("0");
  assert.deepEqual(strictResponseCheck(f).blockers, ["UNBOUND_VERIFIER_RESPONSE"]);
});

test("strict Node response ingress rejects root response Proxy before binding repair", () => {
  const f = fixture();
  f.response.requestBindingDigest = h("0");
  let traps = 0;
  f.response = new Proxy(f.response, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "claimedSettlementStatus") {
        const built = buildForwardV02IndependentProofRequest(f.envelope, f.policy, f.refs);
        assert.ok(built.request);
        target.requestBindingDigest = digestForwardV02UntrustedRequest(built.request);
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = strictResponseCheck(f);
  assert.equal(traps, 0);
  assert.deepEqual(r.blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(f.response.requestBindingDigest, h("0"));
  assert.equal(r.scoringAuthorized, false);
});

test("strict Node response ingress rejects nested revision Proxy before digest repair", () => {
  const f = fixture();
  f.response.revisionContentDigests[0] = h("0");
  let traps = 0;
  f.response.revisionContentDigests = new Proxy(f.response.revisionContentDigests, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "length") target[0] = h("d");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = strictResponseCheck(f);
  assert.equal(traps, 0);
  assert.deepEqual(r.blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(f.response.revisionContentDigests[0], h("0"));
  assert.equal(r.independentAuthorityVerified, false);
});

test("strict Node response ingress rejects envelope Proxy before response repair", () => {
  const f = fixture();
  f.response.requestBindingDigest = h("0");
  let traps = 0;
  f.envelope = new Proxy(f.envelope, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "freeze") f.response.requestBindingDigest = h("a");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = strictResponseCheck(f);
  assert.equal(traps, 0);
  assert.deepEqual(r.blockers, ["REQUEST_NOT_READY"]);
  assert.equal(f.response.requestBindingDigest, h("0"));
  assert.equal(r.scoringAuthorized, false);
});

test("strict Node response ingress rejects nested policy Proxy before response repair", () => {
  const f = fixture();
  f.response.requestBindingDigest = h("0");
  let traps = 0;
  f.policy.anchors[0] = new Proxy(f.policy.anchors[0]!, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      if (key === "state") f.response.requestBindingDigest = h("a");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const r = strictResponseCheck(f);
  assert.equal(traps, 0);
  assert.deepEqual(r.blockers, ["REQUEST_NOT_READY"]);
  assert.equal(f.response.requestBindingDigest, h("0"));
  assert.equal(r.scoringAuthorized, false);
});

test("strict Node response ingress rejects proof-reference Proxy before response repair", () => {
  const f = fixture();
  f.response.requestBindingDigest = h("0");
  let traps = 0;
  f.refs = new Proxy(f.refs, {
    ownKeys(target) {
      traps++;
      f.response.requestBindingDigest = h("a");
      return Reflect.ownKeys(target);
    },
  });
  const r = strictResponseCheck(f);
  assert.equal(traps, 0);
  assert.deepEqual(r.blockers, ["REQUEST_NOT_READY"]);
  assert.equal(f.response.requestBindingDigest, h("0"));
  assert.equal(r.scoringAuthorized, false);
});

test("strict Node response ingress rejects revoked Proxy and accessor without executing getter", () => {
  const f = fixture();
  const revoked = Proxy.revocable(f.response, {});
  revoked.revoke();
  assert.deepEqual(
    assessForwardV02UntrustedVerifierResponseStrictNodeIngress(
      f.envelope, f.policy, f.refs, revoked.proxy,
    ).blockers,
    ["INVALID_VERIFIER_RESPONSE"],
  );
  let getterCalls = 0;
  Object.defineProperty(f.response, "claimedVerifierId", {
    enumerable: true, get() { getterCalls++; return "synthetic-verifier"; },
  });
  const r = strictResponseCheck(f);
  assert.deepEqual(r.blockers, ["INVALID_VERIFIER_RESPONSE"]);
  assert.equal(getterCalls, 0);
  assert.equal(r.scoringAuthorized, false);
});
