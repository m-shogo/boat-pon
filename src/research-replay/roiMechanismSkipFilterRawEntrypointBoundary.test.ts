import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-roi-mechanism-skip-filters.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-mechanism-skip-filters-raw.ts", "utf8");
const safeRunner = readFileSync("scripts/run-roi-mechanism-skip-filters-safe.ts", "utf8");

test("ROI mechanism skip-filter raw analyzer cannot bypass settlement preflight or isolated provenance redaction", () => {
  const preflight = wrapper.indexOf("audit-roi-mechanism-skip-filter-payout-completeness.ts");
  const launchIdentity = wrapper.indexOf("ROI_MECHANISM_SKIP_FILTER_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const childLaunch = wrapper.indexOf("const analysis = spawnSync");
  const stagedMdIdentity = wrapper.indexOf("ROI_MECHANISM_SKIP_FILTER_MD_OUTPUT_IDENTITY_INVALID");
  const stagedJsonIdentity = wrapper.indexOf("ROI_MECHANISM_SKIP_FILTER_JSON_OUTPUT_IDENTITY_INVALID");
  const mdRedaction = wrapper.indexOf('redactDbProvenance(readFileSync(verifiedMdPath, "utf-8"), launchDbPath)');
  const jsonRedaction = wrapper.indexOf('redactDbProvenance(readFileSync(verifiedJsonPath, "utf-8"), launchDbPath)');
  const publish = wrapper.indexOf("atomicPublish(\n    OUT_MD");

  assert.ok(preflight >= 0);
  assert.ok(launchIdentity > preflight, "DB identity must be reverified after settlement preflight");
  assert.ok(childLaunch > launchIdentity, "internal analysis must launch only after DB revalidation");
  assert.ok(stagedMdIdentity > childLaunch && stagedJsonIdentity > stagedMdIdentity);
  assert.ok(mdRedaction > stagedJsonIdentity && jsonRedaction > mdRedaction && publish > jsonRedaction);
  assert.match(wrapper, /cwd: workspace/);
  assert.match(wrapper, /OPAQUE_DB_SOURCE = "primary research database"/);
  assert.doesNotMatch(wrapper, /await import\("\.\/analyze-roi-mechanism-skip-filters-internal"\)/);
  assert.doesNotMatch(wrapper, /analyze-roi-mechanism-skip-filters-raw/);

  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /analyze-roi-mechanism-skip-filters-internal/);

  assert.match(safeRunner, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(safeRunner, /analyze-roi-mechanism-skip-filters-raw/);
});
