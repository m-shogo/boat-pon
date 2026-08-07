import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
  N2_TRIFECTA_LOCAL_CAPTURE_RESERVATION_VERSION,
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
  type N2TrifectaLocalCaptureReservation,
} from "./n2TrifectaLocalCaptureService.js";
import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";
import type { N2TrifectaPrivateFetcher } from "./n2TrifectaPrivateCaptureExecutor.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-reserved-due-test",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    stage: "ONE_VENUE_REVIEW",
    maxRequestsPerDay: 48,
    checkpointLabels: ["T-30", "T-20", "T-10", "T-5"],
    minInterRequestMs: 10_000,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    automatedBettingAuthorized: false,
  };
}

function completeOddsHtml(updateTime = "10:00"): string {
  const pairsByFirst = new Map<number, Array<[number, number]>>();
  for (let first = 1; first <= 6; first += 1) {
    const pairs: Array<[number, number]> = [];
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        pairs.push([second, third]);
      }
    }
    pairsByFirst.set(first, pairs);
  }
  const header = Array.from({ length: 6 }, (_, index) =>
    `<th colspan="3">${index + 1}</th>`).join("");
  const rows = Array.from({ length: 20 }, (_, rowIndex) => {
    const cells: string[] = [];
    for (let first = 1; first <= 6; first += 1) {
      const pair = pairsByFirst.get(first)?.[rowIndex];
      if (!pair) throw new Error("fixture pair missing");
      const odds = (first * 100 + pair[0] * 10 + pair[1]) / 10;
      cells.push(`<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${odds.toFixed(1)}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<!doctype html><html><body><p>オッズ更新時間：${updateTime}</p><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

test("already-reserved earliest due checkpoint does not starve the next unreserved due checkpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-reserved-due-selection-"));
  try {
    const races = Array.from({ length: 12 }, (_, index) => ({
      date: "2026-08-07",
      venueCode: "10",
      raceNo: index + 1,
      closeAt: index === 0
        ? "10:05"
        : index === 1
          ? "10:30"
          : `${String(11 + Math.floor((index - 2) / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
    }));
    const plan = buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW",
      races,
    });
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-07",
      generatedAt: "2026-08-07T00:00:00.000Z",
      plans: [plan],
      source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
        primaryDbBytes: 123_456,
        primaryDbModifiedMs: 1_786_000_000_000,
        primaryDbWalBytes: 0,
      }),
    });
    writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });

    const due = plan.entries
      .filter((entry) => entry.targetCaptureAt === "2026-08-07T01:00:00.000Z")
      .sort((left, right) => left.raceNo - right.raceNo);
    assert.equal(due.length, 2);
    assert.equal(due[0]?.raceIdentity, "20260807-10-01");
    assert.equal(due[0]?.checkpointLabel, "T-5");
    assert.equal(due[1]?.raceIdentity, "20260807-10-02");
    assert.equal(due[1]?.checkpointLabel, "T-30");

    const first = due[0]!;
    const auth = authorization();
    const reservationKey = canonicalHash({
      authorizationId: auth.authorizationId,
      raceIdentity: first.raceIdentity,
      checkpointLabel: first.checkpointLabel,
      targetCaptureAt: first.targetCaptureAt,
    });
    const reservation: N2TrifectaLocalCaptureReservation = {
      reservationVersion: N2_TRIFECTA_LOCAL_CAPTURE_RESERVATION_VERSION,
      authorizationId: auth.authorizationId,
      date: "2026-08-07",
      venueCode: "10",
      raceIdentity: first.raceIdentity,
      checkpointLabel: first.checkpointLabel,
      targetCaptureAt: first.targetCaptureAt,
      reservationKey,
      reservedAt: "2026-08-07T01:00:05.000Z",
      networkRequestCeiling: 1,
    };
    writeJson(
      root,
      `data/private/trifecta-capture/reservations/2026-08-07/${reservationKey}.json`,
      reservation,
    );

    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      return {
        statusCode: 200,
        contentType: "text/html; charset=UTF-8",
        headers: { "content-type": "text/html; charset=UTF-8" },
        rawBytes: Buffer.from(completeOddsHtml(), "utf8"),
        fetchedAt: "2026-08-07T01:00:30.000Z",
      };
    };

    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: join(root, "not-used.sqlite"),
      authorization: auth,
      now: "2026-08-07T01:00:30.000Z",
      fetcher,
    });

    assert.equal(report.status, "PASS");
    assert.equal(report.dueEntryCount, 2);
    assert.equal(report.selectedEntry?.raceIdentity, "20260807-10-02");
    assert.equal(report.selectedEntry?.checkpointLabel, "T-30");
    assert.equal(report.dailyReservationCountBefore, 1);
    assert.equal(report.dailyReservationCountAfter, 2);
    assert.equal(report.executorReport?.networkRequestCount, 1);
    assert.equal(report.executorReport?.capturedCount, 1);
    assert.equal(fetchCount, 1);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
