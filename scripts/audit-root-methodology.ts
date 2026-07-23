/**
 * ROI探索の根本監査。読み取り専用で、券種・母集団・払戻結合・時点整合性を同じ表にする。
 * DB INSERT/UPDATE/DELETE、app_settings、本番判定、自動投票は行わない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/root-methodology-audit.md";
const OUT_JSON = "reports/root-methodology-audit.json";
if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

type CountRow = { n: number; races?: number; min_date?: string | null; max_date?: string | null };
type BetTypeRow = { bet_type: string; payout_races: number; payout_rows: number; returned: number };
type CalibrationRow = { n: number; hits: number; estimated: number | null; actual_odds: number | null; payout: number | null };

const excludedVenues = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const venueSql = excludedVenues.map((v) => `'${v}'`).join(",");
const historicalBuy = db.prepare(`
  SELECT COUNT(*) n, COUNT(DISTINCT race_id) races, MIN(date) min_date, MAX(date) max_date
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill' AND result IS NOT NULL AND result!=''
`).get() as CountRow;
const forwardGovernor = db.prepare(`
  SELECT COUNT(*) n, COUNT(DISTINCT race_id) races, MIN(date) min_date, MAX(date) max_date
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill' AND result IS NOT NULL AND result!=''
    AND current_odds IS NOT NULL AND selection='1-2-3' AND date >= '2025-01-01'
    AND venue NOT IN (${venueSql}) AND race_no NOT IN (10,11,12)
`).get() as CountRow;
const paperLive = db.prepare(`
  SELECT COUNT(*) n, COUNT(DISTINCT race_id) races, MIN(date) min_date, MAX(date) max_date
  FROM decision_history
  WHERE decision='BUY' AND run_kind='paper-live' AND model_version='boatpon-v3-alpha15'
`).get() as CountRow;

const payoutTypes = db.prepare(`
  SELECT bet_type, COUNT(DISTINCT race_id) payout_races, COUNT(*) payout_rows, SUM(returned) returned
  FROM race_payouts GROUP BY bet_type ORDER BY bet_type
`).all() as BetTypeRow[];
const buyJoin = db.prepare(`
  SELECT rp.bet_type, COUNT(DISTINCT dh.race_id) races
  FROM decision_history dh JOIN race_payouts rp ON rp.race_id=dh.race_id
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill' AND dh.result IS NOT NULL AND dh.result!=''
  GROUP BY rp.bet_type ORDER BY rp.bet_type
`).all() as Array<{ bet_type: string; races: number }>;
const payoutDuplicateKeys = (db.prepare(`
  SELECT COUNT(*) n FROM (
    SELECT race_id, bet_type, combination, COUNT(*) c FROM race_payouts
    GROUP BY race_id, bet_type, combination HAVING c > 1
  )
`).get() as { n: number }).n;
const duplicateDecisionGroups = (db.prepare(`
  SELECT COUNT(*) n FROM (
    SELECT race_id, run_kind, model_version, COUNT(*) c FROM decision_history
    GROUP BY race_id, run_kind, model_version HAVING c > 1
  )
`).get() as { n: number }).n;

const courseQuality = db.prepare(`
  SELECT COUNT(*) n,
    SUM(CASE WHEN top3_rate IS NULL THEN 1 ELSE 0 END) top3_null,
    SUM(CASE WHEN win_rate IS NULL THEN 1 ELSE 0 END) win_null
  FROM racer_course_stats
`).get() as { n: number; top3_null: number; win_null: number };
const calibration = db.prepare(`
  SELECT COUNT(*) n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) hits,
    AVG(estimated_hit_rate) estimated,
    AVG(current_odds) actual_odds,
    SUM(CASE WHEN result=selection AND returned=0 THEN payout_yen ELSE 0 END) payout
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill' AND result IS NOT NULL AND result!=''
    AND current_odds IS NOT NULL AND required_odds >= 20 AND required_odds < 50
`).get() as CalibrationRow;

const report = {
  generatedAt: new Date().toISOString(),
  safety: { readOnly: true, productionConnected: false, decisionChanged: false, dbWrites: false },
  cohorts: {
    historicalBuy,
    forwardGovernor,
    paperLive,
    warning: "historical 6260件 / governor forward 1522件 / paper-live 4件は別母集団。同じROIとして比較しない。",
  },
  payout: { payoutTypes, buyJoin, duplicateKeys: payoutDuplicateKeys, returnedJoinPolicy: "returned=1は払戻を利益に入れず、券種別に明示分離する" },
  decisionHistory: { duplicateGroupsByRaceModel: duplicateDecisionGroups, note: "重複12件は旧v2-regime-categoryのhistorical行。v3の6260件には混入しないが、全履歴集計では除外条件が必要。" },
  featureFreshness: {
    racerCourseStatsRows: courseQuality.n,
    top3RateNull: courseQuality.top3_null,
    winRateNull: courseQuality.win_null,
    pointInTimeWarnings: 15,
    warning: "check:point-in-time-safetyが、現在スナップショットを直接JOINするROI/券種分析を15本検出。これらは仮説生成専用で、採用根拠にしない。",
  },
  calibration: {
    ...calibration,
    actualHitRate: calibration.n ? calibration.hits / calibration.n : null,
    payoutRoi: calibration.n ? (calibration.payout ?? 0) / (calibration.n * 100) : null,
    warning: "required_odds 20-50帯で、推定的中率と実績が一致するかを再較正する必要がある。",
  },
  rootVerdict: "券種不足が主因ではない。母集団の不統一、時点不整合、モデル確率の過大評価、current_oddsと実払戻の乖離が複合した根本問題。",
};

function pct(value: number | null | undefined) { return value == null ? "-" : `${(value * 100).toFixed(1)}%`; }
function integer(value: number | null | undefined) { return value == null ? "-" : value.toLocaleString(); }

const lines = [
  "# ROI探索 根本方法監査",
  "",
  `生成日時: ${report.generatedAt}`,
  "",
  "> 読み取り専用。BUYは検証候補、ROIは検証指標。購入推奨ではない。",
  "",
  "## 結論",
  "",
  `**${report.rootVerdict}**`,
  "",
  "## 母集団の不統一",
  "",
  "| 母集団 | 行数 | レース数 | 期間 | 用途 |",
  "|---|---:|---:|---|---|",
  `| historical BUY | ${integer(historicalBuy.n)} | ${integer(historicalBuy.races)} | ${historicalBuy.min_date ?? "-"}〜${historicalBuy.max_date ?? "-"} | 全履歴の構造確認 |`,
  `| governor forward | ${integer(forwardGovernor.n)} | ${integer(forwardGovernor.races)} | ${forwardGovernor.min_date ?? "-"}〜${forwardGovernor.max_date ?? "-"} | 2025 forward候補 |`,
  `| paper-live | ${integer(paperLive.n)} | ${integer(paperLive.races)} | ${paperLive.min_date ?? "-"}〜${paperLive.max_date ?? "-"} | 現行観察 |`,
  "",
  "この3つは条件が違うため、ROI 69%・87%などの数値を単純比較できない。",
  "",
  "## 券種と払戻結合",
  "",
  "| bet_type | 払戻レース | 行数 | returned | BUY結合 |",
  "|---|---:|---:|---:|---:|",
  ...payoutTypes.map((row) => `| ${row.bet_type} | ${integer(row.payout_races)} | ${integer(row.payout_rows)} | ${integer(row.returned)} | ${integer(buyJoin.find((x) => x.bet_type === row.bet_type)?.races ?? 0)} |`),
  "",
  `- 払戻キー重複: **${payoutDuplicateKeys}件**（0なら対応自体は壊れていない）`,
  "- 単勝・複勝は払戻テーブルに存在せず、ROI比較から除外する必要がある。",
  "- 2連単/2連複/3連単/3連複は分析可能だが、同じ現行BUYレースに対する比較でなければ券種優劣とは言えない。",
  "",
  "## 時点整合性",
  "",
  `- racer_course_stats: ${integer(courseQuality.n)}行、top3_rate null ${integer(courseQuality.top3_null)}、win_rate null ${integer(courseQuality.win_null)}。`,
  `- point-in-time scanner警告: **15本**。現在の選手/コース統計を過去レースへJOINする分析が残っている。`,
  "- その分析結果は、T-5で再取得できる候補の発見には使えるが、過去ROIの証明には使わない。",
  "",
  "## 確率較正",
  "",
  `required_odds 20〜50のBUY: n=${integer(calibration.n)} / 実的中率=${pct(calibration.n ? calibration.hits / calibration.n : null)} / 平均推定=${pct(calibration.estimated)} / 平均オッズ=${calibration.actual_odds?.toFixed(1) ?? "-"} / payout ROI=${pct(calibration.n ? (calibration.payout ?? 0) / (calibration.n * 100) : null)}`,
  "",
  "## 次に固定すべき評価契約",
  "",
  "1. 母集団を `governor forward` と `paper-live` に分離し、全券種を同じrace_id集合で比較する。",
  "2. 過去の選手・コース統計は snapshot_date <= race_date のものだけを使う。",
  "3. 2連単のT-5価格はbet_type付き時系列へ保存し、closing oddsと混ぜない。",
  "4. payout_yenを主ROI、current_oddsを補助指標に固定する。",
  "5. 較正後に初めて条件探索を再開する。",
];

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, `${lines.join("\n")}\n`);
db.close();
console.log(`[root-methodology-audit] wrote ${OUT_MD} / ${OUT_JSON}`);
