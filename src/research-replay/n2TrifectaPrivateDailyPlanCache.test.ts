import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildN2TrifectaOddsCheckpointPlan,
  type N2TrifectaOddsCheckpointPlan,
} from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  n2TrifectaPrivateDailyPlanRelativePath,
  readN2TrifectaPrivateDailyPlanCache,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";

function completePlan(venueCode = "05", date = "2026-08-06"): N2TrifectaOddsCheckpointPlan {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: Array.from({ length: 12 }, (_, index) => ({
      date,
      venueCode,
      raceNo: index + 1,
      closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
    })),
  });
}

function sourceEvidence() {
  return buildN2TrifectaPrivateDailyPlanSourceEvidence({
    primaryDbBytes: 123_456,
    primaryDbModifiedMs: 1_786_000_000_000,
    primaryDbWalBytes: 0,
  });
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-cache-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("complete one-venue daily plan is private, deterministic, and 12R/48-checkpoint complete", () => {
  const plan = completePlan();
  assert.equal(plan.status, "READY_FOR_PRIVATE_REVIEW");
  assert.equal(plan.raceCount, 12);
  assert.equal(plan.requestBudget, 48);

  const cache = buildN2TrifectaPrivateDailyPlanCache({
    date: "2026-08-06",
    generatedAt: "2026-08-06T00:00:00.000Z",
    plans: [plan],
    source: sourceEvidence(),
  });

  assert.equal(cache.date, "2026-08-06");
  assert.equal(cache.venueCode, "05");
  assert.equal(cache.sourcePlanDigest, plan.manifestDigest);
  assert.equal(cache.plan.raceCount, 12);
  assert.equal(cache.plan.entries.length, 48);
  assert.equal(cache.databaseWriteAuthorized, false);
  assert.equal(cache.currentBuyConnectionAuthorized, false);
  assert.equal(cache.lineConnectionAuthorized, false);
  assert.equal(cache.publicPublishAuthorized, false);
  assert.equal(cache.automatedBettingAuthorized, false);
});

test("daily plan rejects normalized generatedAt clocks instead of rolling them into the next JST day", () => {
  assert.throws(
    () => buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-07",
      generatedAt: "2026-08-06T24:00:00+09:00",
      plans: [completePlan("05", "2026-08-07")],
      source: sourceEvidence(),
    }),
    /DAILY_PLAN_DATE_INVALID/,
  );

  assert.doesNotThrow(() => buildN2TrifectaPrivateDailyPlanCache({
    date: "2028-02-29",
    generatedAt: "2028-02-29T00:00:00+09:00",
    plans: [completePlan("05", "2028-02-29")],
    source: sourceEvidence(),
  }));
});

test("daily plan cache paths reject impossible calendar dates", () => {
  assert.throws(
    () => n2TrifectaPrivateDailyPlanRelativePath("2026-02-30"),
    /INVALID_DATE/,
  );
  assert.equal(
    n2TrifectaPrivateDailyPlanRelativePath("2028-02-29"),
    "data/private/trifecta-capture/plans/2028-02-29.json",
  );
});

test("atomic private write is owner-only and reads back without database fallback", () => {
  withRoot((root) => {
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-06",
      generatedAt: "2026-08-06T00:00:00.000Z",
      plans: [completePlan()],
      source: sourceEvidence(),
    });
    const relativePath = writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });
    assert.equal(relativePath, n2TrifectaPrivateDailyPlanRelativePath("2026-08-06"));
    const absolutePath = join(root, relativePath);
    assert.equal(statSync(absolutePath).mode & 0o777, 0o600);

    const read = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(read.status, "PASS");
    assert.equal(read.fallbackToPrimaryDbAllowed, false);
    assert.equal(read.plan?.manifestDigest, cache.plan.manifestDigest);
  });
});

test("missing or stale cache may fall back, but tamper fails closed", () => {
  withRoot((root) => {
    const missing = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(missing.status, "MISSING");
    assert.equal(missing.fallbackToPrimaryDbAllowed, true);

    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-06",
      generatedAt: "2026-08-06T00:00:00.000Z",
      plans: [completePlan()],
      source: sourceEvidence(),
    });
    const relativePath = writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache });
    const absolutePath = join(root, relativePath);

    const stale = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-07T00:35:00.000Z",
    });
    assert.equal(stale.status, "STALE");
    assert.equal(stale.fallbackToPrimaryDbAllowed, true);

    const tampered = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
    tampered.cacheDigest = "0".repeat(64);
    writeFileSync(absolutePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    chmodSync(absolutePath, 0o600);
    const blocked = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.fallbackToPrimaryDbAllowed, false);
    assert.ok(blocked.blockers.includes("CACHE_DIGEST_MISMATCH"));
  });
});

test("active WAL cannot be recorded as safe source evidence", () => {
  assert.throws(
    () => buildN2TrifectaPrivateDailyPlanSourceEvidence({
      primaryDbBytes: 123_456,
      primaryDbModifiedMs: 1_786_000_000_000,
      primaryDbWalBytes: 4096,
    }),
    /PRIMARY_DB_ACTIVE_WAL/,
  );
});

test("incomplete 11R plan cannot become a daily cache", () => {
  const incomplete = buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: Array.from({ length: 11 }, (_, index) => ({
      date: "2026-08-06",
      venueCode: "05",
      raceNo: index + 1,
      closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
    })),
  });
  assert.equal(incomplete.status, "READY_FOR_PRIVATE_REVIEW");
  assert.throws(
    () => buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-06",
      generatedAt: "2026-08-06T00:00:00.000Z",
      plans: [incomplete],
      source: sourceEvidence(),
    }),
    /NO_COMPLETE_ONE_VENUE_PLAN/,
  );
});
