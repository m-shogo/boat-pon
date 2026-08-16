import assert from "node:assert/strict";
import test from "node:test";

import {
  buildN2TrifectaRawCapturePlan,
  buildN2TrifectaRawReviewEnvelope,
} from "./n2TrifectaRawCaptureCanary.js";

function entry() {
  const plan = buildN2TrifectaRawCapturePlan([{
    date: "2026-08-05",
    venueCode: "05",
    raceNo: 1,
    closeAt: "12:00",
  }]);
  assert.equal(plan.status, "REVIEW_BUNDLE_READY_NOT_AUTHORIZED");
  assert.equal(plan.entries.length, 1);
  return plan.entries[0]!;
}

function review(fetchedAt: string) {
  const captureEntry = entry();
  return buildN2TrifectaRawReviewEnvelope({
    entry: captureEntry,
    sourceUrl: captureEntry.sourceUrl,
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    fetchedAt,
    rawBytes: Buffer.from("<html><body>オッズ更新時間：11:49</body></html>", "utf8"),
  });
}

for (const fetchedAt of [
  "2026-02-30T02:50:00.000Z",
  "2026-08-05T24:00:00.000Z",
  "2026-08-05T02:50:00.000",
]) {
  test(`raw review rejects non-canonical fetchedAt before time ordering: ${fetchedAt}`, () => {
    const result = review(fetchedAt);
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("FETCHED_AT_INVALID"));
  });
}

test("raw review preserves valid explicit-offset fetchedAt instants", () => {
  const result = review("2026-08-05T11:50:00+09:00");
  assert.ok(!result.blockers.includes("FETCHED_AT_INVALID"));
});
