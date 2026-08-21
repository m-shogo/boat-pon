import assert from "node:assert/strict";
import test from "node:test";

import { parseSanitizedOfficialWebResult } from "./settlementWebParser";

const prefix = '<div data-source-schema="sanitized-official-web-result-v1" data-canonical-race-key="2026-08-01:01:R1"></div>';

test("sanitized settlement parser rejects payout values outside safe integer range", () => {
  const parsed = parseSanitizedOfficialWebResult(
    `${prefix}<div data-bet-type="win" data-selection="1" data-payout-yen="9007199254740992"></div>`,
  );
  assert.equal(parsed.status, "error");
  assert.equal(parsed.lines.length, 0);
  assert.ok(parsed.diagnosticCodes.includes("INVALID_WEB_PAYOUT"));
});

test("sanitized settlement parser does not preserve unsafe popularity values", () => {
  const parsed = parseSanitizedOfficialWebResult(
    `${prefix}<div data-bet-type="win" data-selection="1" data-payout-yen="100" data-popularity="9007199254740992"></div>`,
  );
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0]?.payoutYen, 100);
  assert.equal(parsed.lines[0]?.popularity, null);
});
