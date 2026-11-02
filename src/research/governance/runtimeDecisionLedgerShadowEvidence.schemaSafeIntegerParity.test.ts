import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Schema-only consumers must not admit JSON integers that the research
// runtime rejects with Number.isSafeInteger. This is metadata parity only:
// it does not authenticate sources or authorize forward evaluation.
type IntegerRule = { type: string; minimum: number; maximum?: number };
type ShadowSchema = {
  properties: {
    source: { properties: Record<string, IntegerRule> };
    scope: { properties: Record<string, IntegerRule> };
    reconciliation: { properties: Record<string, IntegerRule> };
  };
  $defs: { countMap: { additionalProperties: IntegerRule } };
};
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as ShadowSchema;

const sourceIntegerFields = [
  "fileSizeBytes", "sqliteSchemaVersion", "sqliteUserVersion",
  "pageCount", "pageSizeBytes", "freelistCount",
] as const;
const reconciliationIntegerFields = [
  "sourceRows", "mappedUnique", "exactDuplicates",
  "unresolvedCount", "rejectedCount", "conflictCount",
] as const;

test("shadow schema numeric counters match runtime safe-integer upper bound", () => {
  const rules: Array<[string, IntegerRule]> = [
    ...sourceIntegerFields.map((key): [string, IntegerRule] => [
      `source.${key}`, schema.properties.source.properties[key],
    ]),
    ["scope.returnedRows", schema.properties.scope.properties.returnedRows],
    ...reconciliationIntegerFields.map((key): [string, IntegerRule] => [
      `reconciliation.${key}`, schema.properties.reconciliation.properties[key],
    ]),
  ];
  assert.equal(rules.length, 13);
  for (const [path, rule] of rules) {
    assert.equal(rule.type, "integer", path);
    assert.equal(rule.minimum, path === "source.pageSizeBytes" ? 1 : 0, path);
    assert.equal(rule.maximum, Number.MAX_SAFE_INTEGER, path);
    assert.ok(Number.MAX_SAFE_INTEGER + 1 > rule.maximum!, path);
  }
});

test("shadow schema dynamic reason and taxonomy counts also reject unsafe integers", () => {
  const rule = schema.$defs.countMap.additionalProperties;
  assert.equal(rule.type, "integer");
  assert.equal(rule.minimum, 1);
  assert.equal(rule.maximum, Number.MAX_SAFE_INTEGER);
  assert.ok(Number.MAX_SAFE_INTEGER + 1 > rule.maximum!);
});
