import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const runnerSource = readFileSync(resolve(process.cwd(), "scripts/run-intent-task.ts"), "utf8");

test("canonical research runner uses durable-compatible numeric local run ids", () => {
  assert.match(
    runnerSource,
    /const runId = process\.env\.GITHUB_RUN_ID \?\? String\(Date\.now\(\)\);/u,
  );
  assert.doesNotMatch(runnerSource, /`local-\$\{Date\.now\(\)\}`/u);
});
