/**
 * LINE 通知に載せる成績（今月・通算・判定を締め切りで固定した後・直近で結果がそろった日）を読む共通処理（読み取り専用）。
 * 精算は公式の確定結果（race_results）。速報で結果がわかっているレースは extraOutcomes で上書きできる。
 */
import type { DatabaseSync } from "node:sqlite";
import { classifyBuyTiming, summarizeBuyLedger, type BuyLedgerSummary, type BuyOutcome } from "../../src/domain/accuracyScorecard";
import { LIVE_MONITOR_MODEL_VERSION } from "../../src/domain/liveMonitor";

/** auto-odds が行動の締め切りで判定を固定するようになった後、丸1日を新しい判定で回した最初の日。 */
export const LIVE_RECORD_FIX_DATE = "2026-10-10";

type Row = { race_id: string; date: string; selection: string; trifecta: string | null; payout_yen: number | null; returned: number | null; close_at: string | null; sent_at: string | null; info_at: string | null };

export type BuyLedgers = {
  month: BuyLedgerSummary;
  total: BuyLedgerSummary;
  sinceFix: { from: string; ledger: BuyLedgerSummary; notified: number };
  lastSettledDay: { date: string; ledger: BuyLedgerSummary } | null;
};

export function loadBuyLedgers(
  db: DatabaseSync,
  today: string,
  extraOutcomes: Map<string, { hit: boolean; payoutYen: number | null }> = new Map(),
): BuyLedgers {
  // 同じレース・券種・買い目の判定行が複数あっても、最新の1行だけを数える。
  const rows = db.prepare(`
WITH buy_rows AS (
  SELECT dh.*,
    ROW_NUMBER() OVER (PARTITION BY dh.race_id, dh.bet_type, dh.selection ORDER BY dh.created_at DESC, dh.id DESC) AS row_num
  FROM decision_history dh
  WHERE dh.decision = 'BUY' AND dh.run_kind = 'paper-live' AND dh.model_version = ? AND dh.date <= ?
)
SELECT dh.race_id, dh.date, dh.selection, rr.trifecta, rr.payout_yen, rr.returned, p.close_at,
  (SELECT n.sent_at FROM notification_log n WHERE n.race_id = dh.race_id AND n.channel = 'line' AND n.status = 'SENT') AS sent_at,
  (SELECT MIN(e.fetched_at) FROM exhibition_data e WHERE e.race_id = dh.race_id) AS info_at
FROM buy_rows dh
LEFT JOIN race_results rr ON rr.race_id = dh.race_id
LEFT JOIN official_programs p ON p.race_id = dh.race_id
WHERE dh.row_num = 1
`).all(LIVE_MONITOR_MODEL_VERSION, today) as Row[];

  const outcome = (row: Row): BuyOutcome => {
    const extra = extraOutcomes.get(row.race_id);
    if (extra) return { date: row.date, hit: extra.hit, payoutYen: extra.payoutYen };
    const settled = row.trifecta != null && row.trifecta !== "" && !row.returned && row.payout_yen != null;
    return { date: row.date, hit: settled ? row.trifecta === row.selection : null, payoutYen: row.payout_yen };
  };
  const month = today.slice(0, 7);
  const sinceFixRows = rows.filter((row) => row.date >= LIVE_RECORD_FIX_DATE);
  const notified = sinceFixRows.filter((row) => classifyBuyTiming({ date: row.date, closeAt: row.close_at, sentAt: row.sent_at, infoAt: row.info_at }) === "notified").length;

  // 直近で「BUY があって、全部の結果がそろった日」。ふつうは昨日。
  const dates = [...new Set(rows.map((row) => row.date))].filter((date) => date < today).sort().reverse();
  let lastSettledDay: BuyLedgers["lastSettledDay"] = null;
  for (const date of dates) {
    const dayOutcomes = rows.filter((row) => row.date === date).map(outcome);
    if (dayOutcomes.every((o) => o.hit != null)) {
      lastSettledDay = { date, ledger: summarizeBuyLedger(dayOutcomes) };
      break;
    }
  }

  return {
    month: summarizeBuyLedger(rows.filter((row) => row.date.startsWith(month)).map(outcome)),
    total: summarizeBuyLedger(rows.map(outcome)),
    sinceFix: { from: LIVE_RECORD_FIX_DATE, ledger: summarizeBuyLedger(sinceFixRows.map(outcome)), notified },
    lastSettledDay,
  };
}
