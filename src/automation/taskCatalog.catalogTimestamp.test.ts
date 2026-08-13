import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_SCHEMA_VERSION, validateCatalog } from "./taskCatalog";

function catalog(updatedAt: string) {
  return {
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: "v1",
    updatedAt,
    tasks: [],
  };
}

test("catalog timestamp rejects malformed and impossible Gregorian dates", () => {
  for (const updatedAt of [
    "not-a-time",
    "2026-08-10",
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00+09:00",
  ]) {
    assert.equal(validateCatalog(catalog(updatedAt)).valid, false, updatedAt);
  }
});

test("catalog timestamp preserves valid leap-day offsets", () => {
  assert.equal(validateCatalog(catalog("2028-02-29T10:38:22+09:00")).valid, true);
});
