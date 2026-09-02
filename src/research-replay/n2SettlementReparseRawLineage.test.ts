import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveN2SettlementReparseRawAuthority,
  resolveN2SettlementReparseRawDates,
  resolveN2SettlementReparseRawSchemaFamilies,
} from "./n2SettlementReparseRawLineage";

test("reparse raw date lineage resolves one canonical race date per raw", () => {
  const dates = resolveN2SettlementReparseRawDates([
    { rid: "raw-1", k: "2026-08-01:01:R1" },
    { rid: "raw-1", k: "2026-08-01:01:R2" },
    { rid: "raw-2", k: "2028-02-29:24:R12" },
  ]);
  assert.equal(dates.get("raw-1"), "2026-08-01");
  assert.equal(dates.get("raw-2"), "2028-02-29");
});

test("reparse raw date lineage rejects impossible canonical race identities", () => {
  assert.throws(
    () => resolveN2SettlementReparseRawDates([
      { rid: "raw-1", k: "2026-02-30:01:R1" },
    ]),
    /REPARSE_RAW_RACE_IDENTITY_INVALID:raw-1:2026-02-30:01:R1/,
  );
});

test("reparse raw date lineage rejects cross-date observation lineage", () => {
  assert.throws(
    () => resolveN2SettlementReparseRawDates([
      { rid: "raw-1", k: "2026-08-01:01:R1" },
      { rid: "raw-1", k: "2026-08-02:01:R1" },
    ]),
    /REPARSE_RAW_DATE_AMBIGUOUS:raw-1:2026-08-01:2026-08-02/,
  );
});

test("reparse raw schema lineage resolves one family per raw", () => {
  const families = resolveN2SettlementReparseRawSchemaFamilies([
    { rid: "raw-1", fam: "modern_seven_display" },
    { rid: "raw-1", fam: "modern_seven_display" },
    { rid: "raw-2", fam: "legacy_six_display" },
  ]);
  assert.equal(families.get("raw-1"), "modern_seven_display");
  assert.equal(families.get("raw-2"), "legacy_six_display");
});

test("reparse raw schema lineage rejects conflicting families", () => {
  assert.throws(
    () => resolveN2SettlementReparseRawSchemaFamilies([
      { rid: "raw-1", fam: "modern_seven_display" },
      { rid: "raw-1", fam: "legacy_six_display" },
    ]),
    /REPARSE_RAW_SCHEMA_FAMILY_AMBIGUOUS:raw-1:legacy_six_display:modern_seven_display/,
  );
});

test("reparse raw schema lineage rejects blank or noncanonical family authority", () => {
  assert.throws(
    () => resolveN2SettlementReparseRawSchemaFamilies([
      { rid: "raw-blank", fam: "   " },
    ]),
    /REPARSE_RAW_SCHEMA_FAMILY_INVALID:raw-blank/,
  );
  assert.throws(
    () => resolveN2SettlementReparseRawSchemaFamilies([
      { rid: "raw-leading-space", fam: " modern_seven_display" },
    ]),
    /REPARSE_RAW_SCHEMA_FAMILY_INVALID:raw-leading-space/,
  );
  assert.throws(
    () => resolveN2SettlementReparseRawSchemaFamilies([
      { rid: "raw-trailing-space", fam: "modern_seven_display " },
    ]),
    /REPARSE_RAW_SCHEMA_FAMILY_INVALID:raw-trailing-space/,
  );
});

test("reparse raw schema lineage fails closed when a raw has no candidate family authority", () => {
  const families = resolveN2SettlementReparseRawSchemaFamilies([
    { rid: "raw-1", fam: "modern_seven_display" },
  ]);
  assert.throws(
    () => families.get("raw-missing"),
    /REPARSE_RAW_SCHEMA_FAMILY_MISSING:raw-missing/,
  );
});

test("reparse raw authority requires paired date and schema-family lineage", () => {
  const dates = new Map([["raw-1", "2026-08-01"]]);
  const families = new Map([["raw-1", "modern_seven_display"]]);
  assert.deepEqual(resolveN2SettlementReparseRawAuthority("raw-1", dates, families), {
    date: "2026-08-01",
    family: "modern_seven_display",
  });
  assert.equal(resolveN2SettlementReparseRawAuthority("raw-unrelated", dates, families), null);
  assert.throws(
    () => resolveN2SettlementReparseRawAuthority("raw-family-only", new Map(), new Map([["raw-family-only", "modern_seven_display"]])),
    /REPARSE_RAW_DATE_MISSING:raw-family-only/,
  );
  assert.throws(
    () => resolveN2SettlementReparseRawAuthority("raw-date-only", new Map([["raw-date-only", "2026-08-01"]]), new Map()),
    /REPARSE_RAW_SCHEMA_FAMILY_MISSING:raw-date-only/,
  );
});
