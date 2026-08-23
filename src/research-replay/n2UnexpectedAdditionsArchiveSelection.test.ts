import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUnexpectedAdditionsLimit,
  selectUnexpectedAdditionsArchives,
} from "./n2UnexpectedAdditionsArchiveSelection";

test("unexpected-additions scan requires a positive safe integer limit", () => {
  assert.equal(parseUnexpectedAdditionsLimit(null), null);
  assert.equal(parseUnexpectedAdditionsLimit("1"), 1);
  for (const invalid of ["0", "-1", "1.5", "NaN", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => parseUnexpectedAdditionsLimit(invalid),
      /N2_UNEXPECTED_ADDITIONS_LIMIT_INVALID/,
      invalid,
    );
  }
});

test("unexpected-additions scan validates archive dates before applying limit", () => {
  const files = [
    "/archive/k260101.lzh",
    "/archive/k260230.lzh",
    "/archive/k260102.lzh",
  ];
  assert.throws(
    () => selectUnexpectedAdditionsArchives(files, 1),
    /invalid JST race date/,
  );
});

test("unexpected-additions scan preserves valid bounded ordering", () => {
  const files = ["/archive/k280229.lzh", "/archive/k280301.lzh"];
  assert.deepEqual(selectUnexpectedAdditionsArchives(files, 1), [files[0]]);
  assert.deepEqual(selectUnexpectedAdditionsArchives(files, null), files);
});
