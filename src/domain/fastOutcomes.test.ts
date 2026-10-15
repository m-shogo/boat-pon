import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { loadFastOutcomes } from "../../scripts/lib/buyLedger";
import { buildBuyResultNotification } from "./buyResultNotification";

// 速報の文面から精算する（確定結果の取り込みより前の日次まとめで使う）。文面の形が変わったら、ここで気づけるようにする。
test("速報の文面から、的中・はずれ・払戻を読む。払戻がわからない的中は精算しない", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE notification_log (race_id TEXT, channel TEXT, status TEXT, title TEXT, body TEXT)");
  const insert = (raceId: string, input: Parameters<typeof buildBuyResultNotification>[0], status = "SENT") => {
    const message = buildBuyResultNotification(input);
    db.prepare("INSERT INTO notification_log VALUES (?, 'line', ?, ?, ?)").run(`line-buy-result-fast-${raceId}`, status, `${message.title}（速報）`, message.body);
  };
  const base = { venue: "芦屋", raceNo: 6, betType: "3連単", selection: "1-2-3", returned: false, currentOdds: 75.4 };
  insert("20261015-芦屋-06", { ...base, resultSelection: "1-2-3", winningPayoutYen: 7_210 });
  insert("20261015-芦屋-08", { ...base, raceNo: 8, resultSelection: "2-1-3", winningPayoutYen: 1_980 });
  insert("20261015-津-04", { ...base, venue: "津", raceNo: 4, resultSelection: "1-2-3", winningPayoutYen: null });
  insert("20261015-津-05", { ...base, venue: "津", raceNo: 5, resultSelection: "1-2-3", winningPayoutYen: 900 }, "PENDING");

  const outcomes = loadFastOutcomes(db);
  assert.deepEqual(outcomes.get("20261015-芦屋-06"), { hit: true, payoutYen: 7_210 });
  assert.deepEqual(outcomes.get("20261015-芦屋-08"), { hit: false, payoutYen: null });
  assert.equal(outcomes.has("20261015-津-04"), false);
  assert.equal(outcomes.has("20261015-津-05"), false);
});
