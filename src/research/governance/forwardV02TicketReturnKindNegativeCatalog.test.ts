import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static research contract guard ONLY. This does not execute a verifier,
// authenticate ticket settlement, authorize scoring, or connect to production.
const catalogUrl = new URL("../../../reports/research/forward-v02-ticket-return-kind-negative-vectors-20261031.json", import.meta.url);

const expectedCases = Object.freeze({
  R01: { mutation: "SOURCE_RETURN_KIND_MISSING_WITH_POSITIVE_PAYOUT", state: "SOURCE_PROOF_UNAVAILABLE", denial: "UNRESOLVED_RETURN_KIND", why: "A positive payout and FINAL claim cannot identify ordinary versus special payout without a source-authenticated exact-ticket return kind." },
  R02: { mutation: "SOURCE_SPECIAL_PAYOUT_RELABELED_ORDINARY", state: "INDEPENDENT_TEST_SPECIAL_RETURN_PROOF_PRESENT", denial: "CONFLICT", why: "An authenticated special payout cannot be relabeled as an ordinary winning return or included in research ROI." },
  R03: { mutation: "SOURCE_EXACTA_PROOF_REUSED_FOR_TRIFECTA", state: "INDEPENDENT_TEST_BET_TYPE_PROOF_PRESENT", denial: "UNRESOLVED_IDENTITY", why: "A source proof for one bet type cannot establish settlement for another bet type in the same race." },
  R04: { mutation: "SOURCE_SELECTION_PROOF_REUSED_FOR_DIFFERENT_SELECTION", state: "INDEPENDENT_TEST_SELECTION_PROOF_PRESENT", denial: "UNRESOLVED_IDENTITY", why: "Ticket selection and decision identity must match the independently authenticated source proof, not merely the race." },
  R05: { mutation: "EARLIER_ORDINARY_RETURN_REVISION_OVERRIDDEN_BY_LATER_SPECIAL", state: "INDEPENDENT_TEST_CORRECTION_CHAIN_PRESENT", denial: "CONFLICT", why: "An earlier ordinary payout cannot be scored after a source-authenticated later terminal correction changes its return kind." },
  R06: { mutation: "RACE_WIDE_VOID_APPLIED_TO_ONLY_ONE_BET_TYPE", state: "INDEPENDENT_TEST_BET_TYPE_ESTABLISHMENT_PRESENT", denial: "UNRESOLVED_IDENTITY", why: "Race-wide labels cannot replace independently authenticated bet-type establishment and ticket-level disposition." },
  R07: { mutation: "REFUNDED_TICKET_MAPPED_TO_ZERO_PAYOUT_LOSS", state: "INDEPENDENT_TEST_REFUND_PROOF_PRESENT", denial: "UNRESOLVED_REFUND_OR_INVALIDATION", why: "A source-authenticated refund must remain excluded and counted, not be converted into a zero-return loss." },
  R08: { mutation: "CALLER_RECOMPUTED_TICKET_DIGEST_WITHOUT_SOURCE_ATTESTATION", state: "NO_INDEPENDENT_SOURCE_ATTESTATION", denial: "UNVERIFIED_SOURCE", why: "A caller-recomputed commitment or matching SHA-256 transcript is not an issuer-authenticated ticket return-kind proof." },
});
const expectedSources: readonly string[] = Object.freeze([
  "docs/architecture/research-learning-loop.md",
  "docs/architecture/research-knowledge-retention-contract.md",
  "reports/research/forward-v02-pr2286-proof-request-ticket-return-kind-capability-gap-20261031.md",
  "reports/research/forward-v02-pr2286-special-payout-outcome-ledger-bridge-gap-20261031.md",
  "reports/research/forward-v02-independent-verifier-negative-vectors-20261026.json",
  "research/registries/learnings/LEARN-forward-v02-terminal-return-kind-fixture-parity-20261031.json",
  "research/registries/learnings/LEARN-forward-v02-candidate-return-population-special-payout-20261031.json",
]);
const expectedRules: readonly string[] = Object.freeze([
  "These are static negative specifications only; no verifier executes these cases and no positive proof exists.",
  "Keep independent test source proof separate from caller metadata; do not accept claimed FINAL, payout amount, race status or caller digest as authority.",
  "Do not add raw ticket, odds, account identifiers, secrets or private paths to this catalog or the metadata-only request.",
  "Require source-authenticated exact bet type, selection, decision identity, terminal revision and return kind; preserve correction-chain and revocation semantics.",
  "Treat unresolved, special payout, refund and void as unscorable under the unapproved v0.2 candidate; do not infer readiness or ROI.",
  "Never run protected N2 or connect research to Current BUY, LINE, public publishing, automated betting, production settings or Owner Dashboard.",
]);
const topFields = [
  "schemaVersion", "status", "evidenceStage", "productionConnection",
  "scoringAuthorized", "independentAuthorityVerified", "baseRequestContract",
  "futureProofContract", "authorityBoundary", "fixtures", "usageRules", "sourceRefs",
];
const caseFields = [
  "caseId", "lane", "mutation", "independentFixtureState",
  "expectedDenial", "expectedIndependentAuthorityVerified",
  "expectedScoringAuthorized", "why",
];
const boundary = "The caller metadata-only request cannot attest ticket type, selection, decision identity, terminal revision or return kind. Independently provisioned source proof and versioned adapter are prerequisites, not present here.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function errors(input: unknown): string[] {
  if (!isRecord(input)) return ["catalog object required"];
  const problems: string[] = [];
  if (Object.keys(input).sort().join("|") !== [...topFields].sort().join("|"))
    problems.push("catalog fields drift");
  if (input.schemaVersion !== "forward-v02-ticket-return-kind-negative-fixtures.0.1-spec" ||
      input.status !== "SPECIFICATION_ONLY_NOT_EXECUTABLE" ||
      input.evidenceStage !== "SYNTHETIC_OFFLINE_DESIGN")
    problems.push("non-executable specification status drift");
  for (const k of ["productionConnection", "scoringAuthorized", "independentAuthorityVerified"]) {
    if (input[k] !== false) problems.push(k + " must be false");
  }
  if (input.baseRequestContract !== "forward-v02-independent-proof-request.0.1-untrusted" ||
      input.futureProofContract !== "UNDEFINED_REQUIRES_SEPARATE_REVIEW" ||
      input.authorityBoundary !== boundary)
    problems.push("independent proof custody boundary drift");
  const rules = input.usageRules;
  if (!Array.isArray(rules) || rules.length !== expectedRules.length ||
      expectedRules.some((s, i) => rules[i] !== s))
    problems.push("usage rules drift");
  const sources = input.sourceRefs;
  if (!Array.isArray(sources) || sources.length !== expectedSources.length ||
      [...sources].sort().join("|") !== [...expectedSources].sort().join("|"))
    problems.push("source lineage drift");
  const fixtures = input.fixtures;
  if (!Array.isArray(fixtures)) return [...problems, "fixtures array required"];
  const seen = new Set<string>();
  for (const item of fixtures) {
    if (!isRecord(item) || typeof item.caseId !== "string" ||
        !Object.hasOwn(expectedCases, item.caseId)) {
      problems.push("unknown fixture");
      continue;
    }
    const id = item.caseId as keyof typeof expectedCases;
    if (seen.has(id)) problems.push("duplicate " + id);
    seen.add(id);
    const e = expectedCases[id];
    if (Object.keys(item).sort().join("|") !== [...caseFields].sort().join("|"))
      problems.push("fixture fields drift " + id);
    if (item.lane !== "SETTLEMENT" || item.mutation !== e.mutation ||
        item.independentFixtureState !== e.state || item.expectedDenial !== e.denial ||
        item.why !== e.why)
      problems.push("causal semantics drift " + id);
    if (item.expectedIndependentAuthorityVerified !== false ||
        item.expectedScoringAuthorized !== false)
      problems.push("authorization drift " + id);
  }
  for (const id of Object.keys(expectedCases)) {
    if (!seen.has(id)) problems.push("missing " + id);
  }
  return problems;
}

const load = (): unknown => JSON.parse(readFileSync(catalogUrl, "utf8"));

test("exact-ticket return-kind catalog retains eight deny-only specifications (NOT verifier execution)", () => {
  assert.deepEqual(errors(load()), []);
});

test("exact-ticket return-kind catalog rejects authority, omission and causal-denial drift", () => {
  const source = load();
  assert.ok(isRecord(source));
  const mutate = (fn: (copy: Record<string, unknown>) => void) => {
    const copy = structuredClone(source);
    assert.ok(isRecord(copy));
    fn(copy);
    assert.notDeepEqual(errors(copy), []);
  };
  mutate(c => { c.scoringAuthorized = true; });
  mutate(c => { c.independentAuthorityVerified = true; });
  mutate(c => { c.productionConnection = true; });
  mutate(c => { c.status = "EXECUTABLE"; });
  mutate(c => { c.futureProofContract = "verified"; });
  mutate(c => { c.authorityBoundary = "Caller payout is authoritative"; });
  mutate(c => { (c.fixtures as unknown[]).pop(); });
  mutate(c => { (c.fixtures as unknown[]).push(structuredClone((c.fixtures as unknown[])[0])); });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[0]!.expectedDenial = "VERIFIED"; });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[1]!.expectedScoringAuthorized = true; });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[2]!.mutation = "SAME_RACE_PROOF_IS_SUFFICIENT"; });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[4]!.why = "Earlier ordinary return wins"; });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[7]!.independentFixtureState = "CALLER_DIGEST_IS_AUTHORITY"; });
  mutate(c => { (c.fixtures as Record<string, unknown>[])[0]!.trusted = true; });
  mutate(c => { c.usageRules = []; });
  mutate(c => { (c.sourceRefs as string[]).pop(); });
});
