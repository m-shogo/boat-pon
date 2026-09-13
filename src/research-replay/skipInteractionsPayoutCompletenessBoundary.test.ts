import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-roi-skip-interactions.ts", "utf-8");
const raw = readFileSync("scripts/analyze-roi-skip-interactions-raw.ts", "utf-8");
const core = readFileSync("scripts/analyze-roi-skip-interactions-core.ts", "utf-8");
const audit = readFileSync("scripts/audit-roi-skip-interactions-payout-completeness.ts", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts?: Record<string, string> };

test("skip-interactions command cannot bypass settlement completeness", () => {
  assert.equal(pkg.scripts?.["analyze:roi-skip-interactions"], "tsx scripts/analyze-roi-skip-interactions.ts");
  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const verify = entrypoint.indexOf('"ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID"');
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  assert.ok(preflight >= 0);
  assert.ok(verify > preflight);
  assert.ok(analysis > verify);
  assert.match(entrypoint, /if \(preflight !== 0\)[\s\S]*process\.exit\(preflight\)/);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-roi-skip-interactions-core.ts")), false);
  assert.equal(Object.values(pkg.scripts ?? {}).some((command) => command.includes("analyze-roi-skip-interactions-raw.ts")), false);
  assert.doesNotMatch(entrypoint, /run\("scripts\/analyze-roi-skip-interactions-raw\.ts"/);
});

test("skip-interactions canonical entrypoint re-verifies DB identity before isolated core handoff", () => {
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIMARY_DB_MISSING/);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_DB_CHILD_LAUNCH_IDENTITY_INVALID/);
  assert.doesNotMatch(entrypoint, /DB not found:/);

  const preflight = entrypoint.indexOf('run("scripts/audit-roi-skip-interactions-payout-completeness.ts")');
  const verify = entrypoint.indexOf('"ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID"');
  const workspace = entrypoint.indexOf('mkdtempSync(join(tmpdir(), "boat-pon-roi-skip-interactions-")');
  const childIdentity = entrypoint.indexOf('"ROI_SKIP_INTERACTIONS_DB_CHILD_LAUNCH_IDENTITY_INVALID"');
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  assert.ok(preflight >= 0 && verify > preflight && workspace > verify && childIdentity > workspace && analysis > childIdentity);
  assert.match(entrypoint, /cwd: workspace/u);
  assert.match(entrypoint, /env: \{ \.\.\.process\.env, BOAT_PON_DB_PATH: launchDbPath \}/u);
  assert.equal(entrypoint.includes("analyze-roi-skip-interactions-raw.ts"), false);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-roi-skip-interactions-core"\)/u);
});

test("skip-interactions guarded raw compatibility module routes through canonical settlement preflight", () => {
  const directGuard = raw.indexOf("ROI_SKIP_INTERACTIONS_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const canonicalImport = raw.indexOf('await import("./analyze-roi-skip-interactions")');

  assert.ok(directGuard >= 0 && canonicalImport > directGuard);
  assert.doesNotMatch(raw, /ROI_SKIP_INTERACTIONS_RAW_DB_MISSING/);
  assert.doesNotMatch(raw, /ROI_SKIP_INTERACTIONS_RAW_DB_IDENTITY_INVALID/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /analyze-roi-skip-interactions-core/);
});

test("skip-interactions core independently fails closed before SQLite reads", () => {
  const directGuard = core.indexOf("ROI_SKIP_INTERACTIONS_CORE_DIRECT_EXECUTION_FORBIDDEN");
  const missing = core.indexOf("ROI_SKIP_INTERACTIONS_CORE_DB_MISSING");
  const identity = core.indexOf("ROI_SKIP_INTERACTIONS_CORE_DB_IDENTITY_INVALID");
  const open = core.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = core.indexOf("PRAGMA query_only = ON");

  assert.ok(directGuard >= 0, "core must reject direct CLI execution");
  assert.ok(missing > directGuard, "core DB existence check must follow direct-execution guard");
  assert.ok(identity > missing, "core DB identity must be revalidated before SQLite open");
  assert.ok(open > identity, "core SQLite open must use only the revalidated DB path");
  assert.ok(queryOnly > open, "core connection must be forced query-only after read-only open");
  assert.match(core, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(core, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(core, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(core, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});

test("skip-interactions redacts private DB provenance before canonical publication", () => {
  const analysis = entrypoint.indexOf("const analysis = spawnSync");
  const stagedIdentity = entrypoint.indexOf('"ROI_SKIP_INTERACTIONS_MD_OUTPUT_IDENTITY_INVALID"');
  const redact = entrypoint.indexOf('redactDbProvenance(readFileSync(verifiedMdPath, "utf-8"), launchDbPath)');
  const publish = entrypoint.indexOf("atomicPublish(", redact);

  assert.ok(analysis >= 0);
  assert.ok(stagedIdentity > analysis, "staged report identity must be verified only after successful core analysis");
  assert.ok(redact > stagedIdentity, "private DB provenance must be removed from the verified staged report");
  assert.ok(publish > redact, "canonical publication must occur only after provenance redaction");
  assert.match(entrypoint, /const OPAQUE_DB_SOURCE = "primary research database"/u);
  assert.match(entrypoint, /const privateMarker = `DB: \$\{dbPath\}`/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIVATE_DB_PROVENANCE_MARKER_MISSING/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_PRIVATE_DB_PATH_REMAINS/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_JSON_PRIVATE_DB_PATH_REMAINS/u);
});

test("skip-interactions verifies staged outputs and atomically publishes Markdown and JSON", () => {
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_MD_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_JSON_OUTPUT_IDENTITY_INVALID/u);
  assert.match(entrypoint, /openSync\(tempPath, "wx", 0o600\)/u);
  assert.match(entrypoint, /writeFileSync\(fd, content, "utf-8"\);\s*fsyncSync\(fd\);/u);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(tempPath, tempErrorCode\)/u);
  assert.match(entrypoint, /if \(existsSync\(targetPath\)\) \{\s*assertCanonicalSingleLinkRegularFile\(targetPath, destinationErrorCode\);\s*\}\s*assertCanonicalDirectory\(\s*parentPath,\s*"ROI_SKIP_INTERACTIONS_PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID",\s*\);\s*renameSync\(verifiedTempPath, targetPath\);/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_MD_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_MD_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_JSON_PUBLISH_TEMP_IDENTITY_INVALID/u);
  assert.match(entrypoint, /ROI_SKIP_INTERACTIONS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_MD,\s*markdown,/u);
  assert.match(entrypoint, /atomicPublish\(\s*OUT_JSON,\s*json,/u);
  assert.match(entrypoint, /rmSync\(workspace, \{ recursive: true, force: true \}\)/u);
  assert.doesNotMatch(entrypoint, /writeFileSync\(\s*OUT_(?:MD|JSON)/u);
});

test("skip-interactions preflight matches the exact forward population and validates settlement line integrity", () => {
  assert.match(audit, /WITH target_rows AS \(/);
  assert.match(audit, /SELECT dh\.race_id, dh\.bet_type, dh\.returned/);
  assert.match(audit, /target_races AS \(\s*SELECT DISTINCT race_id\s*FROM target_rows/);
  assert.match(audit, /dh\.decision = 'BUY'/);
  assert.match(audit, /dh\.run_kind = 'historical-backfill'/);
  assert.match(audit, /dh\.current_odds IS NOT NULL/);
  assert.match(audit, /dh\.selection = '1-2-3'/);
  assert.match(audit, /dh\.date >= \?/);
  assert.match(audit, /EXCLUDED_VENUES/);
  assert.match(audit, /EXCLUDED_RACE_NOS/);
  assert.match(audit, /bet_type = '3連単'/);
  assert.match(audit, /returned = 0/);
  assert.match(audit, /tr\.bet_type IS NULL/);
  assert.match(audit, /tr\.bet_type != '3連単'/);
  assert.match(audit, /tr\.returned IS NULL/);
  assert.match(audit, /tr\.returned != 0/);
  assert.match(audit, /cohortInvalidRows/);
  assert.match(audit, /non-3連単 or returned\/unknown-return historical BUY rows/);
  assert.match(audit, /rp\.bet_type = 'trifecta'/);
  assert.match(audit, /ts\.returned = 0/);
  assert.match(audit, /ts\.returned IS NULL OR ts\.returned != 0/);
  assert.match(audit, /ts\.payout_yen > 0/);
  assert.match(audit, /ts\.payout_yen <= 0/);
  assert.match(audit, /ts\.combination IS NULL/);
  assert.match(audit, /HAVING COUNT\(\*\) > 1/);
  assert.match(audit, /duplicateCombinationKeys/);
  assert.match(audit, /returnedRows/);
  assert.match(audit, /evaluatePaperForwardPayoutCompleteness/);
  assert.match(audit, /process\.exit\(2\)/);

  const cohortGuard = audit.indexOf("if ((row.cohortInvalidRows ?? 0) > 0)");
  const completenessGuard = audit.indexOf("if (!result.complete)");
  assert.ok(cohortGuard >= 0 && cohortGuard < completenessGuard, "decision-cohort drift must fail closed before ROI completeness is accepted");
});

test("skip-interactions preflight permits legitimate multi-line winners rather than enforcing one row per race", () => {
  assert.doesNotMatch(audit, /HAVING COUNT\(\*\) = 1/);
  assert.doesNotMatch(audit, /COUNT\(DISTINCT ts\.combination\) = 1/);
});

test("skip-interactions preflight verifies DB identity before read-only SQLite open", () => {
  const verify = audit.indexOf("assertCanonicalSingleLinkRegularFile(DB_PATH");
  const open = audit.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  assert.ok(verify >= 0 && open > verify);
  assert.match(audit, /PRAGMA query_only = ON/);
});
