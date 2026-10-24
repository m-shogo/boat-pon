import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assessForwardV02AuthorityMetadata } from "./forwardV02AuthorityMetadata";

// Schema is a public, UNTRUSTED metadata shape contract, not an independent
// signature/clock/finality verifier. Runtime checks remain mandatory.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/forward-v02-authority-metadata.schema.json", import.meta.url),
  "utf8",
)) as Record<string, any>;

function fields(node: any, expected: string[]) {
  assert.equal(node.type, "object");
  assert.equal(node.additionalProperties, false);
  assert.deepEqual([...node.required].sort(), [...expected].sort());
  assert.deepEqual(Object.keys(node.properties).sort(), [...expected].sort());
}

test("untrusted schema has a versioned, closed root and no authority-granting field", () => {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.schemaVersion.const, "forward-v02-authority-metadata.0.1-untrusted");
  assert.deepEqual(schema.properties.evidenceStage.enum, ["SHADOW_FORWARD", "FUTURE_ONLY"]);
  fields(schema, ["schemaVersion", "evidenceStage", "freeze", "settlement"]);
  for (const key of ["trusted", "verified", "independentAuthorityVerified", "scoringAuthorized", "productionConnection"]) {
    assert.equal(Object.hasOwn(schema.properties, key), false, key);
  }
});

test("freeze, witness, settlement and revision objects all reject undeclared fields", () => {
  const freeze = schema.properties.freeze;
  const witness = freeze.properties.witness;
  const settlement = schema.properties.settlement;
  const revision = settlement.properties.revisions.items;
  fields(freeze, [
    "cohortId", "protocolDigest", "membershipDigest", "firstDecisionAt",
    "expectedMembership", "includedMembership", "excludedMembership", "witness",
  ]);
  fields(witness, [
    "receiptId", "issuerId", "receiptAt", "protocolDigest", "membershipDigest",
    "signatureDigest", "trustAnchorId",
  ]);
  fields(settlement, [
    "expectedDecisionId", "decisionId", "expectedTicketKey", "ticketKey",
    "sourceId", "trustAnchorId", "disposition", "evaluable", "revisions",
  ]);
  fields(revision, [
    "revisionId", "contentDigest", "predecessorDigest", "sequence",
    "observedAt", "sourceFinality",
  ]);
});

test("metadata list cardinality, uniqueness and source revision sequence constraints are explicit", () => {
  const freeze = schema.properties.freeze.properties;
  for (const name of ["expectedMembership", "includedMembership", "excludedMembership"]) {
    assert.equal(freeze[name].type, "array");
    assert.equal(freeze[name].uniqueItems, true);
    assert.equal(freeze[name].items.$ref, "#/$defs/nonblank");
  }
  assert.equal(freeze.expectedMembership.minItems, 1);
  assert.equal(freeze.includedMembership.minItems, 0);
  assert.equal(freeze.excludedMembership.minItems, 0);
  const settlement = schema.properties.settlement.properties;
  assert.equal(settlement.revisions.minItems, 1);
  assert.equal(settlement.revisions.items.properties.sequence.minimum, 1);
  assert.equal(settlement.revisions.items.properties.sequence.maximum, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(settlement.revisions.items.properties.predecessorDigest.anyOf, [
    { type: "null" }, { $ref: "#/$defs/digest" },
  ]);
  assert.deepEqual(settlement.revisions.items.properties.sourceFinality.enum, [
    "PROVISIONAL", "FINAL", "REVOKED",
  ]);
  assert.deepEqual(settlement.disposition.enum, [
    "SETTLED", "REFUNDED", "VOID", "CANCELLED", "UNRESOLVED",
  ]);
});

test("schema lexical timestamp gate rejects unknown offsets, lowercase, rollover and malformed times", () => {
  const timestamp = schema.$defs.exactInstant;
  assert.equal(timestamp.format, "date-time");
  const pattern = new RegExp(timestamp.pattern, "u");
  for (const good of [
    "2026-10-24T00:00:00Z", "2026-10-24T09:00:00+09:00",
    "2026-10-24T00:00:00.000001Z", "2026-10-24T00:00:00+00:00",
  ]) assert.equal(pattern.test(good), true, good);
  for (const bad of [
    "not-an-instant", "2026-10-24t00:00:00z", "2026-10-24T00:00:00-00:00",
    "0000-10-24T00:00:00Z", "2026-13-24T00:00:00Z",
    "2026-10-24T24:00:00Z", "2026-10-24T00:00:60Z",
  ]) assert.equal(pattern.test(bad), false, bad);
});

test("schema digest and ECMAScript trim nonblank patterns match runtime lexical rules", () => {
  const digest = new RegExp(schema.$defs.digest.pattern, "u");
  const nonblank = new RegExp(schema.$defs.nonblank.pattern, "u");
  assert.equal(digest.test("a".repeat(64)), true);
  for (const bad of ["A".repeat(64), "a".repeat(63), "z".repeat(64)]) {
    assert.equal(digest.test(bad), false);
  }
  for (const blank of ["", " ", "\u00A0", "\uFEFF", "\u3000", " \t\n"]) {
    assert.equal(nonblank.test(blank), false, JSON.stringify(blank));
    assert.equal(blank.trim().length > 0, false);
  }
  for (const nonempty of ["id", " \u0085 ", " \u00E9 "]) {
    assert.equal(nonblank.test(nonempty), true);
    assert.equal(nonempty.trim().length > 0, true);
  }
});

test("schema cannot establish independent evidence or permit scoring", () => {
  const h = (x: string) => x.repeat(64);
  const envelope = {
    schemaVersion: "forward-v02-authority-metadata.0.1-untrusted",
    evidenceStage: "SHADOW_FORWARD",
    freeze: {
      cohortId: "synthetic", protocolDigest: h("a"), membershipDigest: h("b"),
      firstDecisionAt: "2026-10-24T00:00:00.0002Z",
      expectedMembership: ["synthetic-decision"], includedMembership: ["synthetic-decision"],
      excludedMembership: [],
      witness: {
        receiptId: "self-receipt", issuerId: "self-issuer",
        receiptAt: "2026-10-24T00:00:00.0001Z",
        protocolDigest: h("a"), membershipDigest: h("b"),
        signatureDigest: h("c"), trustAnchorId: "self-anchor",
      },
    },
    settlement: {
      expectedDecisionId: "synthetic-decision", decisionId: "synthetic-decision",
      expectedTicketKey: "synthetic-ticket", ticketKey: "synthetic-ticket",
      sourceId: "self-source", trustAnchorId: "self-anchor",
      disposition: "SETTLED", evaluable: true,
      revisions: [{
        revisionId: "self-revision", contentDigest: h("d"), predecessorDigest: null,
        sequence: 1, observedAt: "2026-10-24T00:00:01Z", sourceFinality: "FINAL",
      }],
    },
  };
  const result = assessForwardV02AuthorityMetadata(envelope);
  assert.equal(result.metadataConsistent, true);
  assert.equal(result.independentAuthorityVerified, false);
  assert.equal(result.scoringAuthorized, false);
  assert.deepEqual(result.blockers, [
    "UNVERIFIED_WITNESS", "UNVERIFIED_SOURCE", "UNAPPROVED_PROTOCOL",
  ]);
  assert.equal(assessForwardV02AuthorityMetadata({
    ...envelope, independentAuthorityVerified: true,
  }).metadataConsistent, false);
});
