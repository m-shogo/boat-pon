import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const cli = readFileSync(
  resolve(process.cwd(), "scripts/run-n2-trifecta-private-market-feature-rollup.ts"),
  "utf8",
);
const rollup = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketFeatureRollup.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/n2-private-market-feature-rollup.yml"),
  "utf8",
);

test("private feature rollup CLI has no network or database dependency", () => {
  assert.doesNotMatch(cli, /\bfetch\s*\(/u);
  assert.doesNotMatch(cli, /DatabaseSync|openDb|boat\.sqlite|research-replay\.sqlite/u);
  assert.match(cli, /networkRequestCount:\s*report\.networkRequestCount/u);
  assert.match(cli, /databaseReadCount:\s*report\.databaseReadCount/u);
  assert.match(cli, /databaseWriteCount:\s*report\.databaseWriteCount/u);
  assert.match(cli, /rawOddsValuesPrinted:\s*report\.rawOddsValuesPrinted/u);
  assert.match(cli, /rawOddsValuesPublished:\s*report\.rawOddsValuesPublished/u);
});

test("rollup core derives scope from validated current-day private plan and never connects production surfaces", () => {
  assert.match(rollup, /readN2TrifectaPrivateDailyPlanCache/u);
  assert.match(rollup, /venueCodes\.length !== 1/u);
  assert.match(rollup, /raceNumbers\.length !== 12/u);
  assert.match(rollup, /currentBuyChanged:\s*false/u);
  assert.match(rollup, /lineChanged:\s*false/u);
  assert.match(rollup, /publicPublished:\s*false/u);
  assert.match(rollup, /automatedBettingChanged:\s*false/u);
  assert.match(rollup, /productionApplyExecuted:\s*false/u);
  assert.doesNotMatch(rollup, /selector|decisionHistory|app_settings/u);
});

test("blocked race evidence prevents day-index refresh", () => {
  const blockedSection = rollup.slice(
    rollup.indexOf("if (blockedCount > 0)"),
    rollup.indexOf("let indexWritten = false"),
  );
  assert.match(blockedSection, /status:\s*"BLOCKED"/u);
  assert.match(blockedSection, /indexWritten:\s*false/u);
  assert.match(blockedSection, /indexDigest:\s*null/u);
});

test("persistent rollup workflow is bounded-hourly, local-only and never calls official market sources", () => {
  assert.match(workflow, /cron:\s*'23 23,0-14 \* \* \*'/u);
  assert.match(workflow, /runs-on:\s*\[self-hosted, macOS\]/u);
  assert.match(workflow, /BOAT_PON_DATA_ROOT:\s*\/Users\/m-shogo\/Developer\/personal\/boat-pon/u);
  assert.match(workflow, /run-n2-trifecta-private-market-feature-rollup\.ts/u);
  assert.doesNotMatch(workflow, /boatrace|boat-race|kyotei|curl\s|wget\s|Invoke-WebRequest/u);
  assert.doesNotMatch(workflow, /--write-private-market|send-line|notify|cloudflare|wrangler/u);
});

test("scheduled workflow validates sanitized stdout and protected boundaries", () => {
  assert.match(workflow, /rawOddsValuesPrinted !== false/u);
  assert.match(workflow, /rawOddsValuesPublished !== false/u);
  assert.match(workflow, /networkRequestCount !== 0/u);
  assert.match(workflow, /databaseReadCount !== 0/u);
  assert.match(workflow, /databaseWriteCount !== 0/u);
  assert.match(workflow, /currentBuyChanged !== false/u);
  assert.match(workflow, /lineChanged !== false/u);
  assert.match(workflow, /publicPublished !== false/u);
  assert.match(workflow, /automatedBettingChanged !== false/u);
  assert.match(workflow, /productionApplyExecuted !== false/u);
});
