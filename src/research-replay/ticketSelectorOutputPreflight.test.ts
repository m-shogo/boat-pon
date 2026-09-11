import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-ticket-selector-strategies.ts", "utf8");

test("ticket-selector rejects unsafe pre-existing report paths before core analysis writes", () => {
  const dbVerify = entrypoint.indexOf('"TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID"');
  const reportVerify = entrypoint.indexOf('"TICKET_SELECTOR_PREEXISTING_REPORT_IDENTITY_INVALID"');
  const analysis = entrypoint.indexOf('run("scripts/analyze-ticket-selector-strategies-core.ts"');

  assert.ok(reportVerify > dbVerify, "report-path identity preflight must follow verified DB handoff");
  assert.ok(analysis > reportVerify, "core analysis must not write before an existing report path is verified");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
});
