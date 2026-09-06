import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const RAW_ANALYZER = "scripts/analyze-exacta-market-residual-sweep.ts";
const SAFE_RUNNER = "tsx scripts/run-exacta-market-residual-sweep-safe.ts";

function filesUnder(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

test("npm exacta residual entrypoint remains pinned to the fail-closed safe runner", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["analyze:exacta-market-residual-sweep"], SAFE_RUNNER);
});

test("GitHub Actions cannot bypass the exacta residual payout audit with the raw analyzer", () => {
  const offenders = filesUnder(".github/workflows")
    .filter((path) => /\.ya?ml$/i.test(path))
    .filter((path) => readFileSync(path, "utf8").includes(RAW_ANALYZER));

  assert.deepEqual(offenders, []);
});
