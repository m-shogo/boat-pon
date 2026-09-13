import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-ticket-selector-strategies.ts", "utf8");

test("ticket-selector validates both canonical destinations before isolated analysis and before first publication", () => {
  const dbVerify = entrypoint.indexOf('"TICKET_SELECTOR_PRIMARY_DB_IDENTITY_INVALID"');
  const firstDestinationPreflight = entrypoint.indexOf("verifyExistingOutputPaths();", dbVerify);
  const isolatedAnalysis = entrypoint.indexOf("runIsolated(workspace, verifiedDbPath)");
  const reportsIdentity = entrypoint.indexOf(
    'assertCanonicalDirectory("reports", "TICKET_SELECTOR_REPORTS_DIRECTORY_IDENTITY_INVALID")',
    isolatedAnalysis,
  );
  const completeDestinationPreflight = entrypoint.indexOf("verifyExistingOutputPaths();", reportsIdentity);
  const firstPublish = entrypoint.indexOf("publishAtomically(", completeDestinationPreflight);

  assert.ok(firstDestinationPreflight > dbVerify, "destination identity preflight must follow verified DB handoff");
  assert.ok(isolatedAnalysis > firstDestinationPreflight, "isolated core analysis must not run before destination preflight");
  assert.ok(reportsIdentity > isolatedAnalysis, "canonical reports directory must be verified before publication");
  assert.ok(completeDestinationPreflight > reportsIdentity, "both final destinations must be revalidated together");
  assert.ok(firstPublish > completeDestinationPreflight, "no canonical output may be replaced before complete destination preflight");
  assert.match(entrypoint, /if \(existsSync\(OUT_MD\)\)/u);
  assert.match(entrypoint, /if \(existsSync\(OUT_JSON\)\)/u);
  assert.match(entrypoint, /TICKET_SELECTOR_PREEXISTING_JSON_REPORT_IDENTITY_INVALID/u);
});

test("ticket-selector publication revalidates its parent before temp creation and rename", () => {
  const helperStart = entrypoint.indexOf("function publishAtomically(");
  const parentInitial = entrypoint.indexOf("TICKET_SELECTOR_PUBLISH_PARENT_IDENTITY_INVALID", helperStart);
  const tempOpen = entrypoint.indexOf('openSync(tempPath, "wx", 0o600)', helperStart);
  const destinationIdentity = entrypoint.indexOf("destinationErrorCode", tempOpen);
  const parentHandoff = entrypoint.indexOf("TICKET_SELECTOR_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID", helperStart);
  const rename = entrypoint.indexOf("renameSync(verifiedTempPath, targetPath)", helperStart);

  assert.ok(helperStart >= 0);
  assert.ok(parentInitial > helperStart);
  assert.ok(tempOpen > parentInitial);
  assert.ok(destinationIdentity > tempOpen);
  assert.ok(parentHandoff > destinationIdentity);
  assert.ok(rename > parentHandoff);
});
