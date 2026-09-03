import assert from "node:assert/strict";
import {
  chmodSync,
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
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";
import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-reservation-authority-test",
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

test("forged reservation content cannot suppress a due checkpoint or consume request budget authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-local-reservation-authority-"));
  try {
    const plan = buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW",
      races: Array.from({ length: 12 }, (_, index) => ({
        date: "2026-08-07",
        venueCode: "10",
        raceNo: index + 1,
        closeAt: index === 0
          ? "10:05"
          : index === 1
            ? "10:30"
            : `${String(11 + Math.floor((index - 2) / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
      })),
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

    const now = "2026-08-07T01:00:30.000Z";
    const nowMs = Date.parse(now);
    const due = plan.entries
      .filter((entry) => {
        const targetMs = Date.parse(entry.targetCaptureAt);
        return targetMs <= nowMs && nowMs <= targetMs + 120_000;
      })
      .sort((left, right) => left.targetCaptureAt.localeCompare(right.targetCaptureAt));
    const earliest = due[0];
    assert.ok(earliest);

    const auth = authorization();
    const reservationKey = canonicalHash({
      authorizationId: auth.authorizationId,
      raceIdentity: earliest.raceIdentity,
      checkpointLabel: earliest.checkpointLabel,
      targetCaptureAt: earliest.targetCaptureAt,
    });
    const reservationPath = join(
      root,
      "data/private/trifecta-capture/reservations/2026-08-07",
      `${reservationKey}.json`,
    );
    mkdirSync(dirname(reservationPath), { recursive: true, mode: 0o700 });
    writeFileSync(reservationPath, "{}\n", "utf8");
    chmodSync(reservationPath, 0o600);

    let fetchCount = 0;
    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: join(root, "not-used.sqlite"),
      authorization: auth,
      now,
      fetcher: async () => {
        fetchCount += 1;
        throw new Error("network must not be reached for invalid reservation authority");
      },
    });

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("SERVICE_RESERVATION_AUTHORITY_INVALID"));
    assert.equal(report.executorReport, null);
    assert.equal(report.reservationRelativePath, null);
    assert.equal(fetchCount, 0);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});