import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/check-exacta-backfill-quality-internal.ts", "utf8");

test("exacta backfill quality audit rejects direct internal execution before DB access", () => {
  const directGuard = source.indexOf("EXACTA_BACKFILL_QUALITY_INTERNAL_DIRECT_EXECUTION_FORBIDDEN");
  const missing = source.indexOf("EXACTA_BACKFILL_QUALITY_DB_MISSING");
  const identity = source.indexOf("EXACTA_BACKFILL_QUALITY_DB_IDENTITY_INVALID");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");

  assert.ok(directGuard >= 0, "internal quality audit must reject direct CLI execution");
  assert.ok(missing > directGuard, "DB existence check must follow the direct-execution guard");
  assert.ok(identity > missing, "DB identity check must remain downstream of the guard");
  assert.ok(open > identity, "SQLite open must remain downstream of canonical identity verification");
});

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
