import assert from "node:assert/strict";
import test from "node:test";

import { parseT5MarketCoverageAuditOptions } from "./t5MarketCoverageAuditOptions";

const defaults = { from: "2026-06-01", to: "2026-08-23" };

test("T-5 market coverage audit accepts canonical dates and flags", () => {
  assert.deepEqual(
    parseT5MarketCoverageAuditOptions(["--from", "2028-02-29", "--to=2028-03-01", "--json", "--strict"], defaults),
    { from: "2028-02-29", to: "2028-03-01", json: true, strict: true },
  );
});

test("T-5 market coverage audit rejects impossible or non-canonical dates", () => {
  for (const [flag, value] of [
    ["--from", "2026-02-30"],
    ["--from", "2026-6-01"],
    ["--to", "2026-08-32"],
    ["--to", "2026-08-23T00:00:00Z"],
  ] as const) {
    assert.throws(
      () => parseT5MarketCoverageAuditOptions([flag, value], defaults),
      /T5_MARKET_COVERAGE_AUDIT_(FROM|TO)_INVALID/u,
    );
  }
});

test("T-5 market coverage audit rejects missing date values", () => {
  assert.throws(
    () => parseT5MarketCoverageAuditOptions(["--from"], defaults),
    /T5_MARKET_COVERAGE_AUDIT_FROM_MISSING/u,
  );
  assert.throws(
    () => parseT5MarketCoverageAuditOptions(["--to"], defaults),
    /T5_MARKET_COVERAGE_AUDIT_TO_MISSING/u,
  );
});

test("T-5 market coverage audit rejects reversed ranges", () => {
  assert.throws(
    () => parseT5MarketCoverageAuditOptions(["--from", "2026-08-24", "--to", "2026-08-23"], defaults),
    /T5_MARKET_COVERAGE_AUDIT_DATE_RANGE_INVALID/u,
  );
});
