import assert from "node:assert/strict";
import test from "node:test";
import {
  snapshotForwardV02UntrustedGraphRejectingProxies,
} from "./forwardV02UntrustedSnapshot";

import { assessForwardV02AuthorityMetadata, assessForwardV02AuthorityMetadataStrictNodeIngress } from "./forwardV02AuthorityMetadata";

const strictSnapshot = snapshotForwardV02UntrustedGraphRejectingProxies;

test("strict Node ingress detaches ordinary nested metadata without granting authority", () => {
  const source = { freeze: { cohortId: "synthetic-cohort" }, revisions: [{ state: "REVOKED" }] };
  const snapshot = strictSnapshot(source) as typeof source;
  source.freeze.cohortId = "changed";
  source.revisions[0]!.state = "ACTIVE";
  assert.deepEqual(snapshot, { freeze: { cohortId: "synthetic-cohort" }, revisions: [{ state: "REVOKED" }] });
  assert.notEqual(snapshot.freeze, source.freeze);
});

test("strict ingress rejects a root Proxy before prototype, key or descriptor traps", () => {
  let traps = 0;
  const proxy = new Proxy({ state: "REVOKED" }, {
    getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); },
    ownKeys(target) { traps++; return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      traps++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => strictSnapshot(proxy), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
});

test("strict ingress rejects a nested child Proxy before it repairs a later sibling", () => {
  const source: Array<{ state: string }> = [{ state: "REVOKED" }, { state: "REVOKED" }];
  let traps = 0;
  source[0] = new Proxy(source[0]!, {
    getPrototypeOf(target) {
      traps++;
      source[1]!.state = "ACTIVE";
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.throws(() => strictSnapshot(source), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
  assert.equal(source[1]!.state, "REVOKED");
});

test("strict ingress rejects a later sibling Proxy without executing descriptor repair", () => {
  const source: Array<{ state: string }> = [{ state: "REVOKED" }, { state: "ACTIVE" }];
  let traps = 0;
  source[1] = new Proxy(source[1]!, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      source[0]!.state = "ACTIVE";
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => strictSnapshot(source), /INVALID_SNAPSHOT/);
  assert.equal(traps, 0);
  assert.equal(source[0]!.state, "REVOKED");
});

test("strict ingress fails closed on revoked Proxies and accessor values", () => {
  const revoked = Proxy.revocable({ state: "REVOKED" }, {});
  revoked.revoke();
  assert.throws(() => strictSnapshot(revoked.proxy), /INVALID_SNAPSHOT/);
  let reads = 0;
  const input = { state: "REVOKED" };
  Object.defineProperty(input, "state", {
    enumerable: true, configurable: true,
    get() { reads++; return "ACTIVE"; },
  });
  assert.throws(() => strictSnapshot(input), /INVALID_SNAPSHOT/);
  assert.equal(reads, 0);
});

const digest64 = (character: string) => character.repeat(64);
function strictAuthorityFixture() {
  return {
    schemaVersion: "forward-v02-authority-metadata.0.1-untrusted",
    evidenceStage: "SHADOW_FORWARD",
    freeze: {
      cohortId: "synthetic-cohort",
      protocolDigest: digest64("a"), membershipDigest: digest64("b"),
      firstDecisionAt: "2026-10-24T00:00:00.0002Z",
      expectedMembership: ["synthetic-decision"],
      includedMembership: ["synthetic-decision"], excludedMembership: [],
      witness: {
        receiptId: "synthetic-receipt", issuerId: "caller-selected-issuer",
        receiptAt: "2026-10-24T00:00:00.0001Z",
        protocolDigest: digest64("a"), membershipDigest: digest64("b"),
        signatureDigest: digest64("c"), trustAnchorId: "caller-selected-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision", decisionId: "synthetic-decision",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "caller-selected-source", trustAnchorId: "caller-selected-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{
        revisionId: "synthetic-revision", contentDigest: digest64("d"),
        predecessorDigest: null as string | null, sequence: 1,
        observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
      }],
    },
  };
}

test("strict authority ingress preserves ordinary semantic classification without authority", () => {
  const e = strictAuthorityFixture();
  const actual = assessForwardV02AuthorityMetadataStrictNodeIngress(e);
  assert.deepEqual(actual, assessForwardV02AuthorityMetadata(e));
  assert.equal(actual.metadataConsistent, true);
  assert.equal(actual.independentAuthorityVerified, false);
  assert.equal(actual.scoringAuthorized, false);
  e.freeze.witness.membershipDigest = digest64("e");
  const invalid = assessForwardV02AuthorityMetadataStrictNodeIngress(e);
  assert.equal(invalid.freezeStatus, "CONFLICT");
  assert.equal(invalid.independentAuthorityVerified, false);
  assert.equal(invalid.scoringAuthorized, false);
});

test("strict authority ingress rejects a root Proxy before its repair traps", () => {
  const e = strictAuthorityFixture();
  e.schemaVersion = "invalid-initial-version";
  let traps = 0;
  const input = new Proxy(e, {
    ownKeys(target) {
      traps++;
      target.schemaVersion = "forward-v02-authority-metadata.0.1-untrusted";
      return Reflect.ownKeys(target);
    },
  });
  const actual = assessForwardV02AuthorityMetadataStrictNodeIngress(input);
  assert.equal(traps, 0);
  assert.equal(e.schemaVersion, "invalid-initial-version");
  assert.deepEqual(actual.blockers, ["INVALID_EVIDENCE_SHAPE"]);
  assert.equal(actual.metadataConsistent, false);
  assert.equal(actual.scoringAuthorized, false);
});

test("strict authority ingress denies nested child Proxy before later sibling repair", () => {
  const e = strictAuthorityFixture();
  e.settlement.revisions[0]!.sourceFinality = "REVOKED";
  let traps = 0;
  e.freeze.witness = new Proxy(e.freeze.witness, {
    getPrototypeOf(target) {
      traps++;
      e.settlement.revisions[0]!.sourceFinality = "FINAL";
      return Reflect.getPrototypeOf(target);
    },
  });
  const actual = assessForwardV02AuthorityMetadataStrictNodeIngress(e);
  assert.equal(traps, 0);
  assert.equal(e.settlement.revisions[0]!.sourceFinality, "REVOKED");
  assert.deepEqual(actual.blockers, ["INVALID_EVIDENCE_SHAPE"]);
  assert.equal(actual.independentAuthorityVerified, false);
});

test("strict authority ingress denies later sibling Proxy before earlier field repair", () => {
  const e = strictAuthorityFixture();
  e.freeze.witness.membershipDigest = digest64("e");
  let traps = 0;
  e.settlement.revisions[0] = new Proxy(e.settlement.revisions[0]!, {
    getOwnPropertyDescriptor(target, key) {
      traps++;
      e.freeze.witness.membershipDigest = digest64("b");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const actual = assessForwardV02AuthorityMetadataStrictNodeIngress(e);
  assert.equal(traps, 0);
  assert.equal(e.freeze.witness.membershipDigest, digest64("e"));
  assert.deepEqual(actual.blockers, ["INVALID_EVIDENCE_SHAPE"]);
  assert.equal(actual.scoringAuthorized, false);
});

test("strict authority ingress denies nested accessor without executing getter", () => {
  const e = strictAuthorityFixture();
  let reads = 0;
  Object.defineProperty(e.freeze.witness, "receiptAt", {
    enumerable: true, get() { reads++; return "2026-10-24T00:00:00.0001Z"; },
  });
  const actual = assessForwardV02AuthorityMetadataStrictNodeIngress(e);
  assert.equal(reads, 0);
  assert.deepEqual(actual.blockers, ["INVALID_EVIDENCE_SHAPE"]);
  assert.equal(actual.independentAuthorityVerified, false);
  assert.equal(actual.scoringAuthorized, false);
});
