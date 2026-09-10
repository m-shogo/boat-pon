import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-research-governor.ts", "utf8");
const raw = readFileSync("scripts/report-research-governor-raw.ts", "utf8");

test("research governor routes the verified DB through a guarded raw handoff", () => {
  const preflight = entry.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const handoff = entry.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const rawRun = entry.indexOf('run("scripts/report-research-governor-raw.ts"');

  assert.ok(preflight >= 0 && handoff > preflight && rawRun > handoff);
  assert.equal(entry.includes('run("scripts/report-research-governor-internal.ts"'), false);
});

test("research governor raw compatibility module revalidates identity and forbids direct CLI execution", () => {
  const directGuard = raw.indexOf("RESEARCH_GOVERNOR_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const identity = raw.indexOf("RESEARCH_GOVERNOR_RAW_DB_IDENTITY_INVALID");
  const internalImport = raw.indexOf('await import("./report-research-governor-internal")');

  assert.ok(directGuard >= 0 && identity > directGuard && internalImport > identity);
  assert.ok(raw.includes("assertCanonicalSingleLinkRegularFile("));
  assert.equal(raw.includes("DB not found: ${"), false);
});
