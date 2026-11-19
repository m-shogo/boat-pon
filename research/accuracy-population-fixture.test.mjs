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
  const key = JSON.stringify([r.race, r.betType ?? 'trifecta', r.selection]);
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
