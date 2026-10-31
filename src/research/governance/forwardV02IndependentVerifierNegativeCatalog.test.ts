import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Catalog-contract tests ONLY: no independent verifier, signature validation, source
// authentication, scoring admission, private evidence, or production connection.
const catalogUrl = new URL("../../../reports/research/forward-v02-independent-verifier-negative-vectors-20261026.json", import.meta.url);

const expectedDenials: Readonly<Record<string, string>> = Object.freeze({
  W01: "UNVERIFIED_WITNESS",
  W02: "UNVERIFIED_WITNESS",
  W03: "UNVERIFIED_WITNESS",
  W04: "AFTER_DECISION",
  W05: "MISSING_MEMBERSHIP",
  W06: "UNVERIFIED_WITNESS",
  W07: "CONFLICT",
  S01: "UNVERIFIED_SOURCE",
  S02: "INCOMPLETE_REVISION_CHAIN",
  S03: "CONFLICT",
  S04: "CONFLICT",
  S05: "UNRESOLVED_FINALITY",
  S06: "CONFLICT",
  S07: "UNRESOLVED_IDENTITY",
  S08: "UNRESOLVED_REFUND_OR_INVALIDATION",
  S09: "UNVERIFIED_SOURCE",
  X01: "UNVERIFIED_WITNESS",
  X02: "UNVERIFIED_WITNESS",
});

const expectedCaseSemantics: Readonly<Record<string, readonly [string, string]>> = Object.freeze({
  W01: ["CALLER_SELF_SIGNED_RECEIPT", "NO_INDEPENDENT_TRUST_ROOT"],
  W02: ["RECEIPT_SIGNED_BY_UNAPPROVED_ISSUER", "INDEPENDENT_TEST_TRUST_ROOT_PRESENT"],
  W03: ["RECEIPT_WITHOUT_APPEND_ONLY_INCLUSION", "INDEPENDENT_TEST_TRUST_ROOT_PRESENT"],
  W04: ["WITNESS_COMMIT_EQUALS_EARLIEST_DECISION", "INDEPENDENT_TEST_CLOCK_PROOF_PRESENT"],
  W05: ["ELIGIBLE_UNIVERSE_OMITS_PREDECLARED_MEMBER", "INDEPENDENT_TEST_MEMBERSHIP_PROOF_PRESENT"],
  W06: ["REVOCATION_STATE_MISSING_OR_STALE", "INDEPENDENT_TEST_TRUST_ROOT_PRESENT"],
  W07: ["SIGNED_RECEIPT_BINDS_DIFFERENT_PROTOCOL_DIGEST", "INDEPENDENT_TEST_RECEIPT_PRESENT"],
  S01: ["CALLER_FINAL_AND_EXACT_WITHOUT_SOURCE_PROOF", "NO_INDEPENDENT_SOURCE_ATTESTATION"],
  S02: ["FINAL_REVISION_PREDECESSOR_MISSING", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S03: ["TWO_CHILDREN_SHARE_PREDECESSOR_WITHOUT_SUPERSESSION_RULE", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S04: ["SAME_SOURCE_REVISION_ID_TWO_CONTENT_DIGESTS", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S05: ["LATEST_OBSERVATION_LACKS_AUTHENTICATED_TERMINALITY", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S06: ["TWO_TERMINAL_REVISIONS_WITHOUT_TRUSTED_TOTAL_ORDER", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S07: ["SOURCE_RECORD_TICKET_OR_DECISION_ID_MISMATCH", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S08: ["REFUND_VOID_INVALIDATION_MARKED_EVALUABLE", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  S09: ["TRUST_ANCHOR_REVOKED_AT_PREDECESSOR_REVISION", "INDEPENDENT_TEST_SOURCE_PROOF_PRESENT"],
  X01: ["BOTH_PROOFS_STRUCTURALLY_CONSISTENT_BUT_NOT_AUTHENTICATED", "NO_INDEPENDENT_PROOF"],
  X02: ["CLAIMED_TEST_PROOFS_WITH_UNAPPROVED_EVALUATION_PROTOCOL", "TEST_ONLY_PROOF_SHAPES_NOT_ATTESTED"],
});

// These policy-bearing statements define the custody boundary for a FUTURE
// verifier. Pin their meaning independently of the JSON fixture: otherwise a
// catalog can preserve all 18 denial codes while silently authorizing caller
// keys, caller FINAL claims or a production/scoring connection.
// Pin the human-readable causal rationale as well as the mutation and denial.
// A rewritten explanation must not teach a future harness to trust caller FINAL,
// self-signed witness receipts, or a latest-seen revision as independent proof.
const expectedCaseRationales: Readonly<Record<string, string>> = Object.freeze({
  W01: "Matching request digest and caller-selected issuer/key never establish independence.",
  W02: "Cryptographic validity under an unapproved issuer is insufficient.",
  W03: "A signature without the approved inclusion/ordering proof is not a prospective freeze.",
  W04: "Receipt commit must be strictly earlier, not equal.",
  W05: "An included-only digest cannot prove the complete eligible universe.",
  W06: "No inference from caller's REVIEWED or ACTIVE flags.",
  W07: "Witness signature must bind the exact prospective protocol and membership digests.",
  S01: "FINAL and EXACT are claims, not source authority.",
  S02: "Terminal status cannot erase a predecessor gap.",
  S03: "A fork cannot be resolved by local observedAt ordering.",
  S04: "Source-scoped revision equivocation fails closed.",
  S05: "Latest seen is not the terminal source revision.",
  S06: "Do not use caller sequence or local timestamp to break a source tie.",
  S07: "Race-only matching is insufficient for exact ticket settlement.",
  S08: "Never count excluded refunds as ROI losses.",
  S09: "Valid FINAL cannot launder an earlier out-of-window revision.",
  X01: "Metadata-only conjunction remains unverified and unscorable.",
  X02: "Unattested test-only proof shapes fail the witness-authenticity gate first; the unapproved protocol remains a separate downstream blocker and cannot authorize scoring.",
});

const expectedAuthoritySeparation: Readonly<Record<string, string>> = Object.freeze({
  "callerClaims": "Only allowlisted immutable metadata request/response; digests, issuer IDs, timestamps and claimed FINAL/VERIFIED never become trust roots.",
  "independentWitness": "Future verifier must separately provision reviewed issuer trust, append-only inclusion and trusted ordering/clock, revocation freshness and prospective eligible-universe proof.",
  "independentSettlement": "Future verifier must separately provision source trust and source-specific total ordering/finality/correction policy; verify complete revision chain and ticket/refund semantics.",
  "protocol": "Approval of formula, stage, frozen cohort, denominator and exclusions is separate from authenticating both evidence chains."
});
const expectedUsageRules: readonly string[] = Object.freeze([
  "All cases are negative specification vectors, not executed tests or verified independent evidence.",
  "Future tests must generate synthetic proof material in an isolated test environment and independently provision the test trust root; do not copy private keys or source credentials into Git.",
  "Use the immutable proof request builder output only as caller claims. Never accept caller-supplied trusted, VERIFIED, FINAL, sourceAuthority or REVIEWED fields as trust configuration.",
  "Enforce failure precedence: malformed input -> trust/proof authenticity -> chronology/inclusion/completeness -> source revision ordering/terminality -> exact ticket/refund reconciliation -> protocol approval.",
  "Do not infer a successful positive attestation from absence of any one denial; each lane needs an independently reviewed positive control before future authorization work.",
  "Never call protected N2 or touch Current BUY, LINE, public publishing, production settings or automated betting for fixture validation.",
  "For X02, absent independent proof is the first causal denial (UNVERIFIED_WITNESS); UNAPPROVED_PROTOCOL remains a downstream blocker and must not mask failed authenticity."
]);

// Evidence references are review navigation, never independent proof. Pin the
// reviewed set independently: a forged or removed reference must not quietly
// turn this deny-only specification into an apparent attestation.
const expectedSourceRefs: readonly string[] = Object.freeze([
  "docs/architecture/research-learning-loop.md",
  "docs/architecture/research-knowledge-retention-contract.md",
  "reports/research/forward-v02-independent-authority-evidence-contract-20261024.md",
  "reports/research/forward-v02-independent-proof-request-handoff-20261024.md",
  "reports/research/forward-v02-untrusted-verifier-response-quarantine-20261024.md",
  "research/registries/learnings/LEARN-forward-v02-partial-verifier-request-binding-20261024.json",
  "research/registries/learnings/LEARN-forward-v02-terminal-proof-ref-fixture-drift-20261024.json",
  "research/registries/learnings/LEARN-forward-v02-settlement-revision-anchor-window-20261024.json",
]);

// Close the catalog's top-level vocabulary independently of the JSON file.
// An unknown field such as positiveControlsVerified must not smuggle an
// independently verified or execution-ready claim past the deny-only guard.
const catalogFields = [
  "schemaVersion", "status", "evidenceStage", "productionConnection",
  "scoringAuthorized", "independentAuthorityVerified", "requestContract",
  "responseContract", "authoritySeparation", "fixtures", "usageRules", "sourceRefs",
] as const;

const fixtureFields = [
  "caseId", "lane", "mutation", "independentFixtureState",
  "expectedDenial", "expectedIndependentAuthorityVerified",
  "expectedScoringAuthorized", "why",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Checks the deny-only *specification*, not the behavior of a verifier. */
function catalogErrors(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ["catalog must be an object"];
  if (Object.keys(input).sort().join("|") !== [...catalogFields].sort().join("|"))
    errors.push("top-level catalog fields drift");
  if (input.schemaVersion !== "forward-v02-independent-verifier-negative-fixtures.0.1-spec")
    errors.push("schema version drift");
  if (input.status !== "SPECIFICATION_ONLY_NOT_EXECUTABLE")
    errors.push("catalog must remain non-executable");
  if (input.evidenceStage !== "SYNTHETIC_OFFLINE_DESIGN")
    errors.push("catalog must remain synthetic design evidence");
  if (input.requestContract !== "forward-v02-independent-proof-request.0.1-untrusted" ||
      input.responseContract !== "forward-v02-independent-proof-response.0.2-untrusted")
    errors.push("untrusted proof handoff contract drift");
  for (const field of ["productionConnection", "scoringAuthorized", "independentAuthorityVerified"]) {
    if (input[field] !== false) errors.push(`${field} must be literal false`);
  }
  const separation = input.authoritySeparation;
  if (!isRecord(separation) ||
      !["callerClaims", "independentWitness", "independentSettlement", "protocol"]
        .every(key => typeof separation[key] === "string")) {
    errors.push("authority separation contract missing");
  }
  if (isRecord(separation)) {
    const expectedKeys = Object.keys(expectedAuthoritySeparation).sort();
    if (Object.keys(separation).sort().join("|") !== expectedKeys.join("|") ||
        expectedKeys.some(key => separation[key] !== expectedAuthoritySeparation[key])) {
      errors.push("authority separation semantics drift");
    }
  }
  // Pin the narrowed local before the callback: TS cannot preserve a property
  // narrowing on an unknown record across a closure.
  const usageRules = input.usageRules;
  if (!Array.isArray(usageRules) ||
      usageRules.length !== expectedUsageRules.length ||
      expectedUsageRules.some((rule, index) => usageRules[index] !== rule)) {
    errors.push("usage rules semantics drift");
  }
  // Do not infer authenticity from a reference string. This only detects
  // provenance drift in the static, non-executable negative catalog.
  const sourceRefs = input.sourceRefs;
  if (!Array.isArray(sourceRefs) ||
      sourceRefs.length !== expectedSourceRefs.length ||
      sourceRefs.some(ref => typeof ref !== "string") ||
      [...sourceRefs].sort().join("|") !== [...expectedSourceRefs].sort().join("|")) {
    errors.push("reviewed source references drift");
  }
  if (!Array.isArray(input.fixtures)) return [...errors, "fixtures must be an array"];
  const seen = new Set<string>();
  for (const [index, item] of input.fixtures.entries()) {
    if (!isRecord(item)) {
      errors.push(`fixture ${index} must be an object`);
      continue;
    }
    const id = item.caseId;
    if (typeof id !== "string" || !Object.hasOwn(expectedDenials, id)) {
      errors.push(`unknown case id at index ${index}`);
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate case id ${id}`);
    seen.add(id);
    const lane = id[0] === "W" ? "FREEZE" : id[0] === "S" ? "SETTLEMENT" : "CONJUNCTION";
    if (item.lane !== lane) errors.push(`lane mismatch ${id}`);
    if (item.expectedDenial !== expectedDenials[id]) errors.push(`denial drift ${id}`);
    const semantics = expectedCaseSemantics[id];
    if (!semantics || item.mutation !== semantics[0] || item.independentFixtureState !== semantics[1])
      errors.push(`fixture semantics drift ${id}`);
    if (item.why !== expectedCaseRationales[id]) errors.push(`causal rationale drift ${id}`);
    if (item.expectedIndependentAuthorityVerified !== false ||
        item.expectedScoringAuthorized !== false) errors.push(`authorization drift ${id}`);
    if (Object.keys(item).sort().join("|") !== [...fixtureFields].sort().join("|"))
      errors.push(`fixture fields drift ${id}`);
    for (const key of ["mutation", "independentFixtureState", "why"]) {
      if (typeof item[key] !== "string" || item[key].trim().length === 0)
        errors.push(`missing ${key} for ${id}`);
    }
  }
  for (const id of Object.keys(expectedDenials)) {
    if (!seen.has(id)) errors.push(`missing case ${id}`);
  }
  return errors;
}

const readCatalog = (): unknown => JSON.parse(readFileSync(catalogUrl, "utf8"));

test("offline verifier negative catalog preserves all 18 deny-only specifications (NOT verifier execution)", () => {
  assert.deepEqual(catalogErrors(readCatalog()), []);
});

test("negative catalog contract rejects silent authorization, deletion and denial drift", () => {
  const source = readCatalog();
  assert.ok(isRecord(source));
  const mutate = (edit: (catalog: Record<string, unknown>) => void) => {
    const copy = structuredClone(source);
    assert.ok(isRecord(copy));
    edit(copy);
    assert.notDeepEqual(catalogErrors(copy), []);
  };
  mutate(c => { c.scoringAuthorized = true; });
  mutate(c => { c.positiveControlsVerified = true; });
  mutate(c => { c.executionReady = true; });
  mutate(c => { c.independentTestTrustRoot = { approved: true }; });
  mutate(c => { c.status = "EXECUTABLE"; });
  mutate(c => { c.evidenceStage = "SHADOW_FORWARD"; });
  mutate(c => { (c.fixtures as unknown[]).pop(); });
  mutate(c => { (c.fixtures as unknown[]).push(structuredClone((c.fixtures as unknown[])[0])); });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).expectedScoringAuthorized = true; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).expectedDenial = "VERIFIED"; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).trusted = true; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[8]).mutation = "FINAL_REVISION_PREDECESSOR_PRESENT"; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[8]).independentFixtureState = "CALLER_CLAIMED_SOURCE_PROOF"; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[17]).mutation = "APPROVED_EVALUATION_PROTOCOL"; });
  mutate(c => { (c.authoritySeparation as Record<string, unknown>).independentWitness = "Caller key is sufficient"; });
  mutate(c => { (c.authoritySeparation as Record<string, unknown>).independentSettlement = "Latest caller FINAL is authoritative"; });
  mutate(c => { (c.authoritySeparation as Record<string, unknown>).protocol = "Caller can approve protocol"; });
  mutate(c => { delete c.authoritySeparation; });
  mutate(c => { c.usageRules = []; });
  mutate(c => { (c.usageRules as string[]).pop(); });
  mutate(c => { (c.usageRules as string[])[0] = "Caller attestation is accepted"; });
  mutate(c => { (c.usageRules as string[]).push("Enable scoring"); });
  mutate(c => { c.requestContract = "forward-v02-independent-proof-request.0.1-verified"; });
  mutate(c => { c.responseContract = "forward-v02-independent-proof-response.0.2-verified"; });
});

test("negative catalog rejects rewritten causal rationales that would mislead future verifier work", () => {
  const source = readCatalog();
  assert.ok(isRecord(source));
  const mutate = (caseId: string, forgedRationale: string) => {
    const copy = structuredClone(source);
    assert.ok(isRecord(copy));
    const fixtures = copy.fixtures;
    assert.ok(Array.isArray(fixtures));
    const item: unknown = fixtures.find((candidate: unknown) => isRecord(candidate) && candidate.caseId === caseId);
    assert.ok(isRecord(item));
    item.why = forgedRationale;
    assert.ok(catalogErrors(copy).includes(`causal rationale drift ${caseId}`));
  };
  mutate("W01", "A caller-selected self-signing key establishes independent witness authority.");
  mutate("S05", "The latest locally observed revision is authenticated terminal settlement.");
  mutate("X02", "Unapproved protocols may score if test proof shapes look consistent.");
});

test("negative catalog cannot masquerade as an independently provisioned positive control", () => {
  const source = readCatalog();
  assert.ok(isRecord(source));
  assert.equal(source.productionConnection, false);
  assert.equal(source.independentAuthorityVerified, false);
  assert.equal(source.scoringAuthorized, false);
  assert.equal(source.status, "SPECIFICATION_ONLY_NOT_EXECUTABLE");
  assert.equal((source.fixtures as unknown[]).length, 18);
});

test("negative catalog rejects provenance reference substitution, deletion and injection", () => {
  const source = readCatalog();
  assert.ok(isRecord(source));
  const refs = source.sourceRefs;
  assert.ok(Array.isArray(refs));
  assert.deepEqual([...refs].sort(), [...expectedSourceRefs].sort());
  const mutate = (edit: (catalog: Record<string, unknown>) => void) => {
    const copy = structuredClone(source);
    assert.ok(isRecord(copy));
    edit(copy);
    assert.ok(catalogErrors(copy).includes("reviewed source references drift"));
  };
  mutate(c => { delete c.sourceRefs; });
  mutate(c => { c.sourceRefs = ["caller-claimed-independent-trust-root"]; });
  mutate(c => { (c.sourceRefs as string[])[0] = "reports/research/caller-verified-finality.json"; });
  mutate(c => { (c.sourceRefs as string[]).pop(); });
  mutate(c => { (c.sourceRefs as string[]).push("reports/research/positive-controls-verified.json"); });
  mutate(c => { (c.sourceRefs as string[])[0] = (c.sourceRefs as string[])[1]; });
});

