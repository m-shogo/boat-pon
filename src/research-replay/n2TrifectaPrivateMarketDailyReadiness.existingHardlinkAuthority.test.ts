import assert from "node:assert/strict";
import { linkSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import {
  writeN2TrifectaPrivateMarketDailyReadiness,
  type N2TrifectaPrivateMarketDailyReadiness,
} from "./n2TrifectaPrivateMarketDailyReadiness.js";

test("existing daily readiness hardlink cannot be reused as idempotent authority", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-daily-readiness-hardlink-"));
  try {
    const core = {
      date: "2026-08-07",
      venueCode: "10",
      marker: "focused-hardlink-authority-regression",
    };
    const readiness = {
      ...core,
      outputDigest: canonicalHash(core),
    } as unknown as N2TrifectaPrivateMarketDailyReadiness;

    const first = writeN2TrifectaPrivateMarketDailyReadiness({
      dataRoot: root,
      readiness,
    });
    assert.equal(first.created, true);

    const canonicalPath = join(root, first.relativePath);
    const aliasPath = join(root, "data/private/trifecta-market-experiments/readiness-alias.json");
    mkdirSync(dirname(aliasPath), { recursive: true, mode: 0o700 });
    linkSync(canonicalPath, aliasPath);
    assert.equal(statSync(canonicalPath).nlink, 2);

    assert.throws(
      () => writeN2TrifectaPrivateMarketDailyReadiness({ dataRoot: root, readiness }),
      /DAILY_READINESS_EXISTING_HARDLINK_NOT_ALLOWED/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
