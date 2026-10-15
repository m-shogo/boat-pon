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
  insert("20261015-津-06", { ...base, venue: "津", raceNo: 6, resultSelection: "3-2-1", winningPayoutYen: 5_000 }, "IN_SUMMARY");

  const outcomes = loadFastOutcomes(db);
  assert.deepEqual(outcomes.get("20261015-芦屋-06"), { hit: true, payoutYen: 7_210, selection: "1-2-3" });
  assert.deepEqual(outcomes.get("20261015-芦屋-08"), { hit: false, payoutYen: null, selection: "1-2-3" });
  assert.equal(outcomes.has("20261015-津-04"), false);
  assert.equal(outcomes.has("20261015-津-05"), false);
  // 21:30 のはずれは送らずに日次まとめへ（IN_SUMMARY）。精算には使う
  assert.deepEqual(outcomes.get("20261015-津-06"), { hit: false, payoutYen: null, selection: "1-2-3" });
});

test("収支: 確定結果を優先し、無ければ速報で精算する。速報は同じ買い目にだけ当てはめる", async () => {
  const { loadBuyLedgers } = await import("../../scripts/lib/buyLedger");
  const { LIVE_MONITOR_MODEL_VERSION } = await import("./liveMonitor");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE decision_history (id INTEGER PRIMARY KEY, race_id TEXT, date TEXT, bet_type TEXT, selection TEXT, decision TEXT, run_kind TEXT, model_version TEXT, created_at TEXT);
    CREATE TABLE race_results (race_id TEXT, trifecta TEXT, payout_yen INTEGER, returned INTEGER);
    CREATE TABLE official_programs (race_id TEXT, close_at TEXT);
    CREATE TABLE notification_log (race_id TEXT, channel TEXT, status TEXT, title TEXT, body TEXT, sent_at TEXT);
    CREATE TABLE exhibition_data (race_id TEXT, fetched_at TEXT);
  `);
  const buy = (raceId: string, selection: string) => db.prepare(
    "INSERT INTO decision_history (race_id, date, bet_type, selection, decision, run_kind, model_version, created_at) VALUES (?, '2026-10-15', 'trifecta', ?, 'BUY', 'paper-live', ?, '2026-10-15 01:00:00')",
  ).run(raceId, selection, LIVE_MONITOR_MODEL_VERSION);
  buy("20261015-芦屋-06", "1-2-3");
  buy("20261015-芦屋-06", "1-3-2"); // 同じレースの別の買い目（速報は 1-2-3 のもの）
  buy("20261015-津-04", "1-2-3");
  db.prepare("INSERT INTO race_results VALUES ('20261015-津-04', '1-2-3', 900, 0)").run();
  db.prepare("INSERT INTO notification_log VALUES ('line-buy-result-fast-20261015-津-04', 'line', 'SENT', ?, ?, '2026-10-15 03:00:00')")
    .run("❌ はずれ 津4R（速報）", "買い目: 1-2-3（3連単）\n実着順: 6-5-4\n");

  const extra = new Map([["20261015-芦屋-06", { hit: true, payoutYen: 7_210, selection: "1-2-3" }]]);
  const ledgers = loadBuyLedgers(db, "2026-10-15", new Map([...extra]));
  // 芦屋 1-2-3 は速報で的中、芦屋 1-3-2 は未精算、津は確定結果（的中 900円）が速報（はずれ）より優先
  assert.equal(ledgers.total.buys, 3);
  assert.equal(ledgers.total.settled, 2);
  assert.equal(ledgers.total.hits, 2);
  assert.equal(Math.round((ledgers.total.officialRoi ?? 0) * 200), 8_110);
});
