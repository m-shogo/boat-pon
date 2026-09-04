import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./n2MarketBaselineReadinessReader.ts", import.meta.url),
  "utf8",
);

test("readiness accepted-marker bytes stay bound to a verified no-follow descriptor", () => {
  const helperStart = source.indexOf("function readBoundedTextNoFollow");
  const helperEnd = source.indexOf("function parseIso", helperStart);
  const markerStart = source.indexOf("const markerText = readBoundedTextNoFollow");
  const markerEnd = source.indexOf("const blockers: string[] = []", markerStart);

  assert.ok(helperStart >= 0);
  assert.ok(helperEnd > helperStart);
  assert.ok(markerStart >= 0);
  assert.ok(markerEnd > markerStart);

  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /openSync\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/u);
  assert.match(helper, /const stat = fstatSync\(fd\)/u);
  assert.match(helper, /stat\.nlink !== 1/u);
  assert.match(helper, /readFileSync\(fd, "utf8"\)/u);
  assert.match(helper, /closeSync\(fd\)/u);
  assert.doesNotMatch(helper, /readFileSync\(path/u);

  const markerRead = source.slice(markerStart, markerEnd);
  assert.match(markerRead, /readBoundedTextNoFollow\(markerPath, MAX_MARKER_BYTES\)/u);
  assert.doesNotMatch(markerRead, /readFileSync\(markerPath/u);
});
