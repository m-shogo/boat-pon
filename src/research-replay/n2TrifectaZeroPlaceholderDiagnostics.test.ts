import assert from "node:assert/strict";
import test from "node:test";

import {
  countZeroTrifectaSelections,
  parseAllTrifectaOdds,
} from "../domain/oddsParser";
import {
  buildN2TrifectaRawCapturePlan,
  buildN2TrifectaRawReviewEnvelope,
} from "./n2TrifectaRawCaptureCanary";

function groupedHtml(zero: boolean): string {
  return `
    <html><body>
      <p>オッズ更新時間：09:54</p>
      <table>
        <thead>
          <tr><th class="is-boatColor1">1</th><th colspan="2">選手1</th></tr>
        </thead>
        <tbody>
          <tr><td rowspan="2">2</td><td>3</td><td class="oddsPoint">12.3</td></tr>
          <tr><td>4</td><td class="oddsPoint">${zero ? "0.0" : "25.6"}</td></tr>
        </tbody>
      </table>
    </body></html>
  `;
}

test("zero placeholders are counted separately and never parsed as usable odds", () => {
  const html = groupedHtml(true);
  assert.equal(countZeroTrifectaSelections(html), 1);
  const parsed = parseAllTrifectaOdds(html);
  assert.equal(parsed.size, 1);
  assert.equal(parsed.has("1-2-3"), true);
  assert.equal(parsed.has("1-2-4"), false);
});

test("positive numeric cells do not count as zero placeholders", () => {
  const html = groupedHtml(false);
  assert.equal(countZeroTrifectaSelections(html), 0);
  assert.equal(parseAllTrifectaOdds(html).size, 2);
});

test("raw review envelope exposes zero-placeholder diagnostic without relaxing fail-closed", () => {
  const plan = buildN2TrifectaRawCapturePlan([
    { date: "2026-08-06", venueCode: "05", raceNo: 1, closeAt: "10:05" },
  ]);
  const entry = plan.entries[0];
  assert.ok(entry);
  const html = groupedHtml(true);
  const envelope = buildN2TrifectaRawReviewEnvelope({
    entry,
    sourceUrl: entry.sourceUrl,
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    fetchedAt: entry.targetCaptureAt,
    rawBytes: Buffer.from(html, "utf8"),
  });
  assert.equal(envelope.status, "BLOCKED");
  assert.equal(envelope.zeroOddsPlaceholderCount, 1);
  assert.ok(envelope.blockers.includes("ZERO_ODDS_PLACEHOLDERS_PRESENT"));
  assert.ok(envelope.blockers.includes("PARSED_SELECTION_COUNT_NOT_120"));
  assert.equal(envelope.parsedSelectionCount, 1);
  assert.equal(envelope.currentBuyConnectionAuthorized, false);
  assert.equal(envelope.lineConnectionAuthorized, false);
  assert.equal(envelope.productionApplyExecuted, false);
});

test("zero-placeholder diagnostic blocker is absent when no zero cell exists", () => {
  const plan = buildN2TrifectaRawCapturePlan([
    { date: "2026-08-06", venueCode: "05", raceNo: 1, closeAt: "10:05" },
  ]);
  const entry = plan.entries[0];
  assert.ok(entry);
  const envelope = buildN2TrifectaRawReviewEnvelope({
    entry,
    sourceUrl: entry.sourceUrl,
    statusCode: 200,
    contentType: "text/html",
    fetchedAt: entry.targetCaptureAt,
    rawBytes: Buffer.from(groupedHtml(false), "utf8"),
  });
  assert.equal(envelope.zeroOddsPlaceholderCount, 0);
  assert.equal(envelope.blockers.includes("ZERO_ODDS_PLACEHOLDERS_PRESENT"), false);
});
