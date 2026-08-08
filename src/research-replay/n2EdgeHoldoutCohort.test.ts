import assert from "node:assert/strict";
import test from "node:test";
import { buildN2EdgeHoldoutCohort, N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT } from "./n2EdgeHoldoutCohort";

function races(year: number, venue: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(`${year}-01-01T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + Math.floor(index / 12));
    return { canonicalRaceKey: `${d.toISOString().slice(0,10)}:${venue}:R${(index % 12)+1}` };
  });
}

test("validation/test are sampled independently by year x venue with a hard 12-race cap", () => {
  const report = buildN2EdgeHoldoutCohort([
    ...races(2022,"05",30), ...races(2023,"05",20),
    ...races(2024,"05",30), ...races(2025,"05",20),
  ]);
  assert.equal(report.status,"PASS");
  assert.equal(report.selectedValidationRaceCount,24);
  assert.equal(report.selectedTestRaceCount,24);
  assert.equal(report.selectedByStratum["validation:2022:05"],12);
  assert.equal(report.selectedByStratum["test:2024:05"],12);
  assert.equal(report.policy.outcomeValueUsedForSampling,false);
  assert.equal(report.policy.hypothesisResultUsedForSampling,false);
  assert.equal(report.policy.featureValueUsedForSampling,false);
  assert.equal(report.policy.payoutUsedForSampling,false);
});

test("input order cannot change either holdout cohort", () => {
  const input=[...races(2022,"01",24),...races(2024,"02",24)];
  const a=buildN2EdgeHoldoutCohort(input);
  const b=buildN2EdgeHoldoutCohort([...input].reverse());
  assert.equal(a.outputDigest,b.outputDigest);
  assert.equal(a.validationCohortDigest,b.validationCohortDigest);
  assert.equal(a.testCohortDigest,b.testCohortDigest);
  assert.deepEqual(a.races,b.races);
});

test("train/forward dates are excluded and invalid/duplicates fail closed", () => {
  const range=buildN2EdgeHoldoutCohort([
    {canonicalRaceKey:"2021-12-31:01:R1"},
    {canonicalRaceKey:"2022-01-01:01:R1"},
    {canonicalRaceKey:"2025-12-31:01:R1"},
    {canonicalRaceKey:"2026-01-01:01:R1"},
  ]);
  assert.equal(range.status,"PASS");
  assert.equal(range.excludedOutsideHoldoutCount,2);
  assert.equal(range.selectedValidationRaceCount,1);
  assert.equal(range.selectedTestRaceCount,1);

  const duplicate=buildN2EdgeHoldoutCohort([{canonicalRaceKey:"2022-01-01:01:R1"},{canonicalRaceKey:"2022-01-01:01:R1"}]);
  assert.equal(duplicate.status,"BLOCKED");
  const invalid=buildN2EdgeHoldoutCohort([{canonicalRaceKey:"bad"}]);
  assert.equal(invalid.status,"BLOCKED");
});

test("policy hard cap is 576 races per split",()=>{
  assert.equal(N2_EDGE_HOLDOUT_MAX_RACES_PER_SPLIT,576);
});
