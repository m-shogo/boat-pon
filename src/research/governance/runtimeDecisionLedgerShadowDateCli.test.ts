import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../../../scripts/report-runtime-decision-ledger-shadow.ts", import.meta.url));
const missingDb = fileURLToPath(new URL("../../../.tmp-shadow-report-date-test.sqlite", import.meta.url));

function runWithDate(date: string) {
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    scriptPath,
    "--run-kind",
    "manual-test",
    "--model-version",
    "fixture",
    "--from",
    date,
    "--to",
    date,
    "--db",
    missingDb,
  ], { encoding: "utf8" });
}

test("shadow report rejects impossible calendar dates before any DB access", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01"]) {
    const result = runWithDate(date);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--from must be YYYY-MM-DD/);
    assert.doesNotMatch(result.stderr, /DB not found/);
  }
});

test("shadow report accepts a real leap day before checking the DB path", () => {
  const result = runWithDate("2028-02-29");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DB not found/);
  assert.doesNotMatch(result.stderr, /must be YYYY-MM-DD/);
});
