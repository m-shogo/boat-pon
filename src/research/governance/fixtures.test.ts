import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { checkLineage, validateAllRegistries } from "./registryStore";

// リポジトリ同梱の例 lineage fixture が常に valid かつ lineage 完全であることを保証する。
const FIX = join(process.cwd(), "research/fixtures/example-lineage");

test("example-lineage fixtures validate and are lineage-complete", { skip: !existsSync(FIX) }, () => {
  const v = validateAllRegistries(FIX);
  assert.deepEqual(v.problems, []);
  assert.equal(v.ok, true);
  const l = checkLineage(FIX);
  assert.deepEqual(l.problems, []);
  assert.equal(l.ok, true);
});
