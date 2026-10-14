import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// LINE の成績（今月・通算・日次まとめ）は、現行モデルの paper-live BUY の最新の判定行と、公式の確定結果だけで数える。
const ledgerSource = readFileSync(resolve(process.cwd(), "scripts/lib/buyLedger.ts"), "utf8");
const notifySource = readFileSync(resolve(process.cwd(), "scripts/notify-line.ts"), "utf8");

test("LINE の成績は現行モデルの paper-live BUY の最新行と、公式の確定結果だけで数える", () => {
  for (const source of [ledgerSource, notifySource]) {
    assert.match(source, /PARTITION BY dh\.race_id, dh\.bet_type, dh\.selection ORDER BY dh\.created_at DESC, dh\.id DESC/u);
    assert.match(source, /dh\.model_version = \?/u);
    assert.match(source, /dh\.run_kind = 'paper-live'/u);
    assert.match(source, /dh\.row_num = 1/u);
    assert.match(source, /LEFT JOIN race_results rr ON rr\.race_id = dh\.race_id/u);
  }
  // 精算は公式払戻があり、返還でないものだけ。
  assert.match(ledgerSource, /!row\.returned && row\.payout_yen != null/u);
  assert.match(notifySource, /loadBuyLedgers\(db, date\)/u);
});
