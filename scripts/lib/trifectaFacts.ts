/**
 * 3連単の精算に使う事実（払戻の行・返還の艇・不成立）を DB から読む（読み取りだけ）。
 * 決め方は src/domain/buySettlement.ts の settleTrifectaBuy。通知・財布・スコアカードが同じものを使う。
 */
import type { DatabaseSync } from "node:sqlite";
import { refundBoatsFromEntries, type TrifectaFacts } from "../../src/domain/buySettlement";

export function loadTrifectaFacts(db: DatabaseSync, raceIds: Iterable<string>): Map<string, TrifectaFacts> {
  const resultStmt = db.prepare("SELECT trifecta, payout_yen, returned FROM race_results WHERE race_id = ?");
  // 同着の 2 つ目の払戻は払戻表にだけある（結果表は 1 レース 1 行）。特払いは当たりの組番ではないので除く（3連単では 2010 年以降 0 件）。
  const payoutStmt = db.prepare("SELECT combination, payout_yen FROM race_payouts WHERE race_id = ? AND bet_type = 'trifecta' AND combination != '特払' ORDER BY rowid");
  const entryStmt = db.prepare("SELECT boat, status_code FROM race_entries WHERE race_id = ?");
  const facts = new Map<string, TrifectaFacts>();
  for (const raceId of new Set(raceIds)) {
    const result = resultStmt.get(raceId) as { trifecta: string | null; payout_yen: number | null; returned: number | null } | undefined;
    const winners: TrifectaFacts["winners"] = [];
    if (result?.trifecta) winners.push({ combination: result.trifecta, payoutYen: result.payout_yen });
    for (const row of payoutStmt.all(raceId) as Array<{ combination: string; payout_yen: number | null }>) {
      if (!winners.some((w) => w.combination === row.combination)) winners.push({ combination: row.combination, payoutYen: row.payout_yen });
    }
    const entries = (entryStmt.all(raceId) as Array<{ boat: number; status_code: string | null }>).map((e) => ({ boat: e.boat, statusCode: e.status_code }));
    facts.set(raceId, {
      winners,
      refundBoats: refundBoatsFromEntries(entries),
      // 各艇の成績は入っているのに 3連単の払戻が無い = レース不成立・3連単不成立（各艇の成績と払戻は同じ取り込みで入る）
      voided: entries.length > 0 && winners.length === 0,
      legacyReturned: !!result?.returned,
    });
  }
  return facts;
}
