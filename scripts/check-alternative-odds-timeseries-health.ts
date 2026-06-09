/**
 * check-alternative-odds-timeseries-health.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: odds_timeseries_snapshots の代替買い目 odds 保存品質を監視する。
 *   switch 分析に必要な「事前 odds」がどの程度揃っているかを定量化する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/alternative-odds-timeseries-health.md";
const OUT_JSON = "reports/alternative-odds-timeseries-health.json";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELS   = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;
const TARGET_CPS    = ["T-5", "T-10", "T-20", "T-30"] as const;
const SELS_NEEDED   = TARGET_SELS.length; // 5

// 判定閾値
const THRESHOLDS = {
  coverage5sel: 95,       // 5買い目カバレッジ OK
  coverageT5: 80,         // T-5 カバレッジ OK
  coverageT10: 90,        // T-10 カバレッジ OK
  sameValueWarn: 10,      // 1-2-3=1-3-2 同値率 warning (%)
  sameValueError: 50,     // 全買い目同値 error (%)
  buyOverlapInsufficient: 30,  // BUY重複 data-insufficient
  buyOverlapPrelim: 100,       // BUY重複 予備検証可
  buyOverlapForward: 200,      // BUY重複 forward switch候補
} as const;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

function r2(v: number) { return Math.round(v * 100) / 100; }
function pct(a: number, b: number) { return b > 0 ? r2(a / b * 100) : 0; }

// ─── 全体カバレッジ ────────────────────────────────────────────────────────────

const overall = db.prepare(`
  SELECT
    COUNT(*)                                       total_rows,
    COUNT(DISTINCT race_id)                        total_races,
    COUNT(DISTINCT substr(captured_at, 1, 10))    total_days,
    MIN(substr(captured_at, 1, 10))                min_date,
    MAX(substr(captured_at, 1, 10))                max_date
  FROM odds_timeseries_snapshots
  WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
`).get() as {
  total_rows: number; total_races: number; total_days: number;
  min_date: string; max_date: string;
};

// ─── selection × checkpoint カバレッジ ────────────────────────────────────────

type SelCpRow = { selection: string; checkpoint_label: string; n: number };
const selCpRows = db.prepare(`
  SELECT selection, checkpoint_label, COUNT(DISTINCT race_id) n
  FROM odds_timeseries_snapshots
  WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
  GROUP BY selection, checkpoint_label
`).all() as SelCpRow[];

// T-5 での baseline race count
const baseT5Count = selCpRows.find(r => r.selection === "1-2-3" && r.checkpoint_label === "T-5")?.n ?? 0;

const selCpMatrix: Record<string, Record<string, number>> = {};
for (const sel of TARGET_SELS) {
  selCpMatrix[sel] = {};
  for (const cp of TARGET_CPS) selCpMatrix[sel][cp] = 0;
}
for (const row of selCpRows) {
  if (selCpMatrix[row.selection] && TARGET_CPS.includes(row.checkpoint_label as typeof TARGET_CPS[number])) {
    selCpMatrix[row.selection][row.checkpoint_label] = row.n;
  }
}

// ─── race単位で5買い目が揃っている割合 ───────────────────────────────────────

const raceWith5SelsRows = db.prepare(`
  SELECT checkpoint_label, COUNT(*) as races_with_all5
  FROM (
    SELECT race_id, checkpoint_label, COUNT(DISTINCT selection) n_sels
    FROM odds_timeseries_snapshots
    WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
    GROUP BY race_id, checkpoint_label
    HAVING n_sels >= 5
  )
  GROUP BY checkpoint_label
`).all() as { checkpoint_label: string; races_with_all5: number }[];

const raceWith5Sels: Record<string, number> = {};
for (const row of raceWith5SelsRows) raceWith5Sels[row.checkpoint_label] = row.races_with_all5;

// ─── 同値チェック: 1-2-3と1-3-2が同値になる割合 ─────────────────────────────
// GROUP BY + conditional MIN/MAX で 4重JOIN を避ける

type SameValueRow = { checkpoint_label: string; total: number; same_123_132: number; all_same: number };
const sameValueRowsActual = db.prepare(`
  SELECT
    checkpoint_label,
    SUM(1) total,
    SUM(CASE WHEN ABS(o123 - o132) < 0.01 THEN 1 ELSE 0 END) same_123_132,
    SUM(CASE WHEN ABS(o123 - o132) < 0.01
      AND ABS(o123 - o124) < 0.01
      AND ABS(o123 - o142) < 0.01
      AND ABS(o123 - o134) < 0.01 THEN 1 ELSE 0 END) all_same
  FROM (
    SELECT
      race_id, checkpoint_label,
      MIN(CASE WHEN selection='1-2-3' THEN odds END) o123,
      MIN(CASE WHEN selection='1-3-2' THEN odds END) o132,
      MIN(CASE WHEN selection='1-2-4' THEN odds END) o124,
      MIN(CASE WHEN selection='1-4-2' THEN odds END) o142,
      MIN(CASE WHEN selection='1-3-4' THEN odds END) o134,
      COUNT(DISTINCT selection) n_sels
    FROM odds_timeseries_snapshots
    WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
    GROUP BY race_id, checkpoint_label
    HAVING n_sels >= 5
  )
  WHERE o123 IS NOT NULL
  GROUP BY checkpoint_label
`).all() as SameValueRow[];

const sameValueMap: Record<string, SameValueRow> = {};
for (const row of sameValueRowsActual) sameValueMap[row.checkpoint_label] = row;

// ─── BUY decision_history との重複 ────────────────────────────────────────────

type BuyOverlapRow = { checkpoint_label: string; overlap_races: number };
const buyOverlapRows = db.prepare(`
  SELECT ots.checkpoint_label, COUNT(DISTINCT ots.race_id) overlap_races
  FROM odds_timeseries_snapshots ots
  WHERE ots.selection = '1-2-3'
    AND ots.race_id IN (
      SELECT race_id FROM decision_history
      WHERE decision='BUY' AND run_kind='historical-backfill'
        AND result IS NOT NULL AND result != ''
        AND current_odds IS NOT NULL
        AND venue NOT IN (${excl_v})
        AND race_no NOT IN (${excl_r})
        AND selection='1-2-3'
        AND date >= '${FORWARD_START}'
    )
  GROUP BY ots.checkpoint_label
`).all() as BuyOverlapRow[];

const buyOverlap: Record<string, number> = {};
for (const row of buyOverlapRows) buyOverlap[row.checkpoint_label] = row.overlap_races;

// ─── 条件B該当レースとの重複 ─────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const condBOverlapRows = db.prepare(`
  SELECT ots.checkpoint_label, COUNT(DISTINCT ots.race_id) overlap_races
  FROM odds_timeseries_snapshots ots
  WHERE ots.selection = '1-2-3'
    AND ots.race_id IN (
      SELECT dh.race_id FROM decision_history dh
      WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
        AND dh.result IS NOT NULL AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${excl_v})
        AND dh.race_no NOT IN (${excl_r})
        AND dh.selection='1-2-3'
        AND dh.date >= '${FORWARD_START}'
        AND ${WIND24}
        AND ${EXH1}
    )
  GROUP BY ots.checkpoint_label
`).all() as BuyOverlapRow[];

const condBOverlap: Record<string, number> = {};
for (const row of condBOverlapRows) condBOverlap[row.checkpoint_label] = row.overlap_races;

// ─── 6R / 浜名湖 / 住之江 との重複 ──────────────────────────────────────────

const segOverlapRows = db.prepare(`
  SELECT
    ots.checkpoint_label,
    SUM(CASE WHEN dh.race_no=6 THEN 1 ELSE 0 END) r6,
    SUM(CASE WHEN dh.venue='浜名湖' THEN 1 ELSE 0 END) hamanako,
    SUM(CASE WHEN dh.venue='住之江' THEN 1 ELSE 0 END) suminoe,
    SUM(CASE WHEN dh.race_no=6 AND dh.venue IN ('浜名湖','住之江') THEN 1 ELSE 0 END) r6_bad_venue
  FROM odds_timeseries_snapshots ots
  JOIN decision_history dh ON dh.race_id=ots.race_id
    AND dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '${FORWARD_START}'
  WHERE ots.selection='1-2-3'
  GROUP BY ots.checkpoint_label
`).all() as { checkpoint_label: string; r6: number; hamanako: number; suminoe: number; r6_bad_venue: number }[];

const segOverlap: Record<string, typeof segOverlapRows[0]> = {};
for (const row of segOverlapRows) segOverlap[row.checkpoint_label] = row;

// ─── 欠損が多い venue / timing ────────────────────────────────────────────────

type VenueGapRow = { venue: string; expected_races: number; has_t5: number; coverage_pct: number };
const venueGapRows = db.prepare(`
  WITH buy_races AS (
    SELECT dh.race_id, dh.venue
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.venue NOT IN (${excl_v})
      AND dh.race_no NOT IN (${excl_r})
      AND dh.selection='1-2-3'
      AND dh.date >= '2026-06-01'
  )
  SELECT
    br.venue,
    COUNT(DISTINCT br.race_id) expected_races,
    COUNT(DISTINCT ots.race_id) has_t5,
    ROUND(COUNT(DISTINCT ots.race_id) * 100.0 / COUNT(DISTINCT br.race_id), 1) coverage_pct
  FROM buy_races br
  LEFT JOIN odds_timeseries_snapshots ots
    ON ots.race_id = br.race_id AND ots.selection='1-2-3' AND ots.checkpoint_label='T-5'
  GROUP BY br.venue
  HAVING COUNT(DISTINCT br.race_id) >= 3
  ORDER BY coverage_pct ASC
  LIMIT 10
`).all() as VenueGapRow[];

// ─── 最近7日/30日の保存状況 ──────────────────────────────────────────────────

const maxDate = overall.max_date;
const date7ago = (() => {
  const d = new Date(maxDate);
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
})();
const date30ago = (() => {
  const d = new Date(maxDate);
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
})();

type PeriodStat = { period: string; races: number; with_all5_t5: number; coverage_pct: number };

function getPeriodStat(fromDate: string, label: string): PeriodStat {
  const rows = db.prepare(`
    SELECT COUNT(DISTINCT race_id) races
    FROM odds_timeseries_snapshots
    WHERE selection='1-2-3' AND checkpoint_label='T-5'
      AND substr(captured_at,1,10) >= '${fromDate}'
      AND substr(captured_at,1,10) <= '${maxDate}'
  `).get() as { races: number };

  const with5 = db.prepare(`
    SELECT COUNT(*) cnt FROM (
      SELECT race_id
      FROM odds_timeseries_snapshots
      WHERE selection IN ('1-2-3','1-3-2','1-2-4','1-4-2','1-3-4')
        AND checkpoint_label='T-5'
        AND substr(captured_at,1,10) >= '${fromDate}'
        AND substr(captured_at,1,10) <= '${maxDate}'
      GROUP BY race_id
      HAVING COUNT(DISTINCT selection) >= 5
    )
  `).get() as { cnt: number };

  return {
    period: label,
    races: rows.races,
    with_all5_t5: with5.cnt,
    coverage_pct: pct(with5.cnt, rows.races),
  };
}

const stat7d  = getPeriodStat(date7ago, `最近7日(${date7ago}〜${maxDate})`);
const stat30d = getPeriodStat(date30ago, `最近30日(${date30ago}〜${maxDate})`);

// ─── 判定 ─────────────────────────────────────────────────────────────────────

type HealthVerdict = "OK" | "WARNING" | "ERROR" | "DATA-INSUFFICIENT";

function judgeValue(val: number, ok: number, warn?: number, isHighBad = false): HealthVerdict {
  if (isHighBad) {
    if (val >= (warn ?? ok)) return "ERROR";
    if (val >= ok / 2) return "WARNING";
    return "OK";
  }
  if (val >= ok) return "OK";
  if (warn !== undefined && val >= warn) return "WARNING";
  return "ERROR";
}

const t5CoverageT5  = baseT5Count > 0 ? pct(selCpMatrix["1-3-2"]["T-5"], baseT5Count) : 0;
const t5Race5Sel    = baseT5Count > 0 ? pct(raceWith5Sels["T-5"] ?? 0, baseT5Count) : 0;
const svT5          = sameValueMap["T-5"];
const svRateT5_132  = svT5 ? pct(svT5.same_123_132, svT5.total) : 0;
const svRateT5_all  = svT5 ? pct(svT5.all_same, svT5.total) : 0;
const buyT5         = buyOverlap["T-5"] ?? 0;

const verdicts = {
  coverage5sel:   judgeValue(t5Race5Sel, THRESHOLDS.coverage5sel, THRESHOLDS.coverage5sel - 10),
  coverageT5:     judgeValue(t5CoverageT5, THRESHOLDS.coverageT5, THRESHOLDS.coverageT5 - 10),
  sameValue132:   judgeValue(svRateT5_132, THRESHOLDS.sameValueWarn, undefined, true),
  sameValueAll:   judgeValue(svRateT5_all, THRESHOLDS.sameValueError, THRESHOLDS.sameValueWarn, true),
  buyOverlap:     buyT5 >= THRESHOLDS.buyOverlapForward ? "OK"
                : buyT5 >= THRESHOLDS.buyOverlapPrelim   ? "WARNING"
                : "DATA-INSUFFICIENT" as HealthVerdict,
};

const switchReadiness: string =
  buyT5 >= THRESHOLDS.buyOverlapForward ? "forward switch分析候補 (n≥200)"
  : buyT5 >= THRESHOLDS.buyOverlapPrelim ? "予備検証可 (n≥100)"
  : buyT5 >= THRESHOLDS.buyOverlapInsufficient ? "要確認 (n≥30)"
  : "data-insufficient (n<30)";

// ─── 出力 ─────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

function v(verdict: HealthVerdict): string {
  return verdict === "OK" ? "✅ OK"
    : verdict === "WARNING" ? "⚠️ WARNING"
    : verdict === "ERROR" ? "❌ ERROR"
    : "❓ DATA-INSUFFICIENT";
}

lines.push(`# 代替買い目 Timeseries Odds ヘルスチェック`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**`);
lines.push(`> **app_settings / 本番 decision 変更禁止。switch 分析は timeseries 蓄積後に再評価。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## サマリ判定`);
lines.push(``);
lines.push(`| 項目 | 値 | 判定 |`);
lines.push(`|---|---:|---|`);
lines.push(`| 5買い目 T-5 カバレッジ | ${r2(t5Race5Sel)}% | ${v(verdicts.coverage5sel)} |`);
lines.push(`| 1-3-2 T-5 カバレッジ | ${r2(t5CoverageT5)}% | ${v(verdicts.coverageT5)} |`);
lines.push(`| 1-2-3=1-3-2 同値率 (T-5) | ${r2(svRateT5_132)}% | ${v(verdicts.sameValue132)} |`);
lines.push(`| 5買い目全同値率 (T-5) | ${r2(svRateT5_all)}% | ${v(verdicts.sameValueAll)} |`);
lines.push(`| BUY forward 重複レース (T-5) | ${buyT5} | ${v(verdicts.buyOverlap)} |`);
lines.push(`| Switch 分析可否 | — | **${switchReadiness}** |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 1. 全体カバレッジ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| データ期間 | ${overall.min_date} 〜 ${overall.max_date} |`);
lines.push(`| 蓄積日数 | ${overall.total_days}日 |`);
lines.push(`| ユニーク race 数 | ${overall.total_races} |`);
lines.push(`| 総行数 | ${overall.total_rows.toLocaleString()} |`);
lines.push(``);
lines.push(`## 2. selection × checkpoint 別カバレッジ（ユニーク race 数）`);
lines.push(``);
lines.push(`| 買い目 | T-5 | T-10 | T-20 | T-30 |`);
lines.push(`|---|---:|---:|---:|---:|`);
for (const sel of TARGET_SELS) {
  const r = selCpMatrix[sel];
  lines.push(`| ${sel} | ${r["T-5"]} | ${r["T-10"]} | ${r["T-20"]} | ${r["T-30"]} |`);
}
lines.push(``);
lines.push(`## 3. race単位で5買い目が揃っている割合`);
lines.push(``);
lines.push(`| checkpoint | 全5買い目あり | 1-2-3 race数 | 充足率 |`);
lines.push(`|---|---:|---:|---:|`);
for (const cp of TARGET_CPS) {
  const baseN = selCpMatrix["1-2-3"][cp] ?? 0;
  const n5    = raceWith5Sels[cp] ?? 0;
  lines.push(`| ${cp} | ${n5} | ${baseN} | ${pct(n5, baseN)}% |`);
}
lines.push(``);
lines.push(`## 4. 同値チェック（1-2-3と1-3-2が同値になる割合）`);
lines.push(``);
lines.push(`| checkpoint | 対象 race | 1-2-3=1-3-2 | 同値率 | 5買い目全同値 | 全同値率 |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);
for (const cp of TARGET_CPS) {
  const sv = sameValueMap[cp];
  if (!sv) { lines.push(`| ${cp} | — | — | — | — | — |`); continue; }
  const r132 = pct(sv.same_123_132, sv.total);
  const rAll  = pct(sv.all_same, sv.total);
  const warn132 = r132 >= THRESHOLDS.sameValueWarn ? " ⚠️" : "";
  const warnAll = rAll >= THRESHOLDS.sameValueError ? " ❌" : rAll >= THRESHOLDS.sameValueWarn ? " ⚠️" : "";
  lines.push(`| ${cp} | ${sv.total} | ${sv.same_123_132} | ${r132}%${warn132} | ${sv.all_same} | ${rAll}%${warnAll} |`);
}
lines.push(``);
lines.push(`> **同値率が低い = 各買い目が正しく別オッズで記録されている（良い状態）**`);
lines.push(``);
lines.push(`## 5. BUY forward との重複`);
lines.push(``);
lines.push(`| checkpoint | BUY重複 race数 | 条件B重複 | 6R重複 | 浜名湖重複 | 住之江重複 |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);
for (const cp of TARGET_CPS) {
  const seg = segOverlap[cp];
  lines.push(`| ${cp} | ${buyOverlap[cp] ?? 0} | ${condBOverlap[cp] ?? 0} | ${seg?.r6 ?? 0} | ${seg?.hamanako ?? 0} | ${seg?.suminoe ?? 0} |`);
}
lines.push(``);
lines.push(`> BUY重複 n≥200 → forward switch分析候補 / n≥100 → 予備検証可 / n<30 → data-insufficient`);
lines.push(``);
lines.push(`## 6. 欠損が多い会場（2026-06以降のBUY重複 T-5カバレッジ）`);
lines.push(``);
if (venueGapRows.length > 0) {
  lines.push(`| 会場 | 期待 race数 | T-5 あり | カバレッジ |`);
  lines.push(`|---|---:|---:|---:|`);
  for (const row of venueGapRows) {
    lines.push(`| ${row.venue} | ${row.expected_races} | ${row.has_t5} | ${row.coverage_pct}% |`);
  }
} else {
  lines.push(`> 2026-06以降のBUY重複レースなし（期間がまだ短い）`);
}
lines.push(``);
lines.push(`## 7. 最近の保存状況`);
lines.push(``);
lines.push(`| 期間 | race数(T-5) | 5買い目揃い | 充足率 |`);
lines.push(`|---|---:|---:|---:|`);
lines.push(`| ${stat7d.period} | ${stat7d.races} | ${stat7d.with_all5_t5} | ${stat7d.coverage_pct}% |`);
lines.push(`| ${stat30d.period} | ${stat30d.races} | ${stat30d.with_all5_t5} | ${stat30d.coverage_pct}% |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない`);
lines.push(`- 事前代替 odds 不足のため switch 本採用不可`);
lines.push(`- timeseries（${overall.min_date}〜）でデータ蓄積中。BUY forward との重複が n=200 に達した時点で初めて forward switch 分析が可能`);
lines.push(`- 現時点で採用可能なのは skip monitor のみ`);
lines.push(`- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: check-alternative-odds-timeseries-health.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  overall,
  verdicts,
  switchReadiness,
  selCpMatrix,
  raceWith5Sels,
  sameValueByCheckpoint: sameValueMap,
  buyOverlap,
  condBOverlap,
  segOverlap,
  venueGaps: venueGapRows,
  recentStats: { last7d: stat7d, last30d: stat30d },
  thresholds: THRESHOLDS,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

// コンソール出力
console.log("=== 代替買い目 Timeseries Odds ヘルスチェック ===");
console.log(`期間: ${overall.min_date}〜${overall.max_date} (${overall.total_days}日 / ${overall.total_races}races)`);
console.log();
console.log("--- 判定 ---");
console.log(`  5買い目 T-5 カバレッジ: ${r2(t5Race5Sel)}% → ${v(verdicts.coverage5sel)}`);
console.log(`  1-2-3=1-3-2 同値率 (T-5): ${r2(svRateT5_132)}% → ${v(verdicts.sameValue132)}`);
console.log(`  5買い目全同値率 (T-5): ${r2(svRateT5_all)}% → ${v(verdicts.sameValueAll)}`);
console.log(`  BUY重複 (T-5): ${buyT5}件 → ${switchReadiness}`);
console.log();
console.log(`  最近7日: ${stat7d.races}races / 5買い目揃い${stat7d.coverage_pct}%`);
console.log(`  最近30日: ${stat30d.races}races / 5買い目揃い${stat30d.coverage_pct}%`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
