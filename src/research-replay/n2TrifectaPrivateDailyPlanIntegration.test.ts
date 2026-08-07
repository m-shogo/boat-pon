import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

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
import type { N2TrifectaPrivateFetcher } from "./n2TrifectaPrivateCaptureExecutor.js";

function authorization(): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-daily-cache-integration",
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

function completeOddsHtml(updateTime = "09:35"): string {
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

function createPrimaryDb(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare(`
      INSERT INTO official_programs(race_id, date, venue, race_no, close_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (let raceNo = 1; raceNo <= 12; raceNo += 1) {
      const closeHour = 10 + Math.floor((raceNo - 1) / 2);
      const closeMinute = raceNo % 2 === 1 ? "05" : "35";
      insert.run(
        `20260806-05-${String(raceNo).padStart(2, "0")}`,
        "2026-08-06",
        "05",
        raceNo,
        `${String(closeHour).padStart(2, "0")}:${closeMinute}:00`,
      );
    }
  } finally {
    db.close();
  }
}

test("valid private daily plan bypasses a later active primary WAL and captures exactly one checkpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-integration-"));
  try {
    const dbPath = join(root, "data", "boat.sqlite");
    createPrimaryDb(dbPath);
    const dbBefore = statSync(dbPath);
    const plan = buildN2TrifectaOddsCheckpointPlan({
      stage: "ONE_VENUE_REVIEW",
      races: Array.from({ length: 12 }, (_, index) => ({
        date: "2026-08-06",
        venueCode: "05",
        raceNo: index + 1,
        closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
      })),
    });
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-06",
      generatedAt: "2026-08-06T00:00:00.000Z",
      plans: [plan],
      source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
        primaryDbBytes: dbBefore.size,
        primaryDbModifiedMs: dbBefore.mtimeMs,
        primaryDbWalBytes: 0,
      }),
    });
    writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });

    const walPath = `${dbPath}-wal`;
    writeFileSync(walPath, "live-wal-after-plan-generation");
    const walBefore = statSync(walPath);
    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      return {
        statusCode: 200,
        contentType: "text/html; charset=UTF-8",
        headers: { "content-type": "text/html; charset=UTF-8" },
        rawBytes: Buffer.from(completeOddsHtml(), "utf8"),
        fetchedAt: "2026-08-06T00:35:30.000Z",
      };
    };

    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: dbPath,
      authorization: authorization(),
      now: "2026-08-06T00:35:30.000Z",
      fetcher,
    });

    assert.equal(report.status, "PASS");
    assert.equal(report.selectedVenueCode, "05");
    assert.equal(report.selectedRaceCount, 12);
    assert.equal(report.selectedEntry?.raceIdentity, "20260806-05-01");
    assert.equal(report.selectedEntry?.checkpointLabel, "T-30");
    assert.equal(report.executorReport?.networkRequestCount, 1);
    assert.equal(report.executorReport?.capturedCount, 1);
    assert.equal(report.primaryDbMetadataUnchanged, true);
    assert.equal(fetchCount, 1);
    assert.equal(report.databaseWriteCount, 0);
    assert.equal(report.primaryDbWriteCount, 0);
    assert.equal(report.sidecarWriteCount, 0);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);

    const dbAfter = statSync(dbPath);
    const walAfter = statSync(walPath);
    assert.equal(dbAfter.size, dbBefore.size);
    assert.equal(dbAfter.mtimeMs, dbBefore.mtimeMs);
    assert.equal(walAfter.size, walBefore.size);
    assert.equal(walAfter.mtimeMs, walBefore.mtimeMs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
