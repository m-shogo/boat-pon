import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  type N2TrifectaPrivateFetcher,
} from "./n2TrifectaPrivateCaptureExecutor.js";

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

function plan(raceCount = 1) {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: Array.from({ length: raceCount }, (_, index) => ({
      date: "2026-08-06",
      venueCode: "05",
      raceNo: index + 1,
      closeAt: "10:05",
    })),
  });
}

function approvalFor(
  capturePlan: ReturnType<typeof plan>,
): N2TrifectaOddsCaptureApproval {
  return {
    approvalVersion: "n2-trifecta-odds-capture-approval-v1",
    approvalId: "APR-N2-TRI-ODDS-private-executor-0001",
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

function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-trifecta-private-capture-"));
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

function listFiles(root: string): string[] {
  const result: string[] = [];
  function walk(path: string, relative: string): void {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child, next);
      else result.push(next);
    }
  }
  walk(root, "");
  return result.sort();
}

test("approved due checkpoint captures full raw evidence append-only without DB/BUY/LINE writes", async () => {
  await withTempDir(async (root) => {
    const capturePlan = plan();
    assert.equal(capturePlan.status, "READY_FOR_PRIVATE_REVIEW");
    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      return {
        statusCode: 200,
        contentType: "text/html; charset=UTF-8",
        headers: {
          "content-type": "text/html; charset=UTF-8",
          etag: "fixture-etag",
          "set-cookie": "must-not-be-retained",
        },
        rawBytes: Buffer.from(completeOddsHtml(), "utf8"),
        fetchedAt: "2026-08-06T00:35:30.000Z",
      };
    };

    const first = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:30.000Z",
      executionMode: "execute",
      fetcher,
      sleep: async () => undefined,
    });

    assert.equal(first.status, "PASS");
    assert.equal(first.networkRequestCount, 1);
    assert.equal(first.capturedCount, 1);
    assert.equal(first.blockedEvidenceCount, 0);
    assert.equal(first.databaseWriteCount, 0);
    assert.equal(first.primaryDbWriteCount, 0);
    assert.equal(first.sidecarWriteCount, 0);
    assert.equal(first.currentBuyChanged, false);
    assert.equal(first.lineChanged, false);
    assert.equal(first.publicPublished, false);
    assert.equal(first.automatedBettingChanged, false);
    assert.equal(first.productionApplyExecuted, false);
    assert.equal(fetchCount, 1);

    const captured = first.entryResults.find((entry) => entry.result === "CAPTURED");
    assert.ok(captured?.rawRelativePath);
    assert.ok(captured?.envelopeRelativePath);
    assert.equal(existsSync(join(root, captured.rawRelativePath)), true);
    assert.equal(existsSync(join(root, captured.envelopeRelativePath)), true);
    assert.equal(
      existsSync(join(root, "data/raw/research/trifecta-market/2026-08-06/05/01/T-30/accepted.json")),
      true,
    );

    const files = listFiles(root);
    assert.equal(files.some((file) => file.endsWith(".sqlite")), false);
    assert.equal(files.some((file) => file.includes("set-cookie")), false);

    const second = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:45.000Z",
      executionMode: "execute",
      fetcher,
      sleep: async () => undefined,
    });
    assert.equal(second.status, "NO_CHANGE");
    assert.equal(second.networkRequestCount, 0);
    assert.equal(fetchCount, 1);
    assert.ok(second.entryResults.some((entry) => entry.result === "ALREADY_ACCEPTED"));
  });
});

test("blocked response is retained once and never retried automatically", async () => {
  await withTempDir(async (root) => {
    const capturePlan = plan();
    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      return {
        statusCode: 200,
        contentType: "text/html",
        headers: {},
        rawBytes: Buffer.from(completeOddsHtml().replace("オッズ更新時間：09:35", "更新時刻なし"), "utf8"),
        fetchedAt: "2026-08-06T00:35:30.000Z",
      };
    };

    const first = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:30.000Z",
      executionMode: "execute",
      fetcher,
    });
    assert.equal(first.status, "BLOCKED");
    assert.equal(first.networkRequestCount, 1);
    assert.equal(first.blockedEvidenceCount, 1);
    assert.ok(first.blockers.includes("DISPLAYED_ODDS_UPDATE_TIME_MISSING"));
    assert.equal(fetchCount, 1);
    assert.equal(
      existsSync(join(root, "data/raw/research/trifecta-market/2026-08-06/05/01/T-30/accepted.json")),
      false,
    );

    const second = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:45.000Z",
      executionMode: "execute",
      fetcher: async () => {
        throw new Error("must not retry");
      },
    });
    assert.equal(second.status, "NO_CHANGE");
    assert.equal(second.networkRequestCount, 0);
    assert.ok(second.entryResults.some((entry) => entry.result === "ATTEMPT_ALREADY_RECORDED"));
    assert.equal(fetchCount, 1);
  });
});

test("missing approval and dry-run modes never make a network request", async () => {
  await withTempDir(async (root) => {
    const capturePlan = plan();
    let fetchCount = 0;
    const fetcher: N2TrifectaPrivateFetcher = async () => {
      fetchCount += 1;
      throw new Error("network must remain disabled");
    };

    const blocked = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: null,
      rootDir: root,
      now: "2026-08-06T00:35:30.000Z",
      executionMode: "execute",
      fetcher,
    });
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.networkRequestCount, 0);
    assert.ok(blocked.blockers.includes("APPROVAL_SOURCE_SPECIFIC_APPROVAL_MISSING"));

    const dryRun = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: null,
      rootDir: root,
      now: "2026-08-06T00:35:30.000Z",
      executionMode: "dry-run",
      fetcher,
    });
    assert.equal(dryRun.status, "DRY_RUN");
    assert.equal(dryRun.dueEntryCount, 1);
    assert.equal(dryRun.networkRequestCount, 0);
    assert.equal(fetchCount, 0);
  });
});

test("multiple due races remain sequential with the configured request interval", async () => {
  await withTempDir(async (root) => {
    const capturePlan = plan(2);
    const sleeps: number[] = [];
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

    const report = await executeN2TrifectaPrivateCapture({
      plan: capturePlan,
      approval: approvalFor(capturePlan),
      rootDir: root,
      now: "2026-08-06T00:35:30.000Z",
      executionMode: "execute",
      fetcher,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    assert.equal(report.status, "PASS");
    assert.equal(report.networkRequestCount, 2);
    assert.equal(report.capturedCount, 2);
    assert.equal(fetchCount, 2);
    assert.deepEqual(sleeps, [10_000]);
  });
});
