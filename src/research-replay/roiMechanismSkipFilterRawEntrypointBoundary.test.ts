import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-roi-mechanism-skip-filters.ts", "utf8");
const raw = readFileSync("scripts/analyze-roi-mechanism-skip-filters-raw.ts", "utf8");
const safeRunner = readFileSync("scripts/run-roi-mechanism-skip-filters-safe.ts", "utf8");

test("ROI mechanism skip-filter raw analyzer cannot bypass settlement preflight", () => {
  assert.match(wrapper, /audit-roi-mechanism-skip-filter-payout-completeness\.ts/);
  assert.match(wrapper, /await import\("\.\/analyze-roi-mechanism-skip-filters-raw"\)/);
  assert.doesNotMatch(wrapper, /run\("scripts\/analyze-roi-mechanism-skip-filters-raw\.ts"\)/);
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ROI_MECHANISM_SKIP_FILTER_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-roi-mechanism-skip-filters-internal"\)/);
  assert.match(safeRunner, /await import\("\.\/analyze-roi-mechanism-skip-filters"\)/);
  assert.doesNotMatch(safeRunner, /analyze-roi-mechanism-skip-filters-raw/);
});
