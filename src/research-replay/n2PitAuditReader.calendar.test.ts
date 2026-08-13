import assert from "node:assert/strict";
import test from "node:test";

import { raceIdFromCanonicalN2Key } from "./n2PitAuditReader";

test("PIT race identity rejects impossible calendar dates", () => {
  assert.equal(raceIdFromCanonicalN2Key("2026-02-30:01:R1"), null);
  assert.equal(raceIdFromCanonicalN2Key("2026-04-31:01:R1"), null);
  assert.equal(raceIdFromCanonicalN2Key("2026-02-29:01:R1"), null);
});

test("PIT race identity preserves valid leap days", () => {
  assert.equal(raceIdFromCanonicalN2Key("2028-02-29:01:R1"), "20280229-01-01");
});
