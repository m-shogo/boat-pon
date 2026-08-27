import assert from "node:assert/strict";
import test from "node:test";
import { resolveN2T5CollectorEfficiencyInputs } from "./n2T5CollectorEfficiencyInputs";

test("T-5 collector audit inputs canonicalize explicit-zone effective timestamps", () => {
  assert.deepEqual(resolveN2T5CollectorEfficiencyInputs({
    from: "2026-07-20",
    to: "2026-07-21",
    fixEffectiveAt: "2026-07-21T13:40:00+09:00",
    networkOnlyEffectiveAt: "2026-07-21T15:15:00+09:00",
  }), {
    from: "2026-07-20",
    to: "2026-07-21",
    fixEffectiveAt: "2026-07-21T04:40:00.000Z",
    networkOnlyEffectiveAt: "2026-07-21T06:15:00.000Z",
  });
});

test("T-5 collector audit inputs reject impossible or noncanonical date windows", () => {
  const base = {
    fixEffectiveAt: "2026-07-21T13:40:00+09:00",
    networkOnlyEffectiveAt: "2026-07-21T15:15:00+09:00",
  };
  assert.throws(() => resolveN2T5CollectorEfficiencyInputs({ ...base, from: "2026-02-30", to: "2026-03-01" }), /N2_T5_COLLECTOR_FROM_INVALID/u);
  assert.throws(() => resolveN2T5CollectorEfficiencyInputs({ ...base, from: "2026-7-20", to: "2026-07-21" }), /N2_T5_COLLECTOR_FROM_INVALID/u);
  assert.throws(() => resolveN2T5CollectorEfficiencyInputs({ ...base, from: "2026-07-22", to: "2026-07-21" }), /N2_T5_COLLECTOR_WINDOW_REVERSED/u);
});

test("T-5 collector audit inputs reject invalid or zone-less effective timestamps", () => {
  const base = { from: "2026-07-20", to: "2026-07-21" };
  assert.throws(() => resolveN2T5CollectorEfficiencyInputs({
    ...base,
    fixEffectiveAt: "2026-07-21T13:40:00",
    networkOnlyEffectiveAt: "2026-07-21T15:15:00+09:00",
  }), /N2_T5_COLLECTOR_FIX_EFFECTIVE_AT_INVALID/u);
  assert.throws(() => resolveN2T5CollectorEfficiencyInputs({
    ...base,
    fixEffectiveAt: "2026-07-21T13:40:00+09:00",
    networkOnlyEffectiveAt: "2026-02-30T15:15:00+09:00",
  }), /N2_T5_COLLECTOR_NETWORK_ONLY_EFFECTIVE_AT_INVALID/u);
});
