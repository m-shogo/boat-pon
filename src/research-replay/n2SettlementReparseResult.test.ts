import assert from "node:assert/strict";
import test from "node:test";

import { resolveN2SettlementReparseResult } from "./n2SettlementReparseResult";

const clean = {
  counts: {
    files_not_ingested: 0,
    parse_errors: 0,
    ambiguous_active: 0,
    ambiguous_non_defect: 0,
    unexpected_addition: 0,
  },
  lightIntegrity: {
    multipleActiveSuccessors: 0,
    selfSupersedingCycles: 0,
    danglingSupersedes: 0,
  },
  appendOnlyEnforcement: {
    updateBlocked: true,
    deleteBlocked: true,
  },
  secondRun: { appended: 0, supersessions: 0 },
  afterConsistent: true,
  fullIntegrity: {
    integrityCheck: "ok",
    foreignKeyViolations: 0,
    orphanPayoutLines: 0,
    orphanRefundLines: 0,
    ambiguousActiveKeys: 0,
  },
  ambiguousActiveKeys: 0,
};

test("reparse result accepts only fully clean verified evidence", () => {
  assert.equal(resolveN2SettlementReparseResult(clean), "REPARSED");
});

test("reparse result keeps non-verify mode compatible when optional verification is absent", () => {
  assert.equal(resolveN2SettlementReparseResult({ ...clean, afterConsistent: null, fullIntegrity: null, secondRun: null }), "REPARSED");
});

test("reparse result flags source archives that could not be ingested", () => {
  assert.equal(resolveN2SettlementReparseResult({
    ...clean,
    counts: { ...clean.counts, files_not_ingested: 1 },
  }), "REPARSED_WITH_FLAGS");
});

test("reparse result flags ambiguous correction and active-state evidence", () => {
  assert.equal(resolveN2SettlementReparseResult({
    ...clean,
    counts: { ...clean.counts, ambiguous_non_defect: 1 },
  }), "REPARSED_WITH_FLAGS");
  assert.equal(resolveN2SettlementReparseResult({
    ...clean,
    counts: { ...clean.counts, ambiguous_active: 1 },
  }), "REPARSED_WITH_FLAGS");
  assert.equal(resolveN2SettlementReparseResult({ ...clean, ambiguousActiveKeys: 1 }), "REPARSED_WITH_FLAGS");
});

test("reparse result flags measured after-state drift", () => {
  assert.equal(resolveN2SettlementReparseResult({ ...clean, afterConsistent: false }), "REPARSED_WITH_FLAGS");
});

test("reparse result flags full integrity failures", () => {
  assert.equal(resolveN2SettlementReparseResult({
    ...clean,
    fullIntegrity: { ...clean.fullIntegrity, foreignKeyViolations: 1 },
  }), "REPARSED_WITH_FLAGS");
});

test("reparse result flags second-run supersession drift", () => {
  assert.equal(resolveN2SettlementReparseResult({
    ...clean,
    secondRun: { appended: 0, supersessions: 1 },
  }), "REPARSED_WITH_FLAGS");
});
