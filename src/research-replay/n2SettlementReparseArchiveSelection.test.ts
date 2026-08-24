import assert from "node:assert/strict";
import test from "node:test";

import { assertN2SettlementReparseArchiveSelection } from "./n2SettlementReparseArchiveSelection";

test("reparse archive selection rejects an impossible date before bounded selection", () => {
  assert.throws(
    () => assertN2SettlementReparseArchiveSelection([
      "/archive/k260228.lzh",
      "/archive/k260230.lzh",
      "/archive/k260301.lzh",
    ]),
    /REPARSE_ARCHIVE_DATE_INVALID:k260230\.lzh/,
  );
});

test("reparse archive selection rejects duplicate checkpoint basenames before bounded selection", () => {
  assert.throws(
    () => assertN2SettlementReparseArchiveSelection([
      "/archive/a/k260228.lzh",
      "/archive/b/K260228.LZH",
    ]),
    /REPARSE_ARCHIVE_BASENAME_DUPLICATE:K260228\.LZH/,
  );
});

test("reparse archive selection accepts canonical unique archive dates", () => {
  assert.doesNotThrow(() => assertN2SettlementReparseArchiveSelection([
    "/archive/k240229.lzh",
    "/archive/k260228.lzh",
    "/archive/k260301.lzh",
  ]));
});
