import assert from "node:assert/strict";
import test from "node:test";
import { categorizeProgram } from "./programCategory";

test("SG/G1/G3などの番組カテゴリを推定する", () => {
  assert.equal(categorizeProgram("SG ボートレースダービー 優勝戦").primary, "SG");
  assert.equal(categorizeProgram("GIII オールレディース").primary, "G3");
  assert.ok(categorizeProgram("GIII オールレディース").tags.includes("女子"));
});

test("企画番組や進入固定をタグ化する", () => {
  const result = categorizeProgram("進入固定 アシ夢特選");
  assert.equal(result.primary, "進入固定");
  assert.ok(result.tags.includes("企画"));
});
