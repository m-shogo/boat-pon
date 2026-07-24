import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const reportPath = join(root, "reports", "n1-all-bet-type-payout-readiness.json");
const docPath = join(root, "docs", "n1-all-bet-type-payout-review.md");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const doc = readFileSync(docPath, "utf8");

assert.equal(report.verdict, "COMPLETE_OFFLINE_PERMANENT_NOT_APPLIED");
assert.equal(report.implementationStatus, "N1_A_OFFLINE_COMPLETE");
assert.equal(report.safety.n1MigrationApplied, false);
assert.equal(report.safety.parserImplemented, true);
assert.equal(report.safety.externalRequests, 0);
assert.equal(report.safety.collectorConnected, false);
assert.equal(report.storageDecision.preferred, "research_replay_sidecar");

const expectedBetTypes = ["win", "place", "exacta", "quinella", "wide", "trifecta", "trio"];
assert.deepEqual(report.currentEvidence.betTypes.map((item) => item.betType), expectedBetTypes);
assert.equal(report.fixtureMatrix.length, 20);
assert.deepEqual(report.fixtureMatrix.map((fixture) => fixture.id), Array.from({ length: 20 }, (_, index) => index + 1));
for (const fixture of report.fixtureMatrix) {
  for (const key of ["expectedState", "payoutLines", "refundLines", "diagnostic", "supersession", "idempotent"]) {
    assert.ok(Object.hasOwn(fixture, key), `fixture ${fixture.id} missing ${key}`);
  }
}

const expectedStates = [
  "pending", "settled", "refunded", "partially_refunded", "cancelled",
  "no_sale", "special_payout", "parse_error", "source_conflict", "corrected",
];
assert.deepEqual(report.settlementStates, expectedStates);
for (const token of [
  "capture_attempt", "raw_document", "parse_run", "domain_observation",
  "DESIGN ONLY / NOT_APPLIED", "Legacy", "N1 REVIEW: CONDITIONAL",
  "win", "place", "exacta", "quinella", "wide", "trifecta", "trio",
]) {
  assert.ok(doc.includes(token), `review doc missing ${token}`);
}

const markdownLinks = [...doc.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
for (const target of markdownLinks.filter((value) => !value.includes("://") && !value.startsWith("#"))) {
  assert.ok(existsSync(resolve(dirname(docPath), target)), `broken doc link: ${target}`);
}

for (const forbidden of [
  "n1MigrationApplied\": true",
  "collectorConnected\": true",
  "productionChanged\": true",
]) {
  assert.ok(!readFileSync(reportPath, "utf8").includes(forbidden), `prohibited scope: ${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  betTypes: expectedBetTypes.length,
  fixtureCases: report.fixtureMatrix.length,
  settlementStates: report.settlementStates.length,
  verdict: report.verdict,
  implementationStatus: report.implementationStatus,
}, null, 2));
