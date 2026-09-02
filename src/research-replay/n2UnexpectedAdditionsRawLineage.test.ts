import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveUnexpectedAdditionsRawDate,
  resolveUnexpectedAdditionsSourceSchemaFamily,
} from "./n2UnexpectedAdditionsRawLineage";

test("unexpected additions raw lineage requires canonical same-day race identities", () => {
  assert.equal(resolveUnexpectedAdditionsRawDate([
    "2026-05-03:01:R1",
    "2026-05-03:24:R12",
  ]), "2026-05-03");
  assert.throws(
    () => resolveUnexpectedAdditionsRawDate([]),
    /N2_UNEXPECTED_ADDITIONS_RAW_RACE_IDENTITY_MISSING/,
  );

  assert.throws(
    () => resolveUnexpectedAdditionsRawDate(["2026-05-32:01:R1"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_RACE_IDENTITY_INVALID/,
  );
  assert.throws(
    () => resolveUnexpectedAdditionsRawDate(["2026-05-03:01:R1", "2026-05-04:01:R1"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_DATE_AMBIGUOUS/,
  );
});

test("unexpected additions raw lineage fails closed on missing, blank, noncanonical, or ambiguous schema family", () => {
  assert.throws(
    () => resolveUnexpectedAdditionsSourceSchemaFamily([]),
    /N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_MISSING/,
  );
  assert.throws(
    () => resolveUnexpectedAdditionsSourceSchemaFamily(["   "]),
    /N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_INVALID/,
  );
  assert.throws(
    () => resolveUnexpectedAdditionsSourceSchemaFamily([" modern_seven_display"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_INVALID/,
  );
  assert.throws(
    () => resolveUnexpectedAdditionsSourceSchemaFamily(["modern_seven_display "]),
    /N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_INVALID/,
  );
  assert.equal(resolveUnexpectedAdditionsSourceSchemaFamily(["modern_seven_display"]), "modern_seven_display");
  assert.equal(
    resolveUnexpectedAdditionsSourceSchemaFamily(["modern_seven_display", "modern_seven_display"]),
    "modern_seven_display",
  );
  assert.throws(
    () => resolveUnexpectedAdditionsSourceSchemaFamily(["modern_seven_display", "legacy_six_display"]),
    /N2_UNEXPECTED_ADDITIONS_RAW_SCHEMA_FAMILY_AMBIGUOUS:legacy_six_display:modern_seven_display/,
  );
});
