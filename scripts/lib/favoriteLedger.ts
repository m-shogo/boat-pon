/**
 * 本命予想（src/domain/favoritePick.ts）の記録と精算。v3 の BUY と並べて、LINE の日次・週次まとめで比べる。
 *
 * 記録: data/reports/scorecard/favorite-picks/YYYY-MM-DD.json（その日の締切5分前の全120通りがそろったレースごとに1点）。
 * 一度作った日のファイルは書き直さない（後から市場補正のパラメータが変わっても、その日の予想は変えない）。当日分は 21:10 以降だけ作る。
 * 精算: 公式の確定結果（race_results）。返還は除く。100 円ずつ買った場合として数える（購入の推奨ではない）。
 *
 * 性格（Codex のレビュー 2026-10-15）: 本命予想は通知していない「後から集計した参考」。使うオッズは収集の仕組み上すべて締切前
 * （締切1分前まで）に取れたものだが、BUY のように行動の締め切り（締切5分前）で固定した記録ではない。
 * 2026-10-15 より前の日は、その日の夜に作ったものではなく 10/15 に作った再構成（市場補正のパラメータは 6月のデータで決めて
 * 10/7 から固定している値で、7月以降の情報は入っていない）。ファイルの kind で区別する。
 */
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { summarizeBuyLedger, type BuyLedgerSummary, type BuyOutcome } from "../../src/domain/accuracyScorecard";
import { pickFavorite, type FavoritePick } from "../../src/domain/favoritePick";
import { addDays, DEFAULT_SCORECARD_STATE_DIR, loadChampionCalibration, loadCompleteCaptures, todayJst } from "./marketCaptures";

/** 締切5分前の全120通りがそろい始めた月（6月は 5% しかない）。 */
export const FAVORITE_FROM = "2026-07-01";

type DayFile = { date: string; generatedAt: string; kind: "nightly" | "reconstructed"; calibration: unknown; picks: FavoritePick[] };

/** この日より前の記録は、後から作った再構成。 */
const NIGHTLY_FROM = "2026-10-15";

const fileFor = (stateDir: string, date: string) => `${stateDir}/favorite-picks/${date}.json`;

function jstHourMinute(now: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** まだ記録が無い日の本命予想を作って保存する（DB は読むだけ）。作った日数を返す。 */
export function ensureFavoritePicks(db: DatabaseSync, toDate: string, stateDir = DEFAULT_SCORECARD_STATE_DIR, now = new Date()): number {
  const today = todayJst();
  const calibration = loadChampionCalibration(stateDir);
  let created = 0;
  for (let date = FAVORITE_FROM; date <= toDate; date = addDays(date, 1)) {
    if (date > today || (date === today && jstHourMinute(now) < "21:10")) break;
    const path = fileFor(stateDir, date);
    if (existsSync(path)) continue;
    const { t5, t10, t20 } = loadCompleteCaptures(db, date, date);
    const picks: FavoritePick[] = [];
    for (const [raceId, odds] of t5) {
      const pick = pickFavorite(raceId, odds, t10.get(raceId) ?? t20.get(raceId) ?? null, calibration);
      if (pick) picks.push(pick);
    }
    picks.sort((a, b) => a.raceId.localeCompare(b.raceId));
    mkdirSync(`${stateDir}/favorite-picks`, { recursive: true });
    const body: DayFile = { date, generatedAt: now.toISOString(), kind: date >= NIGHTLY_FROM ? "nightly" : "reconstructed", calibration, picks };
    // 実行ごとに別名の一時ファイルに書き、正式な名前には「まだ無いときだけ」置く（link は既にあれば失敗する）。
    // 2つの実行が同時に作っても、先に置いた方だけが残り、後の方は何も上書きしない（Codex のレビュー）。
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body)}\n`);
    try {
      linkSync(tmp, path);
      created += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(tmp);
    }
  }
  return created;
}

export type FavoriteLedgers = {
  /** いちばん最近の「本命予想があって、結果がそろった日」（ふつうは昨日）。 */
  lastSettledDay: { date: string; ledger: BuyLedgerSummary } | null;
  month: BuyLedgerSummary;
  total: BuyLedgerSummary;
  /** 期間を指定して集計する（週次まとめ用）。 */
  between: (from: string, to: string) => BuyLedgerSummary;
};

/** 保存済みの本命予想を、公式の確定結果で精算する。 */
export function loadFavoriteLedgers(db: DatabaseSync, today: string, stateDir = DEFAULT_SCORECARD_STATE_DIR): FavoriteLedgers {
  const picks: FavoritePick[] = [];
  for (let date = FAVORITE_FROM; date <= today; date = addDays(date, 1)) {
    const path = fileFor(stateDir, date);
    if (!existsSync(path)) continue;
    try { picks.push(...(JSON.parse(readFileSync(path, "utf8")) as DayFile).picks); } catch { /* 壊れたファイルは数えない */ }
  }
  const results = new Map((db.prepare(`SELECT race_id, trifecta, payout_yen, returned FROM race_results WHERE date >= ? AND date <= ?`)
    .all(FAVORITE_FROM, today) as Array<{ race_id: string; trifecta: string | null; payout_yen: number | null; returned: number | null }>)
    .map((r) => [r.race_id, r]));
  const outcomes: BuyOutcome[] = picks.map((pick) => {
    const date = `${pick.raceId.slice(0, 4)}-${pick.raceId.slice(4, 6)}-${pick.raceId.slice(6, 8)}`;
    const r = results.get(pick.raceId);
    const settled = r != null && r.trifecta != null && r.trifecta !== "" && !r.returned && r.payout_yen != null;
    return { date, hit: settled ? r!.trifecta === pick.selection : null, payoutYen: settled ? r!.payout_yen : null };
  });
  const month = today.slice(0, 7);
  let lastSettledDay: FavoriteLedgers["lastSettledDay"] = null;
  const dates = [...new Set(outcomes.map((o) => o.date))].filter((d) => d < today).sort().reverse();
  for (const date of dates) {
    const day = outcomes.filter((o) => o.date === date);
    // 中止などで結果の無いレースがあっても、9割以上そろっていればその日を出す
    if (day.filter((o) => o.hit != null).length >= day.length * 0.9) {
      lastSettledDay = { date, ledger: summarizeBuyLedger(day) };
      break;
    }
  }
  return {
    lastSettledDay,
    month: summarizeBuyLedger(outcomes.filter((o) => o.date.startsWith(month))),
    total: summarizeBuyLedger(outcomes),
    between: (from, to) => summarizeBuyLedger(outcomes.filter((o) => o.date >= from && o.date <= to)),
  };
}
