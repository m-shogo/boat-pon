import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMarketCoverage,
  buildBetTypeAwareOddsRows,
  expectedSelectionCount,
  oddsTimeseriesKey,
} from "./betTypeAwareOdds";

const common = {
  raceId: "20260720-住之江-06",
  betType: "exacta" as const,
  popularity: null,
  source: "official-dry-run",
  capturedAt: "2026-07-20T12:00:00.000Z",
  minutesBeforeClose: 5,
  checkpointLabel: "T-5" as const,
};

test("exactaとquinellaは同じselectionでも券種込みで別キーになる", () => {
  const exacta = oddsTimeseriesKey({ ...common, selection: "1-2" });
  const quinella = oddsTimeseriesKey({ ...common, betType: "quinella", selection: "1-2" });
  assert.notEqual(exacta, quinella);
});

test("券種付きrowをselection順に生成する", () => {
  const rows = buildBetTypeAwareOddsRows({ ...common, oddsBySelection: new Map([["2-1", 12.3], ["1-2", 10.2]]) });
  assert.deepEqual(rows.map((row) => row.selection), ["1-2", "2-1"]);
  assert.equal(rows[0]?.betType, "exacta");
});

test("exactaに3桁selectionや0倍を混入させない", () => {
  assert.throws(() => buildBetTypeAwareOddsRows({ ...common, oddsBySelection: new Map([["1-2-3", 10]]) }), /invalid exacta/);
  assert.throws(() => buildBetTypeAwareOddsRows({ ...common, oddsBySelection: new Map([["1-2", 0]]) }), /positive/);
});

test("6艇exactaは30通り完全時だけcompleteになる", () => {
  assert.equal(expectedSelectionCount("exacta", 6), 30);
  const rows = [
    { betType: "exacta" as const, selection: "1-2" },
    { betType: "exacta" as const, selection: "2-1" },
  ];
  assert.deepEqual(assertMarketCoverage(rows, { activeBoats: 6, requireComplete: false }), {
    actual: 2,
    expected: 30,
    complete: false,
  });
});
