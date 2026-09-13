import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const safeRunner = readFileSync("scripts/run-roi-all-features-lite-safe.ts", "utf8");
const fullReview = readFileSync("scripts/run-roi-full-review.ts", "utf8");
const proLoop = readFileSync("scripts/run-roi-pro-loop.ts", "utf8");

test("all-feature ROI safe runner isolates raw output and atomically publishes all artifacts", () => {
  assert.ok(safeRunner.includes('new URL("./assert-roi-all-feature-settlement-integrity.ts", import.meta.url)'));
  assert.ok(safeRunner.includes('new URL("./search-roi-all-features-lite.ts", import.meta.url)'));
  assert.ok(safeRunner.includes('assertCanonicalSingleLinkRegularFile(\n  DB_PATH,\n  "ROI_ALL_FEATURE_PREFLIGHT_DB_IDENTITY_INVALID"'));
  assert.ok(safeRunner.includes('assertCanonicalSingleLinkRegularFile(\n  DB_PATH,\n  "ROI_ALL_FEATURE_ANALYZER_DB_IDENTITY_INVALID"'));
  assert.ok(safeRunner.includes('ROI_ALL_FEATURE_DB_CHILD_HANDOFF_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('mkdtempSync(join(tmpdir(), "boat-pon-roi-all-feature-"))'));
  assert.ok(safeRunner.includes("cwd: workspace"));
  assert.ok(safeRunner.includes('BOAT_PON_DB_PATH: childDbPath'));
  assert.ok(safeRunner.includes('staged: "reports/roi-all-feature-search.md"'));
  assert.ok(safeRunner.includes('staged: "reports/roi-all-feature-search.json"'));
  assert.ok(safeRunner.includes('staged: "reports/roi-all-feature-search.csv"'));
  assert.ok(safeRunner.includes('STAGED_READ_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('STAGED_HANDOFF_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('ROI_ALL_FEATURE_REPORTS_DIRECTORY_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('PUBLISH_PARENT_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('PUBLISH_PARENT_HANDOFF_IDENTITY_INVALID'));
  assert.ok(safeRunner.includes('openSync(tempPath, "wx", 0o600)'));
  assert.ok(safeRunner.includes("fsyncSync(fd)"));
  assert.ok(safeRunner.includes("PUBLISH_DESTINATION_IDENTITY_INVALID"));
  assert.ok(safeRunner.includes("renameSync(verifiedTempPath, path)"));

  const prepareAll = safeRunner.indexOf('const preparedOutputs = stagedOutputs.map');
  const publishLoop = safeRunner.indexOf('for (const { output, content } of preparedOutputs)');
  assert.ok(prepareAll >= 0 && prepareAll < publishLoop, "all staged artifacts must be prepared before canonical publication");
});

test("high-level ROI research runners use the safe all-feature publication boundary", () => {
  const safeCommand = 'scripts/run-roi-all-features-lite-safe.ts';
  const rawCommand = 'scripts/search-roi-all-features-lite.ts';
  assert.ok(fullReview.includes(safeCommand));
  assert.ok(proLoop.includes(safeCommand));
  assert.ok(!fullReview.includes('["pnpm", ["tsx", "scripts/search-roi-all-features-lite.ts"]]'));
  assert.ok(!proLoop.includes('["tsx", "scripts/search-roi-all-features-lite.ts"]'));
  assert.ok(fullReview.includes(rawCommand), "full review must still inspect raw analyzer source for metric-basis governance");
});
