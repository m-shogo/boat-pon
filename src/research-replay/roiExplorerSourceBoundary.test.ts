import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/explore-roi.ts", "utf8");

test("ROI explorer fails closed when required research sources are missing", () => {
  assert.match(source, /ROI_EXPLORER_PRIMARY_DB_MISSING/);
  assert.match(source, /ROI_EXPLORER_DECISION_HISTORY_TABLE_MISSING/);
  assert.match(source, /ROI_EXPLORER_OFFICIAL_PAYOUT_TABLE_MISSING/);
  assert.doesNotMatch(source, /research database not found; produced empty evaluation/);
  assert.doesNotMatch(source, /decision_history table not found; produced empty evaluation/);
});

test("ROI explorer preserves canonical read-only database identity boundary", () => {
  const identity = source.indexOf("assertCanonicalSingleLinkRegularFile");
  const open = source.indexOf("new DatabaseSync(primaryDbPath, { readOnly: true })");
  const queryOnly = source.indexOf("PRAGMA query_only = ON");

  assert.ok(identity >= 0 && open > identity, "expected canonical identity verification before database open");
  assert.ok(queryOnly > open, "expected query_only after read-only open");
});
