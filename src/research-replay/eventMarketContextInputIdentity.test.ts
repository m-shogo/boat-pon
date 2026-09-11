import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-event-market-context.ts", "utf-8");

test("event market context verifies saved odds HTML identity before parsing", () => {
  const exists = source.indexOf("if (!existsSync(path)) return");
  const identity = source.indexOf("EVENT_MARKET_CONTEXT_ODDS_HTML_IDENTITY_INVALID");
  const read = source.indexOf('readFileSync(verifiedPath, "utf8")');

  assert.ok(exists >= 0);
  assert.ok(identity > exists);
  assert.ok(read > identity);
  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(source, /readFileSync\(path, "utf8"\)/);
});
