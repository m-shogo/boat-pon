import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "src/research-replay/n2TrifectaPrivateMarketFeatureLoader.ts"),
  "utf8",
);

test("private market feature loader rechecks single-link identity before private reads", () => {
  const jsonReaderStart = source.indexOf("function readJsonBounded<T>");
  const rawReaderStart = source.indexOf("const rawStat = lstatSync(rawPath)");
  const rawReadStart = source.indexOf("const rawBytes = readFileSync(rawPath)");

  assert.ok(jsonReaderStart >= 0);
  assert.ok(rawReaderStart >= 0);
  assert.ok(rawReadStart > rawReaderStart);

  const jsonReader = source.slice(jsonReaderStart, source.indexOf("function sha256", jsonReaderStart));
  assert.match(jsonReader, /stat\.nlink !== 1/u);
  assert.match(jsonReader, /PRIVATE_JSON_HARDLINK_NOT_ALLOWED/u);
  assert.ok(jsonReader.indexOf("stat.nlink !== 1") < jsonReader.indexOf("readFileSync(path"));

  const rawReader = source.slice(rawReaderStart, rawReadStart);
  assert.match(rawReader, /rawStat\.nlink !== 1/u);
  assert.match(rawReader, /PRIVATE_RAW_HARDLINK_NOT_ALLOWED/u);
});
