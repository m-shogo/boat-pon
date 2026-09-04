import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./n2MarketOnlyBaselinePrivateSource.ts", import.meta.url),
  "utf8",
);

test("market-only baseline private source binds JSON and raw reads to verified descriptors", () => {
  const jsonReaderStart = source.indexOf("function readJsonBounded<T>");
  const rawReaderStart = source.indexOf("let rawFd: number | null = null");
  const rawReaderEnd = source.indexOf("function openReadOnly", rawReaderStart);

  assert.ok(jsonReaderStart >= 0);
  assert.ok(rawReaderStart >= 0);
  assert.ok(rawReaderEnd > rawReaderStart);

  const jsonReader = source.slice(jsonReaderStart, source.indexOf("function sha256", jsonReaderStart));
  assert.match(jsonReader, /openSync\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/u);
  assert.match(jsonReader, /const stat = fstatSync\(fd\)/u);
  assert.match(jsonReader, /stat\.nlink !== 1/u);
  assert.match(jsonReader, /readFileSync\(fd, "utf8"\)/u);
  assert.match(jsonReader, /closeSync\(fd\)/u);
  assert.doesNotMatch(jsonReader, /readFileSync\(path/u);

  const rawReader = source.slice(rawReaderStart, rawReaderEnd);
  assert.match(rawReader, /openSync\(rawPath!, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/u);
  assert.match(rawReader, /const rawStat = fstatSync\(rawFd\)/u);
  assert.match(rawReader, /rawStat\.nlink !== 1/u);
  assert.match(rawReader, /const rawBytes = readFileSync\(rawFd\)/u);
  assert.match(rawReader, /closeSync\(rawFd\)/u);
  assert.doesNotMatch(rawReader, /readFileSync\(rawPath/u);
});
