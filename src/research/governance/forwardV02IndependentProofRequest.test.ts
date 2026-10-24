import assert from "node:assert/strict";
import test from "node:test";
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
