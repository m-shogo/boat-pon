import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const helper = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/boat-pon-intent-dispatch.yml"),
  "utf8",
);

test("trusted retained-output gate does not load task-controlled tsx dependencies", () => {
  assert.match(
    helper,
    /node scripts\/check-research-retained-output-commit\.mjs --run-id=/u,
  );
  assert.doesNotMatch(helper, /node --import tsx scripts\/check-research-retained-output-commit/u);
  assert.match(workflow, /scripts\/check-research-retained-output-commit\.mjs/u);

  const restoreIndex = workflow.indexOf("scripts/check-research-retained-output-commit.mjs");
  const tokenIndex = workflow.indexOf("BOAT_PON_AUTOMATION_PUSH_TOKEN: ${{ github.token }}");
  assert.notEqual(restoreIndex, -1);
  assert.notEqual(tokenIndex, -1);
  assert.ok(restoreIndex < tokenIndex, "dependency-free gate must be restored before push token exposure");
});
