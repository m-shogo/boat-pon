import assert from "node:assert/strict";
import test from "node:test";
import { archiveFileForRaceKey } from "./n1CanonicalResolution";

test("canonical duplicate resolution rejects impossible and out-of-range race identities", () => {
  assert.throws(() => archiveFileForRaceKey("2026-02-30:01:R1"), /invalid canonical race key/);
  assert.throws(() => archiveFileForRaceKey("2026-08-21:25:R1"), /invalid canonical race key/);
  assert.throws(() => archiveFileForRaceKey("2026-08-21:01:R13"), /invalid canonical race key/);
});

test("canonical duplicate resolution preserves valid leap-day archive lineage", () => {
  assert.equal(archiveFileForRaceKey("2028-02-29:24:R12"), "k280229.lzh");
});
