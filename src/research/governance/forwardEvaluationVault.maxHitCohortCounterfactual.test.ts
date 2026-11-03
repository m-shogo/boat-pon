/**
 * Synthetic-only v0.2 evaluation-contract counterfactual, NOT a scorer.
 *
 * v0.1 does not freeze the max-profit event unit or the cross-system exclusion
 * alignment policy. These fixtures make both ambiguities executable in CI.
 * No real outcomes, odds, protected N2 runs or production connections.
 */
import assert from "node:assert/strict";
import test from "node:test";

type EventUnit = "DECISION_RECORD" | "CANONICAL_RACE";
type Ticket = Readonly<{
  decisionId: string;
  canonicalRaceId: string;
  stakeYen: number;
  payoutYen: number;
}>;
type SyntheticSensitivity = Readonly<{
  removedEvent: string | null;
  retainedRaceIds: readonly string[];
  netYen: bigint;
  stakeYen: bigint;
  scoringAuthorized: false;
}>;

function sensitivity(
  tickets: readonly Ticket[],
  eventUnit: EventUnit,
  predeclaredSharedExclusion?: string,
): SyntheticSensitivity {
  if (eventUnit !== "DECISION_RECORD" && eventUnit !== "CANONICAL_RACE")
    throw new TypeError("event unit is not frozen");
  if (!tickets.length) throw new TypeError("empty synthetic cohort");
  const seen = new Set<string>();
  const events = new Map<string, { stake: bigint; payout: bigint }>();
  let stake = 0n, payout = 0n;
  for (const t of tickets) {
    if (!t || typeof t.decisionId !== "string" || !t.decisionId.trim()
      || typeof t.canonicalRaceId !== "string" || !t.canonicalRaceId.trim()
      || !Number.isSafeInteger(t.stakeYen) || t.stakeYen <= 0
      || !Number.isSafeInteger(t.payoutYen) || t.payoutYen < 0
      || seen.has(t.decisionId)) throw new TypeError("invalid synthetic ticket");
    seen.add(t.decisionId);
    const key = eventUnit === "CANONICAL_RACE" ? t.canonicalRaceId : t.decisionId;
    const prev = events.get(key) ?? { stake: 0n, payout: 0n };
    const s = BigInt(t.stakeYen), p = BigInt(t.payoutYen);
    events.set(key, { stake: prev.stake + s, payout: prev.payout + p });
    stake += s;
    payout += p;
  }
  let best: string | null = null;
  let bestNet = 0n;
  for (const key of [...events.keys()].sort()) {
    const event = events.get(key)!;
    const net = event.payout - event.stake;
    if (net > bestNet) { best = key; bestNet = net; }
  }
  if (predeclaredSharedExclusion !== undefined
    && (eventUnit !== "CANONICAL_RACE" || !events.has(predeclaredSharedExclusion)))
    throw new TypeError("shared exclusion must name a cohort race");
  const removed = predeclaredSharedExclusion ?? best;
  const excluded = removed === null ? { stake: 0n, payout: 0n } : events.get(removed)!;
  const denominator = stake - excluded.stake;
  if (denominator <= 0n) throw new TypeError("zero remaining denominator");
  const retainedRaceIds = [...new Set(tickets
    .filter(t => eventUnit === "DECISION_RECORD"
      ? t.decisionId !== removed : t.canonicalRaceId !== removed)
    .map(t => t.canonicalRaceId))].sort();
  return {
    removedEvent: removed,
    retainedRaceIds,
    netYen: payout - excluded.payout - denominator,
    stakeYen: denominator,
    scoringAuthorized: false,
  };
}

function system(name: "A" | "B"): Ticket[] {
  const payouts = name === "A"
    ? [[0, 0], [0, 300], [1600, 600]]
    : [[0, 300], [100, 0], [400, 0]];
  return payouts.flatMap((race, r) => race.map((payoutYen, d) => ({
    decisionId: `${name}-r${r}-d${d}`,
    canonicalRaceId: `shared-race-${r}`,
    stakeYen: 100,
    payoutYen,
  })));
}

function compareExact(a: SyntheticSensitivity, b: SyntheticSensitivity): number {
  const difference = a.netYen * b.stakeYen - b.netYen * a.stakeYen;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

test("max-profit event unit alone reverses synthetic A/B ranking", () => {
  const a = system("A"), b = system("B");
  const recordA = sensitivity(a, "DECISION_RECORD");
  const recordB = sensitivity(b, "DECISION_RECORD");
  const raceA = sensitivity(a, "CANONICAL_RACE");
  const raceB = sensitivity(b, "CANONICAL_RACE");
  assert.deepEqual([recordA.netYen, recordA.stakeYen], [400n, 500n]);
  assert.deepEqual([recordB.netYen, recordB.stakeYen], [-100n, 500n]);
  assert.deepEqual([raceA.netYen, raceA.stakeYen], [-100n, 400n]);
  assert.deepEqual([raceB.netYen, raceB.stakeYen], [0n, 400n]);
  assert.equal(compareExact(recordA, recordB), 1);
  assert.equal(compareExact(raceA, raceB), -1);
  for (const result of [recordA, recordB, raceA, raceB])
    assert.equal(result.scoringAuthorized, false);
});

test("system-specific best-race removal breaks an initially common race cohort", () => {
  const a = system("A");
  const b = system("B").map(t => ({
    ...t,
    payoutYen: t.canonicalRaceId === "shared-race-1"
      ? (t.decisionId.endsWith("-d0") ? 1200 : 300)
      : t.canonicalRaceId === "shared-race-2"
        ? (t.decisionId.endsWith("-d0") ? 100 : 0) : 0,
  }));
  const universe = (rows: readonly Ticket[]) =>
    [...new Set(rows.map(t => t.canonicalRaceId))].sort();
  assert.deepEqual(universe(a), universe(b));
  const ra = sensitivity(a, "CANONICAL_RACE");
  const rb = sensitivity(b, "CANONICAL_RACE");
  assert.equal(ra.removedEvent, "shared-race-2");
  assert.equal(rb.removedEvent, "shared-race-1");
  assert.notDeepEqual(ra.retainedRaceIds, rb.retainedRaceIds);
  assert.equal(ra.scoringAuthorized, false);
  assert.equal(rb.scoringAuthorized, false);

  // A prospectively shared exclusion is a DIFFERENT hypothetical statistic,
  // not a license to choose a favorable rule after seeing the payouts.
  const sharedA = sensitivity(a, "CANONICAL_RACE", "shared-race-2");
  const sharedB = sensitivity(b, "CANONICAL_RACE", "shared-race-2");
  assert.deepEqual(sharedA.retainedRaceIds, sharedB.retainedRaceIds);
  assert.notDeepEqual(sharedB.retainedRaceIds, rb.retainedRaceIds);
  assert.equal(sharedA.scoringAuthorized, false);
  assert.equal(sharedB.scoringAuthorized, false);
});

test("whole-race removal subtracts both stake and payout, including every ticket", () => {
  const result = sensitivity(system("A"), "CANONICAL_RACE");
  assert.equal(result.removedEvent, "shared-race-2");
  assert.equal(result.stakeYen, 400n);
  assert.equal(result.netYen, -100n);
  assert.deepEqual(result.retainedRaceIds, ["shared-race-0", "shared-race-1"]);
});

test("deterministic tie-break and input permutation do not change exact sensitivity", () => {
  const rows: Ticket[] = [
    { decisionId: "z", canonicalRaceId: "z-race", stakeYen: 100, payoutYen: 300 },
    { decisionId: "a", canonicalRaceId: "a-race", stakeYen: 100, payoutYen: 300 },
    { decisionId: "x", canonicalRaceId: "x-race", stakeYen: 100, payoutYen: 0 },
  ];
  for (const unit of ["DECISION_RECORD", "CANONICAL_RACE"] as const) {
    const first = sensitivity(rows, unit);
    assert.deepEqual(first, sensitivity([...rows].reverse(), unit));
    assert.equal(first.removedEvent, unit === "DECISION_RECORD" ? "a" : "a-race");
  }
});

test("invalid money, duplicate decisions, zero denominator and missing shared race fail closed", () => {
  const one: Ticket = { decisionId: "one", canonicalRaceId: "r1", stakeYen: 100, payoutYen: 500 };
  assert.throws(() => sensitivity([one], "CANONICAL_RACE"), TypeError);
  assert.throws(() => sensitivity([one, one], "DECISION_RECORD"), TypeError);
  assert.throws(() => sensitivity([one, { ...one, decisionId: "two" }], "CANONICAL_RACE", "missing"), TypeError);
  for (const invalid of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => sensitivity([one, { ...one, decisionId: "two", payoutYen: invalid }], "DECISION_RECORD"), TypeError);
  assert.throws(() => sensitivity(system("A"), "UNKNOWN" as EventUnit), TypeError);
});

test("no positive event removes nothing and remains unauthorized", () => {
  const rows: Ticket[] = [
    { decisionId: "a", canonicalRaceId: "r1", stakeYen: 100, payoutYen: 0 },
    { decisionId: "b", canonicalRaceId: "r2", stakeYen: 100, payoutYen: 100 },
  ];
  assert.deepEqual(sensitivity(rows, "CANONICAL_RACE"), {
    removedEvent: null, retainedRaceIds: ["r1", "r2"],
    netYen: -100n, stakeYen: 200n, scoringAuthorized: false,
  });
});
