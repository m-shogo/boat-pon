import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  writeN2TrifectaPrivateDailyPlanCache,
  type N2TrifectaPrivateDailyPlanCache,
} from "./n2TrifectaPrivateDailyPlanCache.js";

test("daily plan writer rejects a symlinked ancestor before writing outside data root", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-daily-plan-external-"));
  try {
    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(external, join(root, "data/private/trifecta-capture"), "dir");

    const cache = { date: "2026-08-07" } as unknown as N2TrifectaPrivateDailyPlanCache;
    assert.throws(
      () => writeN2TrifectaPrivateDailyPlanCache({ dataRoot: root, cache }),
      /DAILY_PLAN_PARENT_INVALID/u,
    );
    assert.equal(existsSync(join(external, "plans/2026-08-07.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
