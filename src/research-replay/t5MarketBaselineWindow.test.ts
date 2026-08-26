import assert from "node:assert/strict";
import test from "node:test";
import { assertT5MarketBaselineWindow } from "./t5MarketBaselineWindow";

test("t5 market baseline window accepts canonical Gregorian dates", () => {
  assert.doesNotThrow(() => assertT5MarketBaselineWindow({
    from: "2026-06-01",
    to: "2026-07-31",
    boundary: "2026-07-01",
  }));
  assert.doesNotThrow(() => assertT5MarketBaselineWindow({
    from: "2028-02-29",
    to: "2028-03-01",
    boundary: "2028-02-29",
  }));
});

test("t5 market baseline window rejects non-canonical or impossible dates", () => {
  for (const input of [
    { from: "2026-6-01", to: "2026-07-31", boundary: "2026-07-01" },
    { from: "2026-06-01", to: "2026-02-30", boundary: "2026-07-01" },
    { from: "2026-06-01", to: "2026-07-31", boundary: "not-a-date" },
  ]) {
    assert.throws(() => assertT5MarketBaselineWindow(input), /T5_MARKET_BASELINE_(FROM|TO|BOUNDARY)_INVALID/);
  }
});

test("t5 market baseline window rejects reversed ranges", () => {
  assert.throws(() => assertT5MarketBaselineWindow({
    from: "2026-08-01",
    to: "2026-07-31",
    boundary: "2026-07-01",
  }), /T5_MARKET_BASELINE_WINDOW_INVALID/);
});
