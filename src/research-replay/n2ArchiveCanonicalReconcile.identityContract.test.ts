import assert from "node:assert/strict";
import test from "node:test";
import {
  RECONCILE_INPUT_VERSION,
  candidateKey,
  venueCodeFromKey,
  yearFromKey,
} from "./n2ArchiveCanonicalReconcile";

test("reconciliation identity helpers reject malformed or impossible canonical race keys", () => {
  for (const key of [
    "2026-02-30:01:R1",
    "2026-08-01:00:R1",
    "2026-08-01:25:R1",
    "2026-08-01:01:R13",
    "20260801-01-01",
  ]) {
    assert.throws(() => yearFromKey(key), /invalid canonical race key/);
    assert.throws(() => venueCodeFromKey(key), /invalid canonical race key/);
    assert.throws(() => candidateKey(key, "trifecta"), /invalid canonical race key/);
  }
});

test("reconciliation identity helpers preserve valid leap-day race keys", () => {
  const key = "2028-02-29:24:R12";
  assert.equal(yearFromKey(key), "2028");
  assert.equal(venueCodeFromKey(key), "24");
  assert.equal(candidateKey(key, "trifecta"), `${key}\u0000trifecta`);
});

test("reconciliation input contract version records strict canonical-key validation", () => {
  assert.equal(RECONCILE_INPUT_VERSION, "n2-archive-canonical-reconcile-v2");
});
