import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// JSON Schema Draft 2020-12 format may be annotation-only. A schema-only
// consumer must reject malformed caller timestamps without FormatChecker.
// This is lexical parity only; runtime still owns Gregorian validity and
// generatedAt is never a trusted clock or independent finality witness.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as { properties: { generatedAt: { type: string; format: string; pattern: string; description: string } } };
const generatedAt = schema.properties.generatedAt;

test("shadow generatedAt schema requires canonical UTC millisecond lexical form without format assertion", () => {
  assert.equal(generatedAt.type, "string");
  assert.equal(generatedAt.format, "date-time");
  const lexical = new RegExp(generatedAt.pattern, "u");
  for (const value of [
    "2026-08-05T08:10:00.000Z",
    "2026-11-02T12:00:00.123Z",
    "2000-02-29T23:59:59.999Z",
  ]) assert.equal(lexical.test(value), true, value);
  for (const value of [
    "not-an-instant",
    "2026-11-02t12:00:00.000z",
    "2026-11-02T12:00:00Z",
    "2026-11-02T12:00:00.0Z",
    "2026-11-02T12:00:00.000+00:00",
    "2026-11-02T12:00:00.000-00:00",
    "2026-11-02T24:00:00.000Z",
    "2026-13-02T12:00:00.000Z",
    "0000-11-02T12:00:00.000Z",
  ]) assert.equal(lexical.test(value), false, value);
});

test("shadow schema does not turn generatedAt into trusted time or scoring authority", () => {
  assert.match(generatedAt.description, /not a trusted clock/);
  assert.equal(Object.hasOwn(schema.properties, "scoringAuthorized"), false);
  assert.equal(Object.hasOwn(schema.properties, "independentAuthorityVerified"), false);
});

test("shadow scope from/to schemas reject malformed dates without format assertion", () => {
  const scopeDates = (schema as unknown as {
    properties: { scope: { properties: {
      from: { type: string; format: string; pattern: string };
      to: { type: string; format: string; pattern: string };
    } } };
  }).properties.scope.properties;
  assert.equal(scopeDates.from.pattern, scopeDates.to.pattern);
  for (const field of [scopeDates.from, scopeDates.to]) {
    assert.equal(field.type, "string");
    assert.equal(field.format, "date");
    const lexical = new RegExp(field.pattern, "u");
    for (const value of ["2026-11-02", "2000-02-29", "2026-01-01"]) {
      assert.equal(lexical.test(value), true, value);
    }
    for (const value of [
      "not-a-date",
      "2026-13-02",
      "2026-00-02",
      "2026-11-00",
      "2026-11-32",
      "0000-11-02",
      "2026-11-02T00:00:00Z",
      "2026-11-02Z",
      " 2026-11-02",
      "2026-11-02 ",
    ]) assert.equal(lexical.test(value), false, value);
  }
});

test("shadow scope date regex is lexical only; runtime must still reject impossible calendar days", () => {
  const scope = (schema as unknown as {
    properties: { scope: { properties: { from: { pattern: string } } } };
  }).properties.scope.properties;
  // Regex-only JSON Schema validation is not a substitute for the runtime
  // Date roundtrip; a date-shaped but impossible Gregorian day remains lexical.
  assert.equal(new RegExp(scope.from.pattern, "u").test("2026-02-30"), true);
});
