import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/report-research-governor.ts", "utf8");
const raw = readFileSync("scripts/report-research-governor-raw.ts", "utf8");

test("research governor enters the internal report only after canonical readiness, DB handoff, and hypothesis registry checks", () => {
  const preflight = entry.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const handoff = entry.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const envHandoff = entry.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath");
  const hypothesisMissing = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_MISSING");
  const hypothesisIdentity = entry.indexOf("RESEARCH_GOVERNOR_HYPOTHESIS_REGISTRY_IDENTITY_INVALID");
  const internalImport = entry.indexOf('await import("./report-research-governor-internal")');

  assert.ok(preflight >= 0);
  assert.ok(handoff > preflight);
  assert.ok(envHandoff > handoff);
  assert.ok(hypothesisMissing > envHandoff);
  assert.ok(hypothesisIdentity > hypothesisMissing);
  assert.ok(internalImport > hypothesisIdentity);
  assert.match(entry, /HYPOTHESIS_PATH = "data\/research-hypotheses\.json"/);
  assert.match(entry, /assertCanonicalSingleLinkRegularFile/);
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
