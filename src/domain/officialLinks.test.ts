import assert from "node:assert/strict";
import test from "node:test";
import { officialOddsUrl, teleBoatUrl } from "./officialLinks";

test("公式オッズURLは日付・場コード・R番号を含む", () => {
  assert.equal(
    officialOddsUrl("2026-07-20", "津", 6),
    "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=6&jcd=09&hd=20260720",
  );
});

test("投票URLは公式のシンプル投票サイト入口を返す", () => {
  assert.equal(teleBoatUrl("2026-07-20", "津", 6), "https://bu.tbbr.jp/");
});
