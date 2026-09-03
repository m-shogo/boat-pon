import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildN2TrifectaOddsCheckpointPlan } from "./n2TrifectaOddsCheckpointCollection.js";
import {
  buildN2TrifectaPrivateDailyPlanCache,
  buildN2TrifectaPrivateDailyPlanSourceEvidence,
  readN2TrifectaPrivateDailyPlanCache,
  writeN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";

function completePlan() {
  return buildN2TrifectaOddsCheckpointPlan({
    stage: "ONE_VENUE_REVIEW",
    races: Array.from({ length: 12 }, (_, index) => ({
      date: "2026-08-06",
      venueCode: "05",
      raceNo: index + 1,
      closeAt: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 === 0 ? "05" : "35"}`,
    })),
  });
}

test("daily plan reader rejects a valid external plan reached through a symlinked ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-read-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-read-external-"));
  try {
    const cache = buildN2TrifectaPrivateDailyPlanCache({
      date: "2026-08-06",
      generatedAt: "2026-08-06T00:00:00.000Z",
      plans: [completePlan()],
      source: buildN2TrifectaPrivateDailyPlanSourceEvidence({
        primaryDbBytes: 123_456,
        primaryDbModifiedMs: 1_786_000_000_000,
        primaryDbWalBytes: 0,
      }),
    });
    writeN2TrifectaPrivateDailyPlanCache({ dataRoot: external, cache });

    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(
      join(external, "data/private/trifecta-capture"),
      join(root, "data/private/trifecta-capture"),
      "dir",
    );

    const read = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(read.status, "BLOCKED");
    assert.deepEqual(read.blockers, ["DAILY_PLAN_PARENT_INVALID"]);
    assert.equal(read.plan, null);
    assert.equal(read.fallbackToPrimaryDbAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
