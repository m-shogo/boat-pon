import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("direct all-bet-types ROI entrypoint cannot bypass payout completeness audit", () => {
  const source = readFileSync("scripts/analyze-all-bet-types-roi.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const gateIndex = source.indexOf("audit !== 0");
  const rawIndex = source.indexOf("analyze-all-bet-types-roi-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(gateIndex > auditIndex);
  assert.ok(rawIndex > gateIndex);
  assert.doesNotMatch(source, /DatabaseSync/);
});

test("legacy safe all-bet-types runner audits before invoking raw analyzer", () => {
  const source = readFileSync("scripts/run-all-bet-types-roi-safe.ts", "utf8");
  const auditIndex = source.indexOf("audit-all-bet-types-payout-completeness.ts");
  const rawIndex = source.indexOf("analyze-all-bet-types-roi-raw.ts");

  assert.ok(auditIndex >= 0);
  assert.ok(rawIndex > auditIndex);
  assert.doesNotMatch(source, /analyze-all-bet-types-roi\.ts/);
});

test("npm all-bet-types ROI alias points at the guarded normal entrypoint", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.["analyze:all-bet-types-roi"], "tsx scripts/analyze-all-bet-types-roi.ts");
});
