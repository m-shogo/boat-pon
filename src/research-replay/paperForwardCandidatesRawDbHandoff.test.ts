import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("paper-forward raw entrypoint reverifies DB identity after settlement preflight", () => {
  const source = readFileSync("scripts/report-paper-forward-candidates-raw.ts", "utf8");

  const preflight = source.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const verify = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const internal = source.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  const handoff = source.indexOf("BOAT_PON_DB_PATH: handoffDbPath");

  assert.ok(preflight >= 0, "settlement completeness preflight must remain mandatory");
  assert.ok(verify > preflight, "DB identity must be reverified after the preflight");
  assert.ok(internal > verify, "internal aggregation must start only after DB identity revalidation");
  assert.ok(handoff > internal, "internal aggregation must receive only the verified DB path");
  assert.match(source, /PAPER_FORWARD_RAW_DB_HANDOFF_IDENTITY_INVALID/);
});
