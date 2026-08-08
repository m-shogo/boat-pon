import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const workflow = read(".github/workflows/n2-market-baseline-readiness.yml");
const cli = read("scripts/report-n2-market-baseline-readiness.ts");
const reader = read("src/research-replay/n2MarketBaselineReadinessReader.ts");

test("market baseline readiness reuses one-shot completion instead of a scheduler", () => {
  assert.match(workflow, /workflow_run:/u);
  assert.match(workflow, /boat-pon local research \(one-shot\)/u);
  assert.match(workflow, /types:\s*\[completed\]/u);
  assert.doesNotMatch(workflow, /\bschedule:/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});

test("market readiness is owner-main-only and read-only at GitHub level", () => {
  assert.match(workflow, /workflow_run\.event == 'workflow_dispatch'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/u);
  assert.match(workflow, /workflow_run\.actor\.login == 'm-shogo'/u);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
  assert.match(workflow, /persist-credentials:\s*false/u);
  assert.match(workflow, /runs-on:\s*\[self-hosted, macOS, boat-pon-local\]/u);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./u);
});

test("readiness output cannot promote N2-020 or widen protected product authority", () => {
  assert.match(cli, /n2TaskReady:/u);
  assert.match(cli, /networkRequestCount:\s*0/u);
  assert.match(cli, /databaseWriteCount:\s*read\.databaseWriteCount/u);
  assert.match(cli, /rawOddsValuesPrinted:\s*false/u);
  assert.match(cli, /rawOddsValuesPublished:\s*false/u);
  assert.match(workflow, /blocked readiness cannot unlock N2-020/u);
  assert.doesNotMatch(workflow, /git push|git commit|git add/u);
  assert.doesNotMatch(cli, /git push|git commit|updateState|reconcileCatalogState/u);
});

test("reader uses immutable query-only settlement access and no network", () => {
  assert.match(reader, /immutable=1/u);
  assert.match(reader, /readOnly:\s*true/u);
  assert.match(reader, /PRAGMA query_only=ON/u);
  assert.match(reader, /databaseWriteCount:\s*0/u);
  assert.match(reader, /rawOddsValuesRead:\s*false/u);
  assert.doesNotMatch(reader, /\bfetch\s*\(|curl\s|https?:\/\//u);
  assert.doesNotMatch(reader, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|CREATE\s+TABLE/u);
});

test("readiness BLOCKED is fail-closed for activation but not retroactive task failure", () => {
  assert.match(workflow, /if \[ "\$RC" -ne 0 \] && \[ "\$RC" -ne 3 \]/u);
  assert.match(workflow, /RC=3 is a fail-closed readiness result/u);
  assert.match(cli, /if \(report\.status === "BLOCKED"\) process\.exitCode = 3/u);
});
