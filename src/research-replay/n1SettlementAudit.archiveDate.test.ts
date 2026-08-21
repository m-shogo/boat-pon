import assert from "node:assert/strict";
import test from "node:test";

import { archiveFallbackDate } from "./n1SettlementAudit";

test("archive audit accepts real archive dates including leap day", () => {
  assert.equal(archiveFallbackDate("/tmp/k280229.lzh"), "2028-02-29");
  assert.equal(archiveFallbackDate("/tmp/k991231.LZH"), "1999-12-31");
});

test("archive audit rejects impossible archive dates before parsing", () => {
  assert.throws(() => archiveFallbackDate("/tmp/k260230.lzh"));
  assert.throws(() => archiveFallbackDate("/tmp/k261332.lzh"));
});
