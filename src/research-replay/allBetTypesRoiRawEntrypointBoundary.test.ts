import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
const raw = readFileSync("scripts/analyze-all-bet-types-roi-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-all-bet-types-roi-internal.ts", "utf8");

test("all-bet-types ROI canonical entrypoint imports guarded raw module after payout audit", () => {
  const audit = wrapper.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gate = wrapper.indexOf("audit !== 0");
  const guardedImport = wrapper.indexOf('await import("./analyze-all-bet-types-roi-raw")');
  assert.ok(audit >= 0);
  assert.ok(gate > audit);
  assert.ok(guardedImport > gate, "guarded raw module must be imported only after payout audit passes");
  assert.doesNotMatch(wrapper, /run\("scripts\/analyze-all-bet-types-roi-raw\.ts"\)/);
});

test("all-bet-types ROI raw compatibility module cannot be invoked directly", () => {
  assert.match(raw, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(raw, /process\.argv\[1\]/);
  assert.match(raw, /ALL_BET_TYPES_ROI_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-all-bet-types-roi-internal"\)/);
});

test("isolated all-bet-types ROI implementation remains research-only and read-only", () => {
  assert.match(internal, /race_payouts/);
  assert.match(internal, /new DatabaseSync/);
  assert.match(internal, /readOnly: true/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
});
