import assert from "node:assert/strict";
import test from "node:test";
import { assessForwardV02TrustPolicyPreflight } from "./forwardV02TrustPolicyPreflight";

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
