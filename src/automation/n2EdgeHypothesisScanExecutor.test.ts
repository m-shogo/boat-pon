import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import type { N2EdgeDiscoverySourceRead } from "../research-replay/n2EdgeDiscoverySource";
import type { N2EdgeSelectedProgramFeaturesRead } from "../research-replay/n2EdgeSelectedProgramFeatures";
import type { ProgramFeatureSnapshot } from "../domain/programFeatures";
import { createN2EdgeHypothesisScanExecutor } from "./n2EdgeHypothesisScanExecutor";
import type { ExecutorContext } from "./taskExecutors";

const selections = enumerateBetSelections("trifecta");

function dateWithRace(base: string, offsetDays: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function sourceRead(venueCount = 17, candidatesPerVenue = 13): N2EdgeDiscoverySourceRead {
  const historicalOutcomes: Array<{ canonicalRaceKey: string; winningSelection: string }> = [];
  const candidates: N2EdgeDiscoverySourceRead["candidates"] = [];
  for (let venueIndex = 0; venueIndex < venueCount; venueIndex += 1) {
    const venueCode = String(venueIndex + 1).padStart(2, "0");
    const warmupCount = venueCount === 1 ? 120 : 36;
    for (let warm = 0; warm < warmupCount; warm += 1) {
      const date = dateWithRace("2003-12-01", Math.floor(warm / 12));
      const raceNo = (warm % 12) + 1;
      historicalOutcomes.push({
        canonicalRaceKey: `${date}:${venueCode}:R${raceNo}`,
        winningSelection: selections[(warm + venueIndex) % selections.length],
      });
    }
    for (let index = 0; index < candidatesPerVenue; index += 1) {
      const date = dateWithRace("2004-01-10", Math.floor(index / 12));
      const raceNo = (index % 12) + 1;
      const canonicalRaceKey = `${date}:${venueCode}:R${raceNo}`;
      historicalOutcomes.push({
        canonicalRaceKey,
        winningSelection: selections[(index + venueIndex * 7) % selections.length],
      });
      candidates.push({
        canonicalRaceKey,
        primaryRaceId: `${date.replaceAll("-", "")}-${venueCode}-${String(raceNo).padStart(2, "0")}`,
        primaryIdentityEncoding: "venue_code",
        decisionCutoff: `${date}T05:00:00.000Z`,
        sourceObservedAt: `${date}T00:00:00.000Z`,
      });
    }
  }
  historicalOutcomes.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  candidates.sort((a, b) => a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
  return {
    readerVersion: "n2-edge-discovery-source-v1",
    status: "PASS",
    blockers: [],
    historyFromDateInclusive: "2003-07-05",
    discoveryFromDateInclusive: "2004-01-01",
    discoveryToDateInclusive: "2021-12-31",
    historicalOutcomeCount: historicalOutcomes.length,
    officialProgramMetadataCount: candidates.length,
    eligibleProgramMetadataCount: candidates.length,
    candidateRaceCount: candidates.length,
    missingOfficialProgramCount: 0,
    missingCleanWinnerCount: 0,
    excludedProgramCount: 0,
    excludedProgramReasonCounts: {},
    historicalOutcomes,
    candidates,
    reads: {
      primaryDatabaseReadCount: 1,
      sidecarDatabaseReadCount: 1,
      rawJsonReadCount: 0,
      primaryDatabaseWriteCount: 0,
      sidecarDatabaseWriteCount: 0,
      networkRequestCount: 0,
    },
    authority: {
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    },
    outputDigest: canonicalHash({ historicalOutcomes, candidates }),
  };
}

function safeProgram(): ProgramFeatureSnapshot {
  return {
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      className: index === 0 ? "A1" : index < 3 ? "A2" : "B1",
      nationalWinRate: 4.8 + index * 0.3,
      nationalTop2Rate: 32 + index * 4,
      localWinRate: 4.5 + index * 0.25,
      localTop2Rate: 30 + index * 4,
      motorTop2Rate: 31 + index * 3,
      boatTop2Rate: 29 + index * 3,
      venueMotorTop2Rate: null,
      venueBoatTop2Rate: null,
      courseAvgSt: null,
      courseTop3Rate: null,
      flyingCount: null,
      lateStartCount: null,
      exhibitionStResidual: null,
    })),
  };
}

function selectedRead(selected: N2EdgeDiscoverySourceRead["candidates"]): N2EdgeSelectedProgramFeaturesRead {
  const programs = selected.map((candidate) => ({
    canonicalRaceKey: candidate.canonicalRaceKey,
    primaryRaceId: candidate.primaryRaceId,
    decisionCutoff: candidate.decisionCutoff,
    sourceObservedAt: candidate.sourceObservedAt,
    rawDocumentDigest: canonicalHash(candidate.primaryRaceId),
    programFeatures: safeProgram(),
  }));
  return {
    readerVersion: "n2-edge-selected-program-features-v1",
    status: "PASS",
    blockers: [],
    requestedRaceCount: selected.length,
    matchedProgramCount: selected.length,
    parsedProgramCount: selected.length,
    safeProgramCount: selected.length,
    rawJsonReadCount: selected.length,
    identityFieldCountPublished: 0,
    liveOnlyFeatureValueCount: 0,
    venueSpecificUnprovenFeatureValueCount: 0,
    primaryDatabaseReadCount: 1,
    primaryDatabaseWriteCount: 0,
    networkRequestCount: 0,
    programs,
    authority: {
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    },
    outputDigest: canonicalHash(programs),
  };
}

function context(root: string, taskStatuses: Record<string, string> = { "TASK-N2-030": "PASS" }): ExecutorContext {
  return {
    repoRoot: root,
    runId: "run-edge-scan-test",
    requestId: "REQ-edge-scan-test",
    taskId: "TASK-N2-040",
    sidecarPath: join(root, "data/research-replay.sqlite"),
    historyDir: join(root, "reports/automation/history"),
    reportsDir: join(root, "reports/n2"),
    dryRun: false,
    taskStatuses,
  };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-edge-executor-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("executor scans a deterministic 204-race cohort and persists aggregate-only evidence", () => {
  withRoot((root) => {
    const source = sourceRead();
    let selectedCalls = 0;
    const executor = createN2EdgeHypothesisScanExecutor(
      () => source,
      (_input) => {
        selectedCalls += 1;
        return selectedRead(_input.selectedCandidates);
      },
    );
    const result = executor(context(root));
    assert.equal(result.result, "PASS");
    assert.equal(selectedCalls, 1);
    assert.deepEqual(result.outputs, ["reports/n2/n2-edge-hypothesis-scan.json"]);
    const reportPath = join(root, "reports/n2/n2-edge-hypothesis-scan.json");
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    assert.equal(report.status, "PASS");
    const cohort = report.cohort as Record<string, unknown>;
    assert.equal(cohort.selectedRaceCount, 204);
    assert.equal(cohort.selectedSelectionRowCount, 204 * 120);
    assert.equal(cohort.labelValueUsedForSampling, false);
    const materialization = report.featureMaterialization as Record<string, unknown>;
    assert.equal(materialization.adaptedSelectionCount, 204 * 120);
    assert.equal(materialization.timedFeatureAdaptersEnabled, false);
    assert.equal(materialization.venueSpecificUnprovenFeaturesEnabled, false);
    const scan = report.scan as Record<string, unknown>;
    assert.equal(scan.status, "PASS");
    assert.equal(scan.inputObservationCount, 204 * 120);
    assert.ok(Number(scan.testedHypothesisCount) > 0);
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /2004-01-\d{2}:\d{2}:R\d+/u);
    assert.doesNotMatch(serialized, /"(?:winningSelection|rawJson|registrationNo|racerName|primaryRaceId)"\s*:/u);
    assert.doesNotMatch(serialized, /"(?:probabilityBySelection|historicalOutcomes|candidates|programs)"\s*:/u);
    assert.match(String(report.outputDigest), /^[0-9a-f]{64}$/u);
  });
});

test("dependency is checked before source or raw-program reads", () => {
  withRoot((root) => {
    let sourceCalls = 0;
    let selectedCalls = 0;
    const executor = createN2EdgeHypothesisScanExecutor(
      () => { sourceCalls += 1; return sourceRead(); },
      (input) => { selectedCalls += 1; return selectedRead(input.selectedCandidates); },
    );
    const result = executor(context(root, { "TASK-N2-030": "BLOCKED" }));
    assert.equal(result.result, "BLOCKED");
    assert.equal(sourceCalls, 0);
    assert.equal(selectedCalls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("DEPENDENCY_NOT_SATISFIED:TASK-N2-030")));
  });
});

test("cohort below 200 races blocks before any selected raw JSON read", () => {
  withRoot((root) => {
    const small = sourceRead(1, 13);
    let selectedCalls = 0;
    const executor = createN2EdgeHypothesisScanExecutor(
      () => small,
      (input) => { selectedCalls += 1; return selectedRead(input.selectedCandidates); },
    );
    const result = executor(context(root));
    assert.equal(result.result, "BLOCKED");
    assert.equal(selectedCalls, 0);
    assert.ok(result.blocks.some((blocker) => blocker.includes("EDGE_COHORT_TOO_SMALL:12/200")));
    assert.equal(existsSync(join(root, "reports/n2/n2-edge-hypothesis-scan.json")), false);
  });
});
