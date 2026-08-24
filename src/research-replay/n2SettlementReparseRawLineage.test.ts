import assert from "node:assert/strict";
import test from "node:test";
import { resolveN2SettlementReparseRawDates } from "./n2SettlementReparseRawLineage";

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
