import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guarded = readFileSync("scripts/report-paper-forward-candidates-raw.ts", "utf8");
const internal = readFileSync("scripts/report-paper-forward-candidates-internal.ts", "utf8");

test("paper-forward raw entrypoint runs settlement completeness before internal aggregation", () => {
  const preflight = guarded.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const aggregation = guarded.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');

  assert.ok(preflight >= 0, "canonical settlement completeness preflight must be invoked");
  assert.ok(aggregation > preflight, "internal aggregation must only run after the preflight");
  assert.match(guarded, /FAIL CLOSED: official trifecta settlement completeness did not pass/u);
  assert.doesNotMatch(guarded, /new DatabaseSync/u);
});

test("paper-forward aggregation implementation is separated from the guarded raw entrypoint", () => {
  assert.match(internal, /const BASE_WHERE/u);
  assert.match(internal, /race_payouts/u);
});