import assert from "node:assert/strict";
import test from "node:test";
import { assessForwardV02UntrustedVerifierResponse } from "./forwardV02UntrustedVerifierResponse";

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
    schemaVersion: "forward-v02-independent-proof-response.0.1-untrusted",
    requestSchemaVersion: "forward-v02-independent-proof-request.0.1-untrusted",
    policySnapshotDigest: h("e"), cohortId: "synthetic-cohort",
    witnessReceiptId: "synthetic-receipt", witnessProofDigest: h("b"),
    terminalRevisionId: "synthetic-revision", settlementProofDigest: h("c"),
    revisionContentDigests: [h("d")],
    claimedVerifierId: "synthetic-verifier",
    claimedWitnessStatus: "VERIFIED", claimedSettlementStatus: "VERIFIED",
  };
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
