import assert from "node:assert/strict";
import test from "node:test";
import { checkWriteScope } from "./executorSdk.js";

test("write allowlist rejects sibling-prefix directories", () => {
  for (const allowed of ["reports/n2", "reports/n2/"]) {
    assert.equal(checkWriteScope(["reports/n2-escape/record.json"], [allowed]).ok, false);
    assert.equal(checkWriteScope(["reports/n2/record.json"], [allowed]).ok, true);
  }
});

test("write allowlist rejects exact-file suffixes", () => {
  assert.equal(checkWriteScope(["reports/n2/record.json.backup"], ["reports/n2/record.json"]).ok, false);
  assert.equal(checkWriteScope(["reports/n2/record.json"], ["reports/n2/record.json"]).ok, true);
});

test("one escaped output blocks the entire batch", () => {
  const result = checkWriteScope(["reports/n2/ok.json", "reports/n2-escape/bad.json"], ["reports/n2"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations, ["reports/n2-escape/bad.json"]);
});

test("absolute and traversal paths remain blocked", () => {
  for (const path of ["/reports/n2/x.json", "reports/n2/../x.json"]) {
    assert.equal(checkWriteScope([path], ["reports/n2"]).ok, false);
  }
});
