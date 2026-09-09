import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-t5-network-only-forward.ts", "utf8");

test("T-5 network-only forward preserves a canonical read-only database boundary", () => {
  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "T5_NETWORK_ONLY_FORWARD_DB_IDENTITY_INVALID"\)/u);
  assert.match(source, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(source, /PRAGMA query_only=ON/u);
});

test("T-5 network-only forward does not expose the configured database path on missing DB", () => {
  assert.match(source, /T5_NETWORK_ONLY_FORWARD_DB_MISSING/u);
  assert.doesNotMatch(source, /DB not found: \$\{DB_PATH\}/u);
});
