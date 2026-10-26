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
  X02: "UNAPPROVED_PROTOCOL",
});

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
  if (input.schemaVersion !== "forward-v02-independent-verifier-negative-fixtures.0.1-spec")
    errors.push("schema version drift");
  if (input.status !== "SPECIFICATION_ONLY_NOT_EXECUTABLE")
    errors.push("catalog must remain non-executable");
  if (input.evidenceStage !== "SYNTHETIC_OFFLINE_DESIGN")
    errors.push("catalog must remain synthetic design evidence");
  for (const field of ["productionConnection", "scoringAuthorized", "independentAuthorityVerified"]) {
    if (input[field] !== false) errors.push(`${field} must be literal false`);
  }
  if (!isRecord(input.authoritySeparation) ||
      !["callerClaims", "independentWitness", "independentSettlement", "protocol"]
        .every(key => typeof input.authoritySeparation?.[key] === "string")) {
    errors.push("authority separation contract missing");
  }
  if (!Array.isArray(input.fixtures)) return [...errors, "fixtures must be an array"];
  const seen = new Set<string>();
  for (const [index, item] of input.fixtures.entries()) {
    if (!isRecord(item)) {
      errors.push(`fixture ${index} must be an object`);
      continue;
    }
    const id = item.caseId;
    if (typeof id !== "string" || !(id in expectedDenials)) {
      errors.push(`unknown case id at index ${index}`);
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate case id ${id}`);
    seen.add(id);
    const lane = id[0] === "W" ? "FREEZE" : id[0] === "S" ? "SETTLEMENT" : "CONJUNCTION";
    if (item.lane !== lane) errors.push(`lane mismatch ${id}`);
    if (item.expectedDenial !== expectedDenials[id]) errors.push(`denial drift ${id}`);
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
  mutate(c => { c.status = "EXECUTABLE"; });
  mutate(c => { c.evidenceStage = "SHADOW_FORWARD"; });
  mutate(c => { (c.fixtures as unknown[]).pop(); });
  mutate(c => { (c.fixtures as unknown[]).push(structuredClone((c.fixtures as unknown[])[0])); });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).expectedScoringAuthorized = true; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).expectedDenial = "VERIFIED"; });
  mutate(c => { ((c.fixtures as Record<string, unknown>[])[0]).trusted = true; });
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
