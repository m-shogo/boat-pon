import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CASES = [
  {
    alias: "analyze:condb-switch-historical",
    entry: "scripts/analyze-condb-switch-historical-closing-odds.ts",
    audit: "audit-condb-switch-historical-payout-completeness.ts",
    raw: "analyze-condb-switch-historical-closing-odds-raw.ts",
  },
  {
    alias: "analyze:skip6r-switch-historical",
    entry: "scripts/analyze-skip6r-switch-historical-closing-odds.ts",
    audit: "audit-skip6r-historical-payout-completeness.ts",
    raw: "analyze-skip6r-switch-historical-closing-odds-raw.ts",
  },
  {
    alias: "analyze:skipvenue-switch-historical",
    entry: "scripts/analyze-skipvenue-switch-historical-closing-odds.ts",
    audit: "audit-skipvenue-historical-payout-completeness.ts",
    raw: "analyze-skipvenue-switch-historical-closing-odds-raw.ts",
  },
] as const;

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

for (const c of CASES) {
  test(`${c.alias} direct entrypoint fails closed before raw analysis`, () => {
    const source = readFileSync(c.entry, "utf8");
    const auditIndex = source.indexOf(c.audit);
    const gateIndex = source.indexOf("audit !== 0");
    const rawIndex = source.indexOf(c.raw);

    assert.ok(auditIndex >= 0);
    assert.ok(gateIndex > auditIndex);
    assert.ok(rawIndex > gateIndex);
    assert.doesNotMatch(source, /DatabaseSync/);
    assert.equal(pkg.scripts?.[c.alias], `tsx ${c.entry}`);
  });
}
