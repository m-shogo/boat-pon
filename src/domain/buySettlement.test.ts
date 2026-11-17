import assert from "node:assert/strict";
import test from "node:test";
import { buildBuyResultNotification } from "./buyResultNotification";
import { isRefundStatus, NO_TRIFECTA_FACTS, parseFastResultNotification, refundBoatsFromEntries, settleTrifectaBuy, settlementOrFast, toBuyOutcome, type TrifectaFacts } from "./buySettlement";

const facts = (over: Partial<TrifectaFacts>): TrifectaFacts => ({ ...NO_TRIFECTA_FACTS, refundBoats: [], ...over });
const finished = (statuses: Array<string | null>) => statuses.map((statusCode, i) => ({ boat: i + 1, statusCode }));

test("精算: 払戻の行に買い目があれば的中、無ければ外れ", () => {
  const f = facts({ winners: [{ combination: "1-2-4", payoutYen: 280 }] });
  assert.deepEqual(settleTrifectaBuy("1-2-4", f), { status: "hit", payoutYen: 280, resultSelection: "1-2-4" });
  assert.deepEqual(settleTrifectaBuy("1-2-5", f), { status: "miss", payoutYen: 280, resultSelection: "1-2-4" });
});

test("精算: 買い目にフライングの艇があれば返還、無ければふつうに当たり外れ（2026-11-08 下関 3R: 3・5・6 号艇が F、結果 1-2-4）", () => {
  const f = facts({ winners: [{ combination: "1-2-4", payoutYen: 280 }], refundBoats: [3, 5, 6], legacyReturned: true });
  assert.equal(settleTrifectaBuy("1-2-3", f).status, "returned");
  assert.deepEqual(settleTrifectaBuy("1-2-4", f), { status: "hit", payoutYen: 280, resultSelection: "1-2-4" });
  assert.equal(settleTrifectaBuy("1-4-2", f).status, "miss");
});

test("精算: ほかの券種の特払いで古い「返還」の印が付いたレースも、3連単はふつうに当たり外れ（2024-01-07 津 8R: 全艇完走、結果 6-3-5）", () => {
  const f = facts({ winners: [{ combination: "6-3-5", payoutYen: 68210 }], refundBoats: [], legacyReturned: true });
  assert.equal(settleTrifectaBuy("1-2-3", f).status, "miss");
  assert.equal(settleTrifectaBuy("6-3-5", f).status, "hit");
});

test("精算: 同着の 2 つ目の当たりも的中（2025-01-04 津 2R: 1-2-3 と 1-2-4）", () => {
  const f = facts({ winners: [{ combination: "1-2-3", payoutYen: 280 }, { combination: "1-2-4", payoutYen: 390 }] });
  assert.deepEqual(settleTrifectaBuy("1-2-4", f), { status: "hit", payoutYen: 390, resultSelection: "1-2-4" });
  assert.deepEqual(settleTrifectaBuy("1-2-3", f), { status: "hit", payoutYen: 280, resultSelection: "1-2-3" });
  assert.equal(settleTrifectaBuy("1-3-2", f).status, "miss");
});

test("精算: 3連単が成立しなかったレースは全部返還。確定結果が無ければ結果待ち", () => {
  assert.deepEqual(settleTrifectaBuy("1-2-3", facts({ voided: true, refundBoats: [2, 4] })), { status: "returned", payoutYen: null, resultSelection: null });
  assert.equal(settleTrifectaBuy("1-3-5", facts({ voided: true, refundBoats: [2, 4] })).status, "returned");
  assert.equal(settleTrifectaBuy("1-2-3", NO_TRIFECTA_FACTS).status, "pending");
  assert.equal(settleTrifectaBuy("1-2-3", facts({})).status, "pending");
});

test("精算: 各艇の成績が無いときは、古い印に従う（的中だけは確かなので的中にする）", () => {
  const f: TrifectaFacts = { winners: [{ combination: "1-2-4", payoutYen: 280 }], refundBoats: null, voided: false, legacyReturned: true };
  assert.equal(settleTrifectaBuy("1-2-3", f).status, "returned");
  assert.equal(settleTrifectaBuy("1-2-4", f).status, "hit");
  assert.equal(settleTrifectaBuy("1-2-3", { ...f, legacyReturned: false }).status, "miss");
});

test("返還になる艇: F・L・K と、行の無い艇（欠場・進入の無い出遅れ）。失格（S）は返還にならない", () => {
  assert.equal(isRefundStatus("F"), true);
  assert.equal(isRefundStatus("L0"), true);
  assert.equal(isRefundStatus("K1"), true);
  assert.equal(isRefundStatus("S1"), false);
  assert.equal(isRefundStatus(null), false);
  assert.deepEqual(refundBoatsFromEntries(finished([null, null, "F", null, "S0", "L1"])), [3, 6]);
  // 2026-06-01 下関 11R: 6 号艇が欠場（K0）で、行が入っていない
  assert.deepEqual(refundBoatsFromEntries(finished([null, null, null, null, null])), [6]);
  assert.equal(refundBoatsFromEntries([]), null);
});

test("速報の通知文から結論を読み戻せる（的中・はずれ・返還）。確定が無いときだけ速報を使う", () => {
  const base = { venue: "下関", raceNo: 3, betType: "trifecta", selection: "1-2-3", currentOdds: 4.2 };
  const notify = (resultSelection: string | null, winningPayoutYen: number | null, returned: boolean) => {
    const m = buildBuyResultNotification({ ...base, resultSelection, winningPayoutYen, returned });
    return parseFastResultNotification(`${m.title}（速報）`, `${m.body}\n確定は翌日の取り込みで再確認します。`);
  };
  assert.deepEqual(notify("1-2-3", 420, false), { status: "hit", payoutYen: 420, resultSelection: "1-2-3" });
  assert.deepEqual(notify("1-2-4", 280, false), { status: "miss", payoutYen: null, resultSelection: "1-2-4" });
  assert.deepEqual(notify("1-2-4", null, true), { status: "returned", payoutYen: null, resultSelection: "1-2-4" });
  assert.equal(parseFastResultNotification(null, null), null);

  const pending = settleTrifectaBuy("1-2-3", NO_TRIFECTA_FACTS);
  assert.equal(settlementOrFast(pending, notify("1-2-4", 280, false)).status, "miss");
  assert.equal(settlementOrFast(pending, null).status, "pending");
  // 確定があれば確定が勝つ（速報は「はずれ」、確定は買い目の艇のフライングで「返還」）
  const confirmed = settleTrifectaBuy("1-2-3", facts({ winners: [{ combination: "1-2-4", payoutYen: 280 }], refundBoats: [3] }));
  assert.equal(settlementOrFast(confirmed, notify("1-2-4", 280, false)).status, "returned");
});

test("成績に渡す形: 返還・結果待ち・払戻のわからない的中は未精算", () => {
  assert.deepEqual(toBuyOutcome("2026-11-18", { status: "hit", payoutYen: 420, resultSelection: "1-2-3" }), { date: "2026-11-18", hit: true, payoutYen: 420, returned: false });
  assert.deepEqual(toBuyOutcome("2026-11-18", { status: "miss", payoutYen: 280, resultSelection: "1-2-4" }), { date: "2026-11-18", hit: false, payoutYen: null, returned: false });
  assert.deepEqual(toBuyOutcome("2026-11-18", { status: "returned", payoutYen: null, resultSelection: null }), { date: "2026-11-18", hit: null, payoutYen: null, returned: true });
  assert.equal(toBuyOutcome("2026-11-18", { status: "hit", payoutYen: null, resultSelection: "1-2-3" }).hit, null);
  assert.equal(toBuyOutcome("2026-11-18", { status: "pending", payoutYen: null, resultSelection: null }).hit, null);
});
