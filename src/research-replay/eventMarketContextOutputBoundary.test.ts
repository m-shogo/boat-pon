import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync("scripts/analyze-event-market-context.ts", "utf8");

test("event market context publishes JSON and Markdown through verified exclusive temp files", () => {
  assert.match(source, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(source, /fsyncSync\(fd\)/u);
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(tempPath, errorCode\)/u);
  assert.match(source, /renameSync\(verifiedTempPath, path\)/u);
  assert.match(source, /EVENT_MARKET_CONTEXT_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(source, /EVENT_MARKET_CONTEXT_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/event-market-context-screen\.json"/u);
  assert.doesNotMatch(source, /writeFileSync\("reports\/event-market-context-screen\.md"/u);
});
