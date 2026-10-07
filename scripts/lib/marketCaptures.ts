/**
 * オッズ時系列から「完全な120通り」のスナップショットを読む共通処理（読み取り専用）。
 * T-5 は締切時刻との整合も要求する（scripts/analyze-t5-residual-forward.ts と同じ条件）。
 * 1ラベルずつ問い合わせる。3ラベルを1回の GROUP BY にまとめると、実測でかえって遅かった（2026-10-08）。
 */
import type { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { MARKET_CALIBRATION, type MarketCalibration, type MarketRace } from "../../src/domain/accuracyScorecard";
import { n2CanonicalT5CompleteCaptureSelectionHavingSql } from "../../src/research-replay/n2T5CompleteCaptureSelectionSql";
import { n2CanonicalT5ForwardCaptureTimingHavingSql } from "../../src/research-replay/n2T5ForwardCaptureTimingSql";
import { isCanonicalT5TrifectaResult } from "../../src/research-replay/t5MarketBaselineResult";
import { isCanonicalT5CompleteMarketSelections } from "../../src/research-replay/t5ResidualForwardMarket";

export type OddsMap = Map<string, number>;
type OddsRow = { race_id: string; selection: string; odds: number };

const selectionHaving = n2CanonicalT5CompleteCaptureSelectionHavingSql("selection");
const timingHaving = n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close");

export const DEFAULT_SCORECARD_STATE_DIR = "data/reports/scorecard";

function latestCompleteCapture(db: DatabaseSync, fromId: string, toIdExclusive: string, label: string, extraHaving: string) {
  return db.prepare(`WITH cc AS (SELECT race_id, captured_at, MAX(id) max_id FROM odds_timeseries_snapshots
      WHERE race_id >= ? AND race_id < ? AND checkpoint_label = ? GROUP BY race_id, captured_at HAVING ${selectionHaving}${extraHaving}),
    lc AS (SELECT race_id, MAX(max_id) max_id FROM cc GROUP BY race_id),
    ch AS (SELECT c.race_id, c.captured_at FROM cc c JOIN lc l ON l.race_id = c.race_id AND l.max_id = c.max_id)
    SELECT o.race_id, o.selection, o.odds FROM odds_timeseries_snapshots o JOIN ch c ON c.race_id = o.race_id AND c.captured_at = o.captured_at
    WHERE o.checkpoint_label = ?`).all(fromId, toIdExclusive, label, label) as OddsRow[];
}

function groupByRace(rows: OddsRow[]) {
  const map = new Map<string, OddsMap>();
  for (const row of rows) {
    let race = map.get(row.race_id);
    if (!race) map.set(row.race_id, (race = new Map()));
    race.set(row.selection, row.odds);
  }
  for (const [raceId, odds] of map) if (!isCanonicalT5CompleteMarketSelections(odds.keys())) map.delete(raceId);
  return map;
}

/** fromDate〜toDate（JST の日付、両端含む）の T-5 / T-10 / T-20 完全スナップショット。 */
export function loadCompleteCaptures(db: DatabaseSync, fromDate: string, toDate: string) {
  const fromId = fromDate.replaceAll("-", "");
  const toId = addDays(toDate, 1).replaceAll("-", "");
  return {
    t5: groupByRace(latestCompleteCapture(db, fromId, toId, "T-5", ` AND ${timingHaving}`)),
    t10: groupByRace(latestCompleteCapture(db, fromId, toId, "T-10", "")),
    t20: groupByRace(latestCompleteCapture(db, fromId, toId, "T-20", "")),
  };
}

/** 学習・評価用: T-5 完全市場と確定した3連単（返還なし）がそろったレース。直前は T-10、無ければ T-20。 */
export function loadMarketRaces(db: DatabaseSync, fromDate: string, toDate: string): MarketRace[] {
  const { t5, t10, t20 } = loadCompleteCaptures(db, fromDate, toDate);
  const results = db.prepare(`SELECT race_id, date, trifecta FROM race_results
    WHERE date >= ? AND date <= ? AND trifecta IS NOT NULL AND COALESCE(returned, 0) = 0`).all(fromDate, toDate) as Array<{ race_id: string; date: string; trifecta: string }>;
  const races: MarketRace[] = [];
  for (const r of results) {
    const odds = t5.get(r.race_id);
    if (!odds || !isCanonicalT5TrifectaResult(r.trifecta) || !odds.has(r.trifecta)) continue;
    races.push({ date: r.date, winner: r.trifecta, t5Odds: odds, earlierOdds: t10.get(r.race_id) ?? t20.get(r.race_id) ?? null });
  }
  return races.sort((a, b) => a.date.localeCompare(b.date));
}

/** BUY 通知用: そのレースの最新の完全スナップショットと、その1つ前。 */
export function loadLatestCapturesForRace(db: DatabaseSync, raceId: string): { latest: OddsMap | null; earlier: OddsMap | null } {
  const captures = db.prepare(`SELECT captured_at FROM odds_timeseries_snapshots WHERE race_id = ?
    GROUP BY captured_at HAVING ${selectionHaving} ORDER BY captured_at DESC LIMIT 2`).all(raceId) as Array<{ captured_at: string }>;
  const load = (capturedAt: string | undefined) => {
    if (!capturedAt) return null;
    const rows = db.prepare(`SELECT selection, odds FROM odds_timeseries_snapshots WHERE race_id = ? AND captured_at = ?`).all(raceId, capturedAt) as Array<{ selection: string; odds: number }>;
    const odds = new Map(rows.map((row) => [row.selection, row.odds]));
    return isCanonicalT5CompleteMarketSelections(odds.keys()) ? odds : null;
  };
  return { latest: load(captures[0]?.captured_at), earlier: load(captures[1]?.captured_at) };
}

/** 週次の改善処理で入れ替わった市場補正パラメータ。ファイルが無い・壊れているときは初期値。 */
export function loadChampionCalibration(stateDir = DEFAULT_SCORECARD_STATE_DIR): MarketCalibration & { source: string } {
  const path = `${stateDir}/champion.json`;
  if (!existsSync(path)) return { ...MARKET_CALIBRATION, source: "default-2026-10-07" };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { temperature?: unknown; lateMoneyBeta?: unknown; promotedAt?: unknown };
    if (typeof parsed.temperature === "number" && parsed.temperature > 0 && typeof parsed.lateMoneyBeta === "number" && Number.isFinite(parsed.lateMoneyBeta)) {
      return { temperature: parsed.temperature, lateMoneyBeta: parsed.lateMoneyBeta, source: `promoted ${String(parsed.promotedAt ?? "-")}` };
    }
  } catch {
    // 壊れたファイルは無視して初期値に戻す
  }
  return { ...MARKET_CALIBRATION, source: "default-2026-10-07 (champion.json unreadable)" };
}

export function addDays(date: string, delta: number) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

export function todayJst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}
