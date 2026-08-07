import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const cli = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-daily-readiness.ts"),
  "utf8",
);
const readiness = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketDailyReadiness.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/n2-private-market-daily-readiness.yml"),
  "utf8",
);

test("daily readiness is metadata-only and cannot authorize freeze or production", () => {
  assert.match(readiness, /evidenceRole:\s*"EXPLORATION_READINESS_ONLY"/u);
  assert.match(readiness, /automaticFreezeAuthorized:\s*false/u);
  assert.match(readiness, /outcomeDataRead:\s*false/u);
  assert.match(readiness, /validationDataRead:\s*false/u);
  assert.match(readiness, /holdoutDataRead:\s*false/u);
  assert.match(readiness, /rawOddsValuesRead:\s*false/u);
  assert.match(readiness, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(readiness, /lineConnectionAuthorized:\s*false/u);
  assert.match(readiness, /automatedBettingAuthorized:\s*false/u);
  assert.match(readiness, /publicPublishAuthorized:\s*false/u);
  assert.match(readiness, /productionApplyAuthorized:\s*false/u);
  assert.doesNotMatch(readiness, /decisionHistory|app_settings|notify|send-line|settlement|payout|roi/u);
});

test("daily readiness verifies day index and heartbeat but never fetches market data", () => {
  assert.match(readiness, /buildN2TrifectaPrivateMarketFeatureDayIndex/u);
  assert.match(readiness, /buildN2TrifectaPrivateHeartbeatGapDiagnostics/u);
  assert.doesNotMatch(readiness, /\bfetch\s*\(|DatabaseSync|openDb/u);
  assert.match(readiness, /networkRequestCount:\s*0/u);
  assert.match(readiness, /databaseReadCount:\s*0/u);
  assert.match(readiness, /databaseWriteCount:\s*0/u);
});

test("daily readiness CLI derives current venue from validated private daily plan when omitted", () => {
  assert.match(cli, /readN2TrifectaPrivateDailyPlanCache/u);
  assert.match(cli, /planRead\.status !== "PASS"/u);
  assert.match(cli, /venues\.length !== 1/u);
  assert.match(cli, /--write-private/u);
  assert.doesNotMatch(cli, /\bfetch\s*\(|DatabaseSync|boat\.sqlite|send-line|notify|cloudflare|wrangler/u);
});

test("scheduled daily readiness is once daily, self-hosted and local-only", () => {
  assert.match(workflow, /cron:\s*'45 14 \* \* \*'/u);
  assert.match(workflow, /runs-on:\s*\[self-hosted, macOS\]/u);
  assert.match(workflow, /BOAT_PON_DATA_ROOT:\s*\/Users\/m-shogo\/Developer\/personal\/boat-pon/u);
  assert.match(workflow, /build-n2-trifecta-private-market-daily-readiness\.ts/u);
  assert.match(workflow, /automaticFreezeAuthorized !== false/u);
  assert.match(workflow, /outcomeDataRead !== false/u);
  assert.match(workflow, /validationDataRead !== false/u);
  assert.match(workflow, /holdoutDataRead !== false/u);
  assert.match(workflow, /networkRequestCount !== 0/u);
  assert.match(workflow, /databaseReadCount !== 0/u);
  assert.match(workflow, /databaseWriteCount !== 0/u);
  assert.doesNotMatch(workflow, /boatrace|boat-race|kyotei|curl\s|wget\s|wrangler|send-line|notify/u);
});
