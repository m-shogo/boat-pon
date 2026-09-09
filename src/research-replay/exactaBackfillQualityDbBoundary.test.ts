import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-exacta-backfill-quality-internal.ts", "utf8");

test("exacta backfill quality audit preserves a canonical read-only database boundary", () => {
  assert.match(
    source,
    /assertCanonicalSingleLinkRegularFile\(DB_PATH, "EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID"\)/u,
  );
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only = ON/u);
});

test("exacta backfill quality audit keeps configured database paths out of missing-file errors", () => {
  assert.match(source, /EXACTA_BACKFILL_QUALITY_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});
