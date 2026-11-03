import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = JSON.parse(readFileSync("config/research-governance/forward-evaluation-vault.schema.json", "utf8")) as {
  $defs: Record<string, { pattern: string }>;
};

test("Forward Vault schema exactInstant and digest patterns reject terminal newline", () => {
  const examples: ReadonlyArray<readonly [string, string]> = [
    ["exactInstant", "2026-11-03T01:00:00Z"],
    ["digest", "a".repeat(64)],
  ];
  for (const [field, canonical] of examples) {
    const pattern = new RegExp(schema.$defs[field]!.pattern);
    assert.equal(pattern.test(canonical), true, field);
    for (const suffix of ["\n", "\r\n", "\u2028", "\u2029"]) {
      assert.equal(pattern.test(canonical + suffix), false, field + " terminal suffix " + JSON.stringify(suffix));
    }
  }
});
