import assert from "node:assert/strict";
import test from "node:test";
import { digestForwardV02UntrustedRequest } from "./forwardV02UntrustedVerifierResponse";
import type { ForwardV02IndependentProofRequest } from "./forwardV02IndependentProofRequest";

// Deny-only synthetic transcript coverage. These are caller claims, NOT an
// independent source signature, ticket-level proof, finality or scoring gate.
const h = (c: string): string => c.repeat(64);
function request() {
  return {
    schemaVersion: "forward-v02-independent-proof-request.0.1-untrusted" as const,
    policySnapshotDigest: h("a"),
    freeze: {
      cohortId: "synthetic-cohort",
      protocolDigest: h("b"),
      membershipDigest: h("c"),
      claimedFirstDecisionAt: "2026-10-24T00:00:00.100Z",
      issuerId: "synthetic-issuer",
      receiptId: "synthetic-receipt",
      claimedReceiptAt: "2026-10-24T00:00:00.050Z",
      claimedAnchorId: "synthetic-witness-anchor",
      witnessProofDigest: h("d"),
    },
    settlement: {
      sourceId: "synthetic-source",
      claimedAnchorId: "synthetic-settlement-anchor",
      terminalRevisionId: "synthetic-revision-2",
      settlementProofDigest: h("e"),
      revisions: [
        {
          revisionId: "synthetic-revision-1",
          contentDigest: h("f"),
          predecessorDigest: null as string | null,
          sequence: 1,
          claimedObservedAt: "2026-10-24T00:00:01Z",
          claimedSourceFinality: "PROVISIONAL",
        },
        {
          revisionId: "synthetic-revision-2",
          contentDigest: h("0"),
          predecessorDigest: h("f") as string | null,
          sequence: 2,
          claimedObservedAt: "2026-10-24T00:00:02Z",
          claimedSourceFinality: "FINAL",
        },
      ],
    },
  };
}

test("untrusted request digest binds each mutable allowlisted field across a two-revision chain", () => {
  const original = request();
  const baseline = digestForwardV02UntrustedRequest(original);
  assert.match(baseline, /^[0-9a-f]{64}$/u);
  type R = ReturnType<typeof request>;
  const cases: Array<{ name: string; mutate: (r: R) => void }> = [
    { name: "policy digest", mutate: r => { r.policySnapshotDigest = h("9"); } },
    { name: "cohort", mutate: r => { r.freeze.cohortId = "synthetic-other-cohort"; } },
    { name: "protocol digest", mutate: r => { r.freeze.protocolDigest = h("9"); } },
    { name: "membership digest", mutate: r => { r.freeze.membershipDigest = h("9"); } },
    { name: "first decision instant", mutate: r => { r.freeze.claimedFirstDecisionAt = "2026-10-24T00:00:00.200Z"; } },
    { name: "witness issuer", mutate: r => { r.freeze.issuerId = "synthetic-other-issuer"; } },
    { name: "witness receipt", mutate: r => { r.freeze.receiptId = "synthetic-other-receipt"; } },
    { name: "witness receipt instant", mutate: r => { r.freeze.claimedReceiptAt = "2026-10-24T00:00:00.075Z"; } },
    { name: "witness anchor", mutate: r => { r.freeze.claimedAnchorId = "synthetic-other-witness-anchor"; } },
    { name: "witness proof", mutate: r => { r.freeze.witnessProofDigest = h("9"); } },
    { name: "settlement source", mutate: r => { r.settlement.sourceId = "synthetic-other-source"; } },
    { name: "settlement anchor", mutate: r => { r.settlement.claimedAnchorId = "synthetic-other-settlement-anchor"; } },
    { name: "terminal revision identity", mutate: r => {
      r.settlement.terminalRevisionId = "synthetic-other-terminal";
      r.settlement.revisions[1]!.revisionId = "synthetic-other-terminal";
    } },
    { name: "settlement proof", mutate: r => { r.settlement.settlementProofDigest = h("9"); } },
    { name: "predecessor revision identity", mutate: r => { r.settlement.revisions[0]!.revisionId = "synthetic-other-predecessor"; } },
    { name: "predecessor content and successor link", mutate: r => {
      r.settlement.revisions[0]!.contentDigest = h("1");
      r.settlement.revisions[1]!.predecessorDigest = h("1");
    } },
    { name: "predecessor observation instant", mutate: r => {
      r.settlement.revisions[0]!.claimedObservedAt = "2026-10-24T00:00:01.500Z";
    } },
    { name: "predecessor finality claim", mutate: r => {
      r.settlement.revisions[0]!.claimedSourceFinality = "REVOKED";
    } },
    { name: "terminal content digest", mutate: r => { r.settlement.revisions[1]!.contentDigest = h("2"); } },
    { name: "terminal observation instant", mutate: r => {
      r.settlement.revisions[1]!.claimedObservedAt = "2026-10-24T00:00:03Z";
    } },
    { name: "revision count with valid terminal topology", mutate: r => {
      r.settlement.revisions = [{
        ...r.settlement.revisions[1]!, sequence: 1, predecessorDigest: null,
      }];
    } },
  ];
  for (const { name, mutate } of cases) {
    const changed = structuredClone(original);
    mutate(changed);
    const actual = digestForwardV02UntrustedRequest(changed);
    assert.match(actual, /^[0-9a-f]{64}$/u, name);
    assert.notEqual(actual, baseline, name);
  }
});

test("untrusted transcript rejects impossible topology and extra fields instead of hashing them", () => {
  const invalid: Array<{ name: string; mutate: (r: ReturnType<typeof request>) => void }> = [
    { name: "missing predecessor", mutate: r => { r.settlement.revisions[1]!.predecessorDigest = null; } },
    { name: "wrong sequence", mutate: r => { r.settlement.revisions[0]!.sequence = 2; } },
    { name: "non-final terminal", mutate: r => { r.settlement.revisions[1]!.claimedSourceFinality = "PROVISIONAL"; } },
    { name: "nonterminal terminal ID", mutate: r => { r.settlement.terminalRevisionId = "synthetic-revision-1"; } },
    { name: "reversed chronology", mutate: r => {
      r.settlement.revisions[1]!.claimedObservedAt = "2026-10-24T00:00:00.500Z";
    } },
    { name: "unknown ticket field", mutate: r => {
      Object.defineProperty(r.settlement, "ticketKey", {
        value: "synthetic-ticket", enumerable: true, configurable: true,
      });
    } },
    { name: "unknown authority field", mutate: r => {
      Object.defineProperty(r, "scoringAuthorized", { value: true, enumerable: true });
    } },
  ];
  for (const { name, mutate } of invalid) {
    const changed = request();
    mutate(changed);
    assert.throws(() => digestForwardV02UntrustedRequest(changed), /INVALID_UNTRUSTED_REQUEST/, name);
  }
  const wrongVersion = { ...request(), schemaVersion: "forward-v02-independent-proof-request.9.9" };
  assert.throws(
    () => digestForwardV02UntrustedRequest(wrongVersion as unknown as ForwardV02IndependentProofRequest),
    /INVALID_UNTRUSTED_REQUEST/,
  );
});
