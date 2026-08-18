import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketReadinessCatalog.ts"),
  "utf8",
);
const cli = readFileSync(
  resolve(process.cwd(), "scripts/build-n2-trifecta-private-market-readiness-catalog.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/n2-private-market-daily-readiness.yml"),
  "utf8",
);

test("readiness catalog remains metadata-only and cannot authorize experiment freezing", () => {
  assert.match(source, /evidenceRole:\s*"EXPLORATION_READINESS_CATALOG_ONLY"/u);
  assert.match(source, /automaticFreezeAuthorized:\s*false/u);
  assert.match(source, /outcomeDataRead:\s*false/u);
  assert.match(source, /validationDataRead:\s*false/u);
  assert.match(source, /holdoutDataRead:\s*false/u);
  assert.match(source, /rawOddsValuesRead:\s*false/u);
  assert.match(source, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(source, /lineConnectionAuthorized:\s*false/u);
  assert.match(source, /automatedBettingAuthorized:\s*false/u);
  assert.match(source, /publicPublishAuthorized:\s*false/u);
  assert.match(source, /productionApplyAuthorized:\s*false/u);
  assert.doesNotMatch(source, /decisionHistory|app_settings|settlement|ticketSelector|send-line|notify|wrangler/u);
});

test("readiness catalog scans only local private readiness artifacts", () => {
  assert.match(source, /data\/private\/trifecta-market-experiments\/readiness/u);
  assert.match(source, /READINESS_CATALOG_ARTIFACT_DIGEST_MISMATCH/u);
  assert.match(source, /\(stat\.mode & 0o777\) !== 0o600/u);
  assert.doesNotMatch(source, /\bfetch\s*\(|DatabaseSync|openDb|boat\.sqlite/u);
  assert.match(source, /networkRequestCount:\s*0/u);
  assert.match(source, /databaseReadCount:\s*0/u);
  assert.match(source, /databaseWriteCount:\s*0/u);
});

test("catalog CLI exposes only catalog metadata and protected boundary flags", () => {
  assert.match(cli, /buildN2TrifectaPrivateMarketReadinessCatalog/u);
  assert.match(cli, /writeVerifiedN2TrifectaPrivateMarketReadinessCatalog/u);
  assert.doesNotMatch(cli, /\bwriteN2TrifectaPrivateMarketReadinessCatalog\s*\(/u);
  assert.match(cli, /--write-private/u);
  assert.match(cli, /automaticFreezeAuthorized/u);
  assert.match(cli, /outcomeDataRead/u);
  assert.match(cli, /holdoutDataRead/u);
  assert.doesNotMatch(cli, /\bfetch\s*\(|DatabaseSync|send-line|notify|wrangler/u);
});

test("daily workflow updates catalog only after readiness and verifies same-day lineage", () => {
  const readinessStep = workflow.indexOf("- name: Build private readiness evidence");
  const catalogStep = workflow.indexOf("- name: Update private readiness catalog");
  assert.ok(readinessStep >= 0);
  assert.ok(catalogStep > readinessStep);
  assert.match(workflow, /build-n2-trifecta-private-market-readiness-catalog\.ts/u);
  assert.match(workflow, /current\.readinessDigest !== r\.outputDigest/u);
  assert.match(workflow, /current\.sourceDayIndexDigest !== r\.sourceDayIndexDigest/u);
  assert.match(workflow, /c\.automaticFreezeAuthorized !== false/u);
  assert.match(workflow, /c\.outcomeDataRead !== false/u);
  assert.match(workflow, /c\.validationDataRead !== false/u);
  assert.match(workflow, /c\.holdoutDataRead !== false/u);
  assert.match(workflow, /c\.networkRequestCount !== 0/u);
  assert.match(workflow, /c\.databaseReadCount !== 0/u);
  assert.match(workflow, /c\.databaseWriteCount !== 0/u);
  assert.doesNotMatch(workflow, /boatrace|boat-race|kyotei|curl\s|wget\s|send-line|notify|wrangler/u);
});