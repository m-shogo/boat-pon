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

import { canonicalHash } from "./canonical.js";
import {
  writeN2TrifectaPrivateMarketDailyReadiness,
  type N2TrifectaPrivateMarketDailyReadiness,
} from "./n2TrifectaPrivateMarketDailyReadiness.js";

test("daily readiness writer rejects a symlinked ancestor before writing outside data root", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-readiness-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-daily-readiness-external-"));
  try {
    const core = {
      date: "2026-08-07",
      venueCode: "10",
      marker: "focused-parent-authority-regression",
    };
    const readiness = {
      ...core,
      outputDigest: canonicalHash(core),
    } as unknown as N2TrifectaPrivateMarketDailyReadiness;

    const privateRoot = join(root, "data/private");
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    symlinkSync(external, join(privateRoot, "trifecta-market-experiments"), "dir");

    assert.throws(
      () => writeN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness }),
      /DAILY_READINESS_PARENT_INVALID/u,
    );
    assert.equal(existsSync(join(external, "readiness/2026-08-07/10", `${readiness.outputDigest}.json`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
