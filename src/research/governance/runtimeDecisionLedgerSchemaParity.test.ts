import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Research-only schema assertions, including consumers without format assertion.
const schema = JSON.parse(readFileSync("config/research-governance/runtime-decision-ledger.schema.json", "utf8")) as {
  $defs: { exactInstant: { pattern: string; allOf: Array<{ not?: { pattern: string }; if?: { pattern: string }; then?: { pattern: string } }> } };
  properties: Record<string, unknown>;
};
const expectedNonblank = "[^\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";

function collectNonblank(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectNonblank);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  const own = node.type === "string" && node.minLength === 1
    ? [typeof node.pattern === "string" ? node.pattern : ""] : [];
  return [...own, ...Object.values(node).flatMap(collectNonblank)];
}

function acceptsDate(value: string): boolean {
  const exact = schema.$defs.exactInstant;
  if (!new RegExp(exact.pattern, "u").test(value)) return false;
  return exact.allOf.every((guard) => {
    if (guard.not) return !new RegExp(guard.not.pattern, "u").test(value);
    if (guard.if && new RegExp(guard.if.pattern, "u").test(value))
      return !!guard.then && new RegExp(guard.then.pattern, "u").test(value);
    return true;
  });
}

test("K1 nonblank schema matches JavaScript trim on Unicode boundaries", () => {
  const patterns = collectNonblank(schema);
  assert.equal(patterns.length, 15);
  const points = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
    ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    0x85, 0x180e, 0x200b, 0x61, 0x30, 0x1f600];
  const probes = ["", "  ", ...points.map((cp) => String.fromCodePoint(cp)), "\uFEFF\u0085", "\u0085\uFEFF"];
  for (const pattern of patterns) {
    assert.equal(pattern, expectedNonblank);
    for (const probe of probes) assert.equal(new RegExp(pattern, "u").test(probe), probe.trim().length > 0);
  }
});

test("K1 schema-only Gregorian calendar checks reject rollover and century errors", () => {
  assert.equal(schema.$defs.exactInstant.allOf.length, 3);
  for (const day of ["2026-02-30", "2025-02-29", "1900-02-29", "2100-02-29",
    "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31", "0000-02-29"]) {
    assert.equal(acceptsDate(day + "T12:00:00Z"), false, day);
  }
  for (const day of ["2024-02-29", "2000-02-29", "2400-02-29", "2026-02-28",
    "2026-04-30", "2026-12-31", "0004-02-29", "9996-02-29"]) {
    assert.equal(acceptsDate(day + "T12:00:00Z"), true, day);
  }
});
