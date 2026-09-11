import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-research-governor.ts", "utf8");
const raw = readFileSync("scripts/report-research-governor-raw.ts", "utf8");

test("research governor enters the internal report only after canonical readiness and DB handoff checks", () => {
  const preflight = entry.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const handoff = entry.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const envHandoff = entry.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath");
  const internalImport = entry.indexOf('await import("./report-research-governor-internal")');

  assert.ok(preflight >= 0 && handoff > preflight && envHandoff > handoff && internalImport > envHandoff);
  assert.equal(entry.includes("report-research-governor-raw"), false);
  assert.equal(entry.includes('run("scripts/report-research-governor-internal.ts"'), false);
});

test("research governor raw compatibility module forbids direct CLI execution and cannot bypass canonical preflight", () => {
  assert.match(raw, /RESEARCH_GOVERNOR_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/report-research-governor"\)/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /report-research-governor-internal/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});
