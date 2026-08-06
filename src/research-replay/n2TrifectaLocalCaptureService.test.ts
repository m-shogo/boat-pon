import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
  auditN2TrifectaLocalCaptureAuthorization,
  buildN2TrifectaEphemeralApproval,
  buildN2TrifectaSingleEntryPlan,
  runN2TrifectaLocalCaptureTick,
  type N2TrifectaLocalCaptureAuthorization,
} from "./n2TrifectaLocalCaptureService.js";
import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import type { N2TrifectaPrivateFetcher } from "./n2TrifectaPrivateCaptureExecutor.js";

function authorization(overrides: Partial<N2TrifectaLocalCaptureAuthorization> = {}): N2TrifectaLocalCaptureAuthorization {
  return {
    authorizationVersion: N2_TRIFECTA_LOCAL_CAPTURE_AUTHORIZATION_VERSION,
    authorizationId: "AUTH-N2-TRI-LOCAL-private-research-0001",
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
    ...overrides,
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
      cells.push(
        `<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${odds.toFixed(1)}</td>`,
      );
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");

  return `<!doctype html><html><body><p>オッズ更新時間：${updateTime}</p><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function createPrograms(path: string, venue = "05", raceCount = 1): void {
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
    for (let raceNo = 1; raceNo <= raceCount; raceNo += 1) {
      insert.run(
        `20260806-${venue}-${String(raceNo).padStart(2, "0")}`,
        "2026-08-06",
        venue,
        raceNo,
        raceNo === 1 ? "10:05:00" : "10:35:00",
      );
    }
  } finally {
    db.close();
  }
}

function withTempRoot(run: (root: string, dbPath: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-local-trifecta-service-"));
  const dbPath = join(root, "data", "boat.sqlite");
  createPrograms(dbPath);
  return run(root, dbPath).finally(() => rmSync(root, { recursive: true, force: true }));
}

test("long-lived private authorization remains strict and cannot authorize production surfaces", () => {
  const pass = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization(),
    now: "2026-08-06T00:35:00.000Z",
  });
  assert.deepEqual(pass, {
    status: "PASS",
    blockers: [],
    localServiceAuthorized: true,
    networkExecutionAuthorized: true,
    databaseWriteAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
  });

  const expired = auditN2TrifectaLocalCaptureAuthorization({
    authorization: authorization({ expiresAt: "2026-08-05T00:00:00.000Z" }),
    now: "2026-08-06T00:35:00.000Z",
  });
  assert.equal(expired.status, "BLOCKED");
  assert.ok(expired.blockers.includes("AUTHORIZATION_EXPIRED"));
  assert.equal(expired.networkExecutionAuthorized, false);

  const widened = auditN2TrifectaLocalCaptureAuthorization({
    authorization: {
      ...authorization(),
      publicRedistributionAuthorized: true,
    } as unknown as N2TrifectaLocalCaptureAuthorization,
    now: "2026-08-06T00:35:00.000Z",
  });
  assert.equal(widened.status, "BLOCKED");
  assert.ok(widened.blockers.includes("PUBLIC_REDISTRIBUTION_MUST_BE_FALSE"));
});

test("one checkpoint is rebound to a one-request digest and short-lived approval", () => {
  const sourcePlan = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [{ date: "2026-08-06", venueCode: "05", raceNo: 1, closeAt: "10:05" }],
  });
  const entry = sourcePlan.entries.find((candidate) => candidate.checkpointLabel === "T-30");
  assert.ok(entry);
  const plan = buildN2TrifectaSingleEntryPlan({ sourcePlan, entry });
  assert.equal(plan.status, "READY_FOR_PRIVATE_REVIEW");
  assert.equal(plan.requestBudget, 1);
  assert.equal(plan.entries.length, 1);
  assert.notEqual(plan.manifestDigest, sourcePlan.manifestDigest);

  const approval = buildN2TrifectaEphemeralApproval({
    authorization: authorization(),
    plan,
    entry,
  });
  assert.equal(approval.manifestDigest, plan.manifestDigest);
  assert.equal(approval.maxRequests, 1);
  assert.equal(approval.databaseWriteAuthorized, false);
  assert.equal(approval.currentBuyConnectionAuthorized, false);
  assert.equal(approval.lineConnectionAuthorized, false);
  assert.equal(approval.expiresAt, "2026-08-06T00:37:30.000Z");
});

test("a due tick captures exactly one full 120-selection snapshot and leaves DB metadata unchanged", async () => {
  await withTempRoot(async (root, dbPath) => {
    const before = statSync(dbPath);
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
    assert.equal(report.selectedRaceCount, 1);
    assert.equal(report.dueEntryCount, 1);
    assert.equal(report.selectedEntry?.checkpointLabel, "T-30");
    assert.equal(report.dailyReservationCountBefore, 0);
    assert.equal(report.dailyReservationCountAfter, 1);
    assert.equal(report.executorReport?.networkRequestCount, 1);
    assert.equal(report.executorReport?.capturedCount, 1);
    assert.equal(report.executorReport?.databaseWriteCount, 0);
    assert.equal(report.primaryDbMetadataUnchanged, true);
    assert.equal(report.currentBuyChanged, false);
    assert.equal(report.lineChanged, false);
    assert.equal(report.publicPublished, false);
    assert.equal(report.automatedBettingChanged, false);
    assert.equal(fetchCount, 1);
    assert.ok(report.selectionRelativePath);
    assert.ok(report.reservationRelativePath);
    assert.ok(report.reportRelativePath);
    assert.equal(existsSync(join(root, report.selectionRelativePath)), true);
    assert.equal(existsSync(join(root, report.reservationRelativePath)), true);
    assert.equal(existsSync(join(root, report.reportRelativePath)), true);
    assert.equal(
      existsSync(join(root, "data/raw/research/trifecta-market/2026-08-06/05/01/T-30/accepted.json")),
      true,
    );
    const after = statSync(dbPath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("reservation is written before execution and prevents a second network request", async () => {
  await withTempRoot(async (root, dbPath) => {
    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      return {
        statusCode: 200,
        contentType: "text/html",
        headers: {},
        rawBytes: Buffer.from(completeOddsHtml(), "utf8"),
        fetchedAt: "2026-08-06T00:35:30.000Z",
      };
    };
    const first = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: dbPath,
      authorization: authorization(),
      now: "2026-08-06T00:35:30.000Z",
      fetcher,
    });
    assert.equal(first.status, "PASS");

    const second = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: dbPath,
      authorization: authorization(),
      now: "2026-08-06T00:35:45.000Z",
      fetcher: async () => {
        throw new Error("must not fetch twice");
      },
    });
    assert.equal(second.status, "NO_CHANGE");
    assert.equal(second.executorReport, null);
    assert.equal(second.dailyReservationCountBefore, 1);
    assert.equal(second.dailyReservationCountAfter, 1);
    assert.equal(fetchCount, 1);
    const reservations = readdirSync(join(root, "data/private/trifecta-capture/reservations/2026-08-06"));
    assert.equal(reservations.length, 1);
  });
});

test("active primary WAL blocks before network and remains byte-for-byte untouched", async () => {
  await withTempRoot(async (root, dbPath) => {
    const walPath = `${dbPath}-wal`;
    writeFileSync(walPath, "active-wal");
    const before = statSync(walPath);
    let fetchCount = 0;
    const report = await runN2TrifectaLocalCaptureTick({
      dataRoot: root,
      primaryDbPath: dbPath,
      authorization: authorization(),
      now: "2026-08-06T00:35:30.000Z",
      fetcher: async () => {
        fetchCount += 1;
        throw new Error("network must remain blocked");
      },
    });
    const after = statSync(walPath);
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("PRIMARY_DB_ACTIVE_WAL"));
    assert.equal(report.executorReport, null);
    assert.equal(fetchCount, 0);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});
