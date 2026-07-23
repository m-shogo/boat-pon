import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyResultNotification } from "./buyResultNotification";

test("BUY的中時に公式払戻と100円仮想損益を表示する", () => {
  const message = buildBuyResultNotification({
    venue: "津",
    raceNo: 6,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: "1-2-3",
    winningPayoutYen: 1_250,
    returned: false,
    currentOdds: 14.2,
  });

  assert.equal(message.status, "hit");
  assert.match(message.title, /🎯 的中/);
  assert.match(message.body, /公式払戻: 1,250円/);
  assert.match(message.body, /100円仮想損益: \+1,150円/);
});

test("BUY外れ時にも実着順と的中組の公式払戻を表示する", () => {
  const message = buildBuyResultNotification({
    venue: "丸亀",
    raceNo: 3,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: "1-6-4",
    winningPayoutYen: 5_090,
    returned: false,
    currentOdds: 28.5,
  });

  assert.equal(message.status, "miss");
  assert.match(message.title, /❌ 外れ/);
  assert.match(message.body, /実着順: 1-6-4/);
  assert.match(message.body, /公式払戻: 5,090円/);
  assert.match(message.body, /100円仮想損益: -100円/);
});

test("返還時は100円仮想損益を0円にする", () => {
  const message = buildBuyResultNotification({
    venue: "芦屋",
    raceNo: 1,
    betType: "trifecta",
    selection: "1-2-3",
    resultSelection: null,
    winningPayoutYen: null,
    returned: true,
    currentOdds: null,
  });

  assert.equal(message.status, "returned");
  assert.match(message.title, /↩️ 返還/);
  assert.match(message.body, /100円仮想損益: \+0円/);
});
