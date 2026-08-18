import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCaptureApproval,
} from "./n2TrifectaOddsCheckpointCollection.js";
import {
  executeN2TrifectaPrivateCapture,
  type N2TrifectaPrivateCaptureEnvelope,
  type N2TrifectaPrivateFetcher,
} from "./n2TrifectaPrivateCaptureExecutor.js";

function completeOddsHtml(): string {
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

  return `<!doctype html><html><body><p>オッズ更新時間：09:35</p><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function plan() {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: [{
      date: "2026-08-06",
      venueCode: "05",
      raceNo: 1,
      closeAt: "10:05",
    }],
  });
}

function approvalFor(capturePlan: ReturnType<typeof plan>): N2TrifectaOddsCaptureApproval {
  return {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-private-time-contract-0001",
    scope: N2_TRIFECTA_ODDS_CAPTURE_APPROVAL_SCOPE,
    stage: capturePlan.stage,
    manifestDigest: capturePlan.manifestDigest,
    issuedAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2026-08-06T02:00:00.000Z",
    maxRequests: capturePlan.requestBudget,
    privateResearchOnly: true,
    publicRedistributionAuthorized: false,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "boat-pon-private-time-contract-"));
}

function fetcherAt(fetchedAt: string): N2TrifectaPrivateFetcher {
  return async () => ({
    statusCode: 200,
    contentType: "text/html; charset=UTF-8",
    headers: {},
    rawBytes: Buffer.from(completeOddsHtml(), "utf8"),
    fetchedAt,
  });
}

async function captureEnvelope(root: string, fetchedAt: string): Promise<N2TrifectaPrivateCaptureEnvelope> {
  const capturePlan = plan();
  const report = await executeN2TrifectaPrivateCapture({
    plan: capturePlan,
    approval: approvalFor(capturePlan),
    rootDir: root,
    now: "2026-08-06T00:35:30.000Z",
    executionMode: "execute",
    fetcher: fetcherAt(fetchedAt),
    sleep: async () => undefined,
  });
  assert.equal(report.status, "PASS");
  const captured = report.entryResults.find((entry) => entry.result === "CAPTURED");
  assert.ok(captured?.envelopeRelativePath);
  return JSON.parse(
    readFileSync(join(root, captured.envelopeRelativePath), "utf8"),
  ) as N2TrifectaPrivateCaptureEnvelope;
}

test("private capture rejects normalized execution times before network access", async () => {
  const root = tempDir();
  try {
    const capturePlan = plan();
    let fetchCount = 0;
    const report = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-05T24:35:30.000Z",
      executionMode: "execute",
      fetcher: async () => {
        fetchCount += 1;
        throw new Error("network must not run");
      },
    });

    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("INVALID_EXECUTION_TIME"));
    assert.equal(report.networkRequestCount, 0);
    assert.equal(fetchCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private capture canonicalizes equivalent fetchedAt instants into one lineage", async () => {
  const utcRoot = tempDir();
  const offsetRoot = tempDir();
  try {
    const utc = await captureEnvelope(utcRoot, "2026-08-06T00:35:30.000Z");
    const offset = await captureEnvelope(offsetRoot, "2026-08-06T09:35:30.000+09:00");

    assert.equal(offset.response.fetchedAt, utc.response.fetchedAt);
    assert.equal(offset.rawDocumentId, utc.rawDocumentId);
    assert.equal(offset.parseRunId, utc.parseRunId);
    assert.equal(offset.proposedObservationId, utc.proposedObservationId);
    assert.equal(offset.rawRelativePath, utc.rawRelativePath);
    assert.equal(offset.snapshotCandidate?.capturedAt, utc.snapshotCandidate?.capturedAt);
  } finally {
    rmSync(utcRoot, { recursive: true, force: true });
    rmSync(offsetRoot, { recursive: true, force: true });
  }
});
