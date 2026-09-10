import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("racer ability canonical entrypoint verifies research inputs and redacts filesystem provenance", () => {
  const source = readFileSync("scripts/report-racer-ability-audit.ts", "utf8");

  const dbMissing = source.indexOf("RACER_ABILITY_AUDIT_DB_MISSING");
  const candidateMissing = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_MISSING");
  const dbIdentity = source.indexOf("RACER_ABILITY_AUDIT_DB_IDENTITY_INVALID");
  const candidateIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_IDENTITY_INVALID");
  const candidateSourceHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_SOURCE_HANDOFF_IDENTITY_INVALID");
  const candidateCopy = source.indexOf("copyFileSync(handoffCandidatesSourcePath, workspaceCandidates)");
  const loaderResolve = source.indexOf('import.meta.resolve("tsx")');
  const internalRun = source.indexOf('spawnSync(process.execPath, ["--import", tsxLoader, internalPath]');
  const redactJson = source.indexOf("delete report.dbPath");
  const redactMarkdown = source.indexOf('"DB: verified read-only research DB"');

  assert.ok(dbMissing >= 0, "missing DB diagnostics must remain opaque");
  assert.ok(candidateMissing >= 0, "missing candidate diagnostics must remain opaque");
  assert.ok(dbIdentity > dbMissing, "DB identity must be verified after the opaque existence check");
  assert.ok(candidateIdentity > candidateMissing, "candidate identity must be verified after the opaque existence check");
  assert.ok(candidateSourceHandoffIdentity > candidateIdentity, "frozen candidate source identity must be reverified immediately before staging");
  assert.ok(candidateCopy > candidateSourceHandoffIdentity, "only the handoff-reverified frozen candidate artifact may enter the isolated workspace");
  assert.ok(loaderResolve >= 0, "tsx loader must resolve before the child changes working directory");
  assert.ok(internalRun > candidateCopy, "legacy aggregation must not run before both verified inputs are staged");
  assert.ok(redactJson > internalRun, "JSON filesystem provenance must be removed before publishing");
  assert.ok(redactMarkdown > internalRun, "Markdown filesystem provenance must be redacted before publishing");
  assert.doesNotMatch(source, /DB not found: \\?\$\{[^}]+\}/u);
  assert.doesNotMatch(source, /new DatabaseSync/u);
});
