import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildN2MarketBaselineReadinessReport,
} from "../src/research-replay/n2MarketBaselineReadiness";
import {
  readN2MarketBaselineReadiness,
} from "../src/research-replay/n2MarketBaselineReadinessReader";

type AutomationPolicy = {
  dataRoot?: unknown;
};

const repoRoot = resolve(process.cwd());
const policy = JSON.parse(
  readFileSync(resolve(repoRoot, "config/research-automation-policy.json"), "utf8"),
) as AutomationPolicy;
const configuredDataRoot = process.env.BOAT_PON_DATA_ROOT?.trim()
  || (typeof policy.dataRoot === "string" ? policy.dataRoot.trim() : "")
  || repoRoot;
const dataRoot = resolve(configuredDataRoot);
const sidecarDbPath = resolve(
  process.env.BOAT_PON_RESEARCH_REPLAY_DB?.trim()
    || resolve(dataRoot, "data/research-replay.sqlite"),
);

const read = readN2MarketBaselineReadiness({ dataRoot, sidecarDbPath });
const report = buildN2MarketBaselineReadinessReport({
  acceptedT5RaceKeys: read.acceptedT5RaceKeys,
  settledRaceKeys: read.settledRaceKeys,
  integrityBlockedRaceKeys: read.integrityBlockedRaceKeys,
  sourceBlockers: read.sourceBlockers,
});

const sanitized = {
  summaryVersion: "n2-market-baseline-readiness-summary-v1",
  reportVersion: report.reportVersion,
  readerVersion: read.readerVersion,
  status: report.status,
  readinessPurpose: "execution_activation_gate_not_statistical_sufficiency",
  minimumSettledRaceCount: report.minimumSettledRaceCount,
  acceptedT5RaceCount: report.acceptedT5RaceCount,
  settledAcceptedT5RaceCount: report.settledAcceptedT5RaceCount,
  unsettledAcceptedT5RaceCount: report.unsettledAcceptedT5RaceCount,
  distinctAcceptedDateCount: report.distinctAcceptedDateCount,
  distinctSettledDateCount: report.distinctSettledDateCount,
  earliestAcceptedDate: report.earliestAcceptedDate,
  latestAcceptedDate: report.latestAcceptedDate,
  integrityBlockedRaceCount: report.integrityBlockedRaceCount,
  sourceBlockers: read.sourceBlockers,
  invalidAcceptedMarkerCount: read.invalidAcceptedMarkerCount,
  settlementEligibleRaceCount: read.settlementEligibleRaceCount,
  settlementIneligibleRaceCount: read.settlementIneligibleRaceCount,
  n2TaskId: report.n2TaskId,
  n2TaskReady: report.n2TaskReady,
  outputDigest: report.outputDigest,
  networkRequestCount: 0,
  databaseReadCount: read.databaseReadCount,
  databaseWriteCount: read.databaseWriteCount,
  rawOddsValuesRead: read.rawOddsValuesRead,
  rawOddsValuesPrinted: false,
  rawOddsValuesPublished: false,
  automaticPromotionAuthorized: report.automaticPromotionAuthorized,
  currentBuyConnectionAuthorized: report.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: report.lineConnectionAuthorized,
  publicPublishAuthorized: report.publicPublishAuthorized,
  automatedBettingAuthorized: report.automatedBettingAuthorized,
  productionApplyAuthorized: report.productionApplyAuthorized,
};

console.log(JSON.stringify(sanitized, null, 2));
if (report.status === "BLOCKED") process.exitCode = 3;
