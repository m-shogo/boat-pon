import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("exacta market residual raw analyzer revalidates DB identity before read-only SQLite open", () => {
  const source = readFileSync("scripts/analyze-exacta-market-residual-sweep-raw.ts", "utf8");

  const missing = source.indexOf("EXACTA_MARKET_RESIDUAL_RAW_DB_MISSING");
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile(");
  const open = source.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = source.indexOf("PRAGMA query_only=ON");

  assert.ok(missing >= 0, "missing DB diagnostics must remain opaque");
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/);
  assert.match(source, /EXACTA_MARKET_RESIDUAL_RAW_DB_IDENTITY_INVALID/);
  assert.ok(identity >= 0, "raw analyzer must revalidate canonical single-link regular-file identity");
  assert.ok(open > identity, "SQLite must only open the verified DB path");
  assert.ok(queryOnly > open, "query_only must be enabled after the read-only open");
});
