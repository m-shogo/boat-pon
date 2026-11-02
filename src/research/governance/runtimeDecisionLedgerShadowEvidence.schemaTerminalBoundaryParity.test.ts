import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Draft 2020-12 format can be annotation-only. Python re.search accepts a
// final LF before '$' even though ECMAScript RegExp.test does not. Require a
// portable exact-end assertion for schema-only consumers in both engines.
// This proves lexical spelling, not Gregorian validity, issuer trust or time authority.
const schema = JSON.parse(readFileSync(
  new URL("../../../config/research-governance/runtime-decision-ledger-shadow-evidence.schema.json", import.meta.url),
  "utf8",
)) as {
  properties: {
    generatedAt: { pattern: string };
    scope: { properties: { from: { pattern: string }; to: { pattern: string } } };
  };
  $defs: { sha256: { pattern: string } };
};

const exactEnd = String.raw`(?![\s\S])`;
const rules: ReadonlyArray<readonly [string, string, string]> = [
  ["generatedAt", schema.properties.generatedAt.pattern, "2026-08-05T08:10:00.000Z"],
  ["scope.from", schema.properties.scope.properties.from.pattern, "2026-08-05"],
  ["scope.to", schema.properties.scope.properties.to.pattern, "2026-08-05"],
  ["sha256", schema.$defs.sha256.pattern, "a".repeat(64)],
];

test("shadow schema terminal boundaries use portable exact end, not Python-dollar final-LF admission", () => {
  for (const [name, pattern, valid] of rules) {
    assert.equal(pattern.endsWith(exactEnd), true, name);
    assert.equal(pattern.endsWith("$"), false, name);
    const lexical = new RegExp(pattern, "u");
    assert.equal(lexical.test(valid), true, name + ": valid");
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029", " ", "\u0085"]) {
      assert.equal(lexical.test(valid + suffix), false, name + ": " + JSON.stringify(suffix));
    }
  }
});

test("shadow schema exact-end guard keeps normal negative and valid synthetic controls", () => {
  assert.equal(new RegExp(schema.properties.generatedAt.pattern, "u").test("2026-08-05T08:10:00Z"), false);
  assert.equal(new RegExp(schema.properties.scope.properties.from.pattern, "u").test("2026-13-05"), false);
  assert.equal(new RegExp(schema.$defs.sha256.pattern, "u").test("A".repeat(64)), false);
  assert.equal(new RegExp(schema.$defs.sha256.pattern, "u").test("a".repeat(63)), false);
  assert.equal(schema.properties.scope.properties.from.pattern, schema.properties.scope.properties.to.pattern);
});
