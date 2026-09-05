import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
  scripts?: Record<string, string>;
};

test("payout rebase npm entrypoint cannot bypass settlement completeness preflight", () => {
  assert.equal(
    pkg.scripts?.["analyze:payout-rebase"],
    "tsx scripts/run-payout-rebase-safe.ts",
    "the normal payout-rebase command must enter through the fail-closed runner",
  );
});
