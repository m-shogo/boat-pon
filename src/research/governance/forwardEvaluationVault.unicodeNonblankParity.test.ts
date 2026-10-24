import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// JSON Schema consumers must agree with ECMAScript trim, including U+FEFF and U+0085.
const schema = JSON.parse(readFileSync("config/research-governance/forward-evaluation-vault.schema.json", "utf8")) as unknown;
function nonblankPatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(nonblankPatterns);
  if (value === null || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  const here = obj.type === "string" && obj.minLength === 1 ? [typeof obj.pattern === "string" ? obj.pattern : ""] : [];
  return [...here, ...Object.values(obj).flatMap(nonblankPatterns)];
}
const portablePattern = String.raw`[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`;
const whitespace = [...Array.from({length:5},(_,i)=>i+9),0x20,0xA0,0x1680,...Array.from({length:11},(_,i)=>i+0x2000),0x2028,0x2029,0x202F,0x205F,0x3000,0xFEFF];
const nonWhitespace = [0x85,0x180E,0x200B,0x61,0x30,0x1F600];

test("all 23 nonblank constraints match JavaScript trim at Unicode boundaries", () => {
  const patterns = nonblankPatterns(schema);
  assert.equal(patterns.length, 23);
  const probes = ["", " ", "\t\n", "\uFEFF", "\u0085", "\uFEFF\u0085", "\u0085\uFEFF", "\uFEFFx\uFEFF",
    ...whitespace.map(cp => String.fromCodePoint(cp)), ...nonWhitespace.map(cp => String.fromCodePoint(cp))];
  for (const pattern of patterns) {
    assert.equal(pattern, portablePattern);
    const re = new RegExp(pattern, "u");
    for (const value of probes) assert.equal(re.test(value), value.trim().length > 0);
  }
  assert.equal("\uFEFF".trim().length, 0);
  assert.equal("\u0085".trim().length, 1);
});
