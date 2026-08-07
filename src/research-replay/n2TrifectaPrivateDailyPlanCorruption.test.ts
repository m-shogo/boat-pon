import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  n2TrifectaPrivateDailyPlanRelativePath,
  readN2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";

test("structurally malformed private daily plan fails closed without primary DB fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-corruption-"));
  try {
    const relativePath = n2TrifectaPrivateDailyPlanRelativePath("2026-08-06");
    const path = join(root, relativePath);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({
      cacheVersion: "n2-trifecta-private-daily-plan-cache-v1",
      date: "2026-08-06",
      venueCode: "05",
      generatedAt: "2026-08-06T00:00:00.000Z",
      cacheDigest: "0".repeat(64),
    }), { encoding: "utf8", mode: 0o600 });

    const result = readN2TrifectaPrivateDailyPlanCache({
      dataRoot: root,
      expectedDate: "2026-08-06",
      now: "2026-08-06T00:35:00.000Z",
    });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.blockers, ["DAILY_PLAN_STRUCTURE_INVALID"]);
    assert.equal(result.plan, null);
    assert.equal(result.fallbackToPrimaryDbAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
