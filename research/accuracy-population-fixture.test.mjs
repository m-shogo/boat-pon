import assert from 'node:assert/strict';
import { test } from 'node:test';

// Research-only synthetic fixture. No database, captures, or production imports.
// This models the population-selection difference; it does not test settlement.
const rows = [
  { race: 'R1', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, p: .2, hit: 0 },
  { race: 'R1', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 2, p: .3, hit: 0 },
  { race: 'R1', selection: '1-3-2', model: 'v3', runKind: 'paper-live', time: 3, p: .4, hit: 1 },
  { race: 'R2', selection: '2-1-3', model: 'legacy', runKind: 'paper-live', time: 4, p: .5, hit: 0 },
  { race: 'R3', selection: '3-2-1', model: 'v3', runKind: 'paper-live', time: 5, p: .6, hit: 1 },
];
const latestV3 = (xs) => [...xs.filter(r => r.model === 'v3' && r.runKind === 'paper-live').reduce((map, r) => {
  const key = JSON.stringify([r.race, r.betType ?? null, r.selection]);
  const old = map.get(key);
  if (!old || r.time > old.time || (r.time === old.time && (r.id ?? -1) > (old.id ?? -1))) map.set(key, r);
  return map;
}, new Map()).values()];
const distinctRaces = xs => new Set(xs.map(r => r.race)).size;
const brier = xs => xs.reduce((sum, r) => sum + (r.p - r.hit) ** 2, 0) / xs.length;
const logloss = xs => -xs.reduce((sum, r) => sum + r.hit * Math.log(r.p) + (1 - r.hit) * Math.log(1 - r.p), 0) / xs.length;

test('model-version filtering and latest-decision dedup differ from race uniqueness', () => {
  const selected = latestV3(rows);
  assert.equal(rows.length, 5);
  assert.equal(distinctRaces(rows), 3);
  assert.equal(selected.length, 3);
  assert.equal(distinctRaces(selected), 2);
  assert.deepEqual(selected.filter(r => r.race === 'R1').map(r => r.selection).sort(), ['1-2-3', '1-3-2']);
  assert.equal(selected.find(r => r.selection === '1-2-3').time, 2);
  assert.equal(selected.some(r => r.model === 'legacy'), false);
});

test('population selection changes synthetic metrics; no claim of real improvement', () => {
  const selected = latestV3(rows);
  assert.notEqual(brier(rows), brier(selected));
  assert.notEqual(logloss(rows), logloss(selected));
  assert.ok([brier(rows), brier(selected), logloss(rows), logloss(selected)].every(Number.isFinite));
});

test('equal timestamps need a stable id tie-breaker, as in canonical ROW_NUMBER ordering', () => {
  const sameTimestamp = [
    { race: 'R4', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 6, id: 10, p: .2, hit: 0 },
    { race: 'R4', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 6, id: 11, p: .7, hit: 0 },
  ];
  // Same canonical tie-break regardless of input row order.
  const selected = latestV3(sameTimestamp);
  assert.equal(latestV3([...sameTimestamp].reverse())[0].id, 11);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 11);
  assert.equal(selected[0].p, .7);
});

test('dedup partitions by bet type as well as race and selection', () => {
  const sameRaceAndSelection = [
    { race: 'R5', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, id: 20, p: .2, hit: 0 },
    { race: 'R5', betType: 'trio', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 2, id: 21, p: .3, hit: 1 },
    { race: 'R5', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 3, id: 22, p: .4, hit: 0 },
  ];
  const selected = latestV3(sameRaceAndSelection);
  assert.equal(selected.length, 2);
  assert.equal(distinctRaces(selected), 1);
  assert.deepEqual(selected.map(r => [r.betType, r.id]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['trifecta', 22],
    ['trio', 21],
  ]);
  assert.deepEqual(latestV3([...sameRaceAndSelection].reverse()).map(r => r.id).sort(), [21, 22]);
});

test('model filtering precedes dedup even when legacy decision is newer', () => {
  const mixed = [
    { race: 'R6', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, id: 30, p: .2, hit: 0 },
    { race: 'R6', betType: 'trifecta', selection: '1-2-3', model: 'legacy', runKind: 'paper-live', time: 9, id: 31, p: .9, hit: 1 },
    { race: 'R7', betType: 'trifecta', selection: '2-1-3', model: 'legacy', runKind: 'paper-live', time: 10, id: 32, p: .7, hit: 0 },
  ];
  const selected = latestV3(mixed);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 30);
  assert.deepEqual(latestV3([...mixed].reverse()).map(r => r.id), [30]);
});

test('paper-live population excludes replay rows before latest-decision selection', () => {
  const mixedRuns = [
    { race: 'R8', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, id: 40, p: .2, hit: 0 },
    { race: 'R8', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'replay', time: 9, id: 41, p: .9, hit: 1 },
    { race: 'R9', betType: 'trifecta', selection: '2-1-3', model: 'v3', runKind: 'replay', time: 10, id: 42, p: .7, hit: 0 },
  ];
  assert.deepEqual(latestV3(mixedRuns).map(r => r.id), [40]);
  assert.deepEqual(latestV3([...mixedRuns].reverse()).map(r => r.id), [40]);
});

test('missing run_kind is excluded, matching SQL equality rather than a paper-live default', () => {
  const mixed = [
    { race: 'R10', betType: 'trifecta', selection: '1-2-3', model: 'v3', time: 10, id: 50, p: .8, hit: 1 },
    { race: 'R10', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: null, time: 11, id: 51, p: .9, hit: 1 },
    { race: 'R10', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, id: 52, p: .2, hit: 0 },
  ];
  assert.deepEqual(latestV3(mixed).map(r => r.id), [52]);
  assert.deepEqual(latestV3([...mixed].reverse()).map(r => r.id), [52]);
});

test('global report range dedup precedes individual window assignment, with inclusive endpoints', () => {
  const dated = [
    { race: 'R11', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-11-01', time: 1, id: 60, p: .2, hit: 0 },
    { race: 'R11', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-11-03', time: 9, id: 61, p: .8, hit: 1 },
    { race: 'R12', betType: 'trifecta', selection: '2-1-3', model: 'v3', runKind: 'paper-live', date: '2026-11-02', time: 2, id: 62, p: .3, hit: 0 },
    { race: 'R13', betType: 'trifecta', selection: '3-1-2', model: 'v3', runKind: 'paper-live', date: '2026-10-31', time: 3, id: 63, p: .4, hit: 0 },
  ];
  // Canonical SQL deduplicates within the overall report range (FROM..TO),
  // then measure() assigns selected decisions to individual windows.
  const globalRange = xs => latestV3(xs.filter(r => r.date >= '2026-11-01' && r.date <= '2026-11-03'));
  const windowRows = xs => globalRange(xs).filter(r => r.date >= '2026-11-01' && r.date <= '2026-11-02');
  assert.deepEqual(globalRange(dated).map(r => r.id).sort((a, b) => a - b), [61, 62]);
  assert.deepEqual(windowRows(dated).map(r => r.id), [62]);
  assert.deepEqual(windowRows([...dated].reverse()).map(r => r.id), [62]);
});


test('NULL bet type is a distinct SQL partition, not silently trifecta', () => {
  const mixed = [
    { race: 'R14', betType: null, selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 2, id: 70, p: .2, hit: 0 },
    { race: 'R14', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 1, id: 71, p: .3, hit: 1 },
    { race: 'R14', selection: '1-2-3', model: 'v3', runKind: 'paper-live', time: 3, id: 72, p: .4, hit: 0 },
  ];
  const selected = latestV3(mixed);
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map(r => r.id).sort((a, b) => a - b), [71, 72]);
  assert.deepEqual(latestV3([...mixed].reverse()).map(r => r.id).sort((a, b) => a - b), [71, 72]);
});

test('global report upper bound excludes newer out-of-range decisions before dedup', () => {
  const dated = [
    { race: 'R15', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-11-03', time: 1, id: 80, p: .2, hit: 0 },
    { race: 'R15', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-11-04', time: 9, id: 81, p: .9, hit: 1 },
    { race: 'R16', betType: 'trifecta', selection: '2-1-3', model: 'v3', runKind: 'paper-live', date: '2026-11-01', time: 2, id: 82, p: .3, hit: 0 },
  ];
  const report = xs => latestV3(xs.filter(r => r.date >= '2026-11-01' && r.date <= '2026-11-03'));
  assert.deepEqual(report(dated).map(r => r.id).sort((a, b) => a - b), [80, 82]);
  assert.deepEqual(report([...dated].reverse()).map(r => r.id).sort((a, b) => a - b), [80, 82]);
  assert.deepEqual(latestV3(dated).map(r => r.id).sort((a, b) => a - b), [81, 82]);
});

test('global report lower bound excludes older out-of-range decisions before dedup', () => {
  const dated = [
    { race: 'R17', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-10-31', time: 9, id: 90, p: .9, hit: 1 },
    { race: 'R17', betType: 'trifecta', selection: '1-2-3', model: 'v3', runKind: 'paper-live', date: '2026-11-01', time: 1, id: 91, p: .2, hit: 0 },
    { race: 'R18', betType: 'trifecta', selection: '2-1-3', model: 'v3', runKind: 'paper-live', date: '2026-11-03', time: 2, id: 92, p: .3, hit: 0 },
  ];
  const report = xs => latestV3(xs.filter(r => r.date >= '2026-11-01' && r.date <= '2026-11-03'));
  assert.deepEqual(report(dated).map(r => r.id).sort((a, b) => a - b), [91, 92]);
  assert.deepEqual(report([...dated].reverse()).map(r => r.id).sort((a, b) => a - b), [91, 92]);
  assert.deepEqual(latestV3(dated).map(r => r.id).sort((a, b) => a - b), [90, 92]);
});

test('legacy returned flag can exclude a completed trifecta with unrelated special payout', () => {
  // Synthetic diagnostic only: models the existing isSettled predicate, not a proposed replacement.
  // Canonical knowledge-base warns that race_results.returned can be set by another bet type.
  const ordinary = { trifecta: '1-2-3', payout: 1200, returned: 0 };
  const unrelatedSpecialPayout = { ...ordinary, returned: 1 };
  const legacyEligible = r => r.trifecta != null && r.trifecta !== '' && !r.returned && r.payout != null;
  assert.equal(legacyEligible(ordinary), true);
  assert.equal(legacyEligible(unrelatedSpecialPayout), false);
  assert.equal(ordinary.trifecta, unrelatedSpecialPayout.trifecta);
  assert.equal(ordinary.payout, unrelatedSpecialPayout.payout);
  // This establishes a potential population mismatch only; official outcome semantics
  // and real-world affected counts remain unverified.
});


test('legacy accuracy eligibility requires a nonempty official trifecta and non-NULL payout', () => {
  // Mirrors the current report-growth isSettled predicate; no proposed settlement rule.
  const eligible = r => r.trifecta != null && r.trifecta !== '' && !r.returned && r.payout != null;
  const base = { trifecta: '1-2-3', payout: 1200, returned: 0 };
  assert.equal(eligible(base), true);
  assert.equal(eligible({ ...base, trifecta: null }), false);
  assert.equal(eligible({ ...base, trifecta: '' }), false);
  assert.equal(eligible({ ...base, payout: null }), false);
  assert.equal(eligible({ ...base, payout: 0 }), true);
  assert.equal(eligible({ ...base, returned: null }), true);
  // Zero payout and NULL returned reflect JavaScript predicate semantics only;
  // they are not evidence of valid official outcomes or actual database rows.
});
