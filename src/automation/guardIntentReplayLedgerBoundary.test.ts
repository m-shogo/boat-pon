import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("intent push guard rejects cross-ledger divergence before replay acceptance", () => {
  const source = readFileSync("scripts/guard-intent-push.ts", "utf8");
  const crossCheck = source.indexOf("assertReplayLedgersConsistent(processedIntents, processedRequests)");
  const intentReplay = source.indexOf("isIntentProcessed(processedIntents, intent.intentId)");
  const requestReplay = source.indexOf("isRequestReplay(processedRequests, requestId)");
  const canonicalBuild = source.indexOf("buildCanonicalRequest({");

  assert.ok(crossCheck >= 0, "guard must validate replay-ledger lineage");
  assert.ok(crossCheck < intentReplay, "cross-ledger validation must run before intent replay acceptance");
  assert.ok(crossCheck < requestReplay, "cross-ledger validation must run before request replay acceptance");
  assert.ok(crossCheck < canonicalBuild, "cross-ledger validation must run before canonical request generation");
  assert.match(source, /processed replay ledgers are inconsistent/);
});

test("intent push guard does not synthesize missing replay ledgers", () => {
  const source = readFileSync("scripts/guard-intent-push.ts", "utf8");
  assert.doesNotMatch(source, /return \{ intentIds: \[\] \}/);
  assert.doesNotMatch(source, /return \{ requestIds: \[\], idempotencyKeys: \{\} \}/);
});
