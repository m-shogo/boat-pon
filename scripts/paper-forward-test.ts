/**
 * Paper Forward Test — 月4+6+8+12×parts=0 候補の追跡
 *
 * 禁止:
 * - 既存テーブルへのINSERT/UPDATE/DELETE
 * - DROP TABLE / ALTER TABLE
 * - app_settings 変更
 * - 本番decisionロジック変更
 * - 自動投票
 *
 * このスクリプトは:
 * - paper_roi_candidates テーブルを CREATE TABLE IF NOT EXISTS で作成する
 * - decision_history の historical-backfill BUY から条件マッチ行を抽出し記録する
 * - 本番のBUY/NO_BUY判定は変更しない
 * - reports/roi-paper-forward.md / .json を生成する
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-paper-forward.md";
const OUT_JSON = "reports/roi-paper-forward.json";
const STAKE = 100;

// 分析の境界: test split 開始日 (全体の90%地点 = 2025-08-09 付近)
const FORWARD_START = "2025-08-09";
const CONDITION_NAME = "seasonal_parts0_month_4_6_8_12";
const CONDITION_DESC = "月4+6+8+12×parts=0 (isBase条件付き)";

// Historical baseline (analyze-roi-decision-lab.ts の検証結果)
const HISTORICAL_BASELINE = {
  n: 543,
  roi: 199.10,
  roiExMaxHit: 184.79,
  roiExMax3Hits: 162.15,
  roiExMax5Hits: 140.98,
  hitRate: 26 / 543,
  partsMissing: 0,
  description: "2024-01〜2025-08 (train+val) n=543",
};

if (!existsSync(DB_PATH)) {
  console.error(`[paper-forward] DB not found: ${DB_PATH}`);
  process.exit(1);
}

// 書き込み用DBコネクション (paper_roi_candidatesの作成/書き込みのみ)
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000;");

// ── CREATE TABLE IF NOT EXISTS ──
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_roi_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    condition_name TEXT NOT NULL,
    race_id TEXT NOT NULL,
    date TEXT NOT NULL,
    venue TEXT NOT NULL,
    race_no INTEGER NOT NULL,
    selection TEXT NOT NULL,
    current_odds REAL,
    result TEXT,
    hit INTEGER,
    parts_known INTEGER,
    parts_count INTEGER,
    motor_known INTEGER,
    motor_top2_rate REAL,
    wind_mps REAL,
    ex_st REAL,
    flying_count INTEGER,
    paper_action TEXT NOT NULL DEFAULT 'PAPER_STRONG',
    review_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(condition_name, race_id)
  )
`);
console.log("[paper-forward] table paper_roi_candidates ready");

// ── Load matching rows via SQL + TypeScript filter ──

type RawRow = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  selection: string;
  current_odds: number;
  result: string | null;
  parts_changed_count: number | null;
  wind_speed_mps: number | null;
  wave_height_cm: number | null;
  start_timing: number | null;
  flying_count_head: number | null;
  motor_top2_rate: number | null;
};

// SQL: month4/6/8/12 + join equipment + exhibition + weather
// headFlyingCount は racer_profiles.flying_count (キャリア通算F数) を使う
// これは analyze-roi-decision-lab.ts の loadEntries() + loadRows() の挙動に合わせた実装
const rows = db.prepare(`
  SELECT
    dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
    dh.current_odds, dh.result,
    re.parts_changed_count,
    rw.wind_speed_mps, rw.wave_height_cm,
    ed.start_timing,
    (SELECT rp.flying_count FROM race_entries ra2
     JOIN racer_profiles rp ON rp.registration_no = ra2.racer_reg
     WHERE ra2.race_id = dh.race_id
       AND ra2.entry_course = CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT)
     LIMIT 1) as flying_count_head,
    ms.motor_top2_rate
  FROM decision_history dh
  JOIN race_equipment re ON dh.race_id = re.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = re.course
  JOIN exhibition_data ed ON dh.race_id = ed.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ed.course
  LEFT JOIN race_weather rw ON dh.race_id = rw.race_id
  LEFT JOIN motor_boat_stats ms ON dh.race_id = ms.race_id
    AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ms.course
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND substr(dh.date,6,2) IN ('04','06','08','12')
    AND re.parts_changed_count = 0
    AND dh.race_no < 10
    AND dh.venue NOT IN ('戸田', '多摩川')
  ORDER BY dh.date
`).all() as RawRow[];

// TypeScript-level filters (isBase の残り部分)
function passesIsBase(r: RawRow): boolean {
  // wind >= 3
  if ((r.wind_speed_mps ?? 99) < 3) return false;
  // headFlyingCount >= 1 はNO
  if ((r.flying_count_head ?? 0) >= 1) return false;
  // month=9 はNO (SQL側で除外済みだが念のため)
  const mo = Number(r.date.slice(5, 7));
  if (mo === 9 || mo <= 3) return false;
  // exSt 0.10-0.15 はNO
  const exSt = r.start_timing;
  if (exSt !== null && exSt >= 0.10 && exSt < 0.15) return false;
  return true;
}

const filtered = rows.filter(passesIsBase);
console.log(`[paper-forward] SQL rows: ${rows.length}, after isBase: ${filtered.length}`);

// ── INSERT OR IGNORE into paper_roi_candidates ──
// rerun safe: INSERT OR IGNORE + changes() で attempted/inserted/ignored を集計
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO paper_roi_candidates
    (condition_name, race_id, date, venue, race_no, selection, current_odds, result, hit,
     parts_known, parts_count, motor_known, motor_top2_rate, wind_mps, ex_st, flying_count,
     paper_action, review_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?)
`);

let attempted = 0;
let insertedRows = 0;
for (const r of filtered) {
  const hit = r.result != null ? (r.result === r.selection ? 1 : 0) : null;
  insertStmt.run(
    CONDITION_NAME, r.race_id, r.date, r.venue, r.race_no, r.selection,
    r.current_odds, r.result, hit,
    1, r.parts_changed_count ?? 0,
    r.motor_top2_rate !== null ? 1 : 0, r.motor_top2_rate,
    r.wind_speed_mps, r.start_timing, r.flying_count_head,
    "PAPER_STRONG", r.date >= FORWARD_START ? "forward" : "historical",
  );
  attempted++;
  insertedRows += (db.prepare("SELECT changes() as c").get() as { c: number }).c;
}
const ignoredRows = attempted - insertedRows;

// condition別カウント（DB全体）
const totalInDB = (db.prepare(`SELECT COUNT(*) as cnt FROM paper_roi_candidates WHERE condition_name = ?`).get(CONDITION_NAME) as { cnt: number }).cnt;
const duplicateCount = ignoredRows;

console.log(`[paper-forward] attempted: ${attempted}, inserted: ${insertedRows}, ignored(duplicate): ${ignoredRows}`);
console.log(`[paper-forward] total in DB for ${CONDITION_NAME}: ${totalInDB}`);
if (totalInDB > attempted) {
  console.warn(`[paper-forward] ⚠️  DB内に旧データ残存: ${totalInDB - attempted} 件 (DB合計${totalInDB} > 今回の正しいセット${attempted})`);
  console.warn(`[paper-forward]    旧データはflying_count修正前に登録された可能性があります。`);
  console.warn(`[paper-forward]    クリーンアップするには: DELETE FROM paper_roi_candidates WHERE condition_name='${CONDITION_NAME}' (要ユーザー承認)`);
}

// ── Read back for report ──
type CandRow = {
  race_id: string; date: string; venue: string; race_no: number;
  selection: string; current_odds: number; result: string | null;
  hit: number | null; review_status: string;
};
const allRows = db.prepare(`
  SELECT race_id, date, venue, race_no, selection, current_odds, result, hit, review_status
  FROM paper_roi_candidates
  WHERE condition_name = ?
  ORDER BY date
`).all(CONDITION_NAME) as CandRow[];

const historicalRows = allRows.filter(r => r.review_status === "historical");
const forwardRows = allRows.filter(r => r.review_status === "forward");
const confirmedForward = forwardRows.filter(r => r.hit !== null);
const pendingForward = forwardRows.filter(r => r.hit === null);

function calcMetrics(rs: CandRow[]) {
  const n = rs.length;
  const withResult = rs.filter(r => r.hit !== null);
  const hits = withResult.filter(r => r.hit === 1).length;
  const hitOdds = withResult.filter(r => r.hit === 1).map(r => r.current_odds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const ex3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const nEval = withResult.length;
  return {
    n, nEval, hits,
    hitRate: nEval > 0 ? hits / nEval : null,
    roi: nEval > 0 ? (total / nEval) * 100 : null,
    roiExMaxHit: nEval > 0 ? (ex1 / nEval) * 100 : null,
    roiExMax3Hits: nEval > 0 ? (ex3 / nEval) * 100 : null,
    maxHitOdds: hitOdds[0] ?? 0,
  };
}

const histMetrics = calcMetrics(historicalRows);
const fwdMetrics = calcMetrics(confirmedForward);

// monthly breakdown for forward
function monthBreakdown(rs: CandRow[]) {
  const byYm = new Map<string, CandRow[]>();
  for (const r of rs) {
    const ym = r.date.slice(0, 7);
    if (!byYm.has(ym)) byYm.set(ym, []);
    byYm.get(ym)!.push(r);
  }
  return [...byYm.entries()].sort().map(([ym, rows]) => {
    const m = calcMetrics(rows);
    return { ym, ...m };
  });
}

// odds band for forward confirmed
function oddsBands(rs: CandRow[]) {
  const bands = [
    { label: "odds<30", lo: 0, hi: 30 },
    { label: "30<=odds<50", lo: 30, hi: 50 },
    { label: "50<=odds<80", lo: 50, hi: 80 },
    { label: "odds>=80", lo: 80, hi: Infinity },
  ];
  return bands.map(({ label, lo, hi }) => {
    const band = rs.filter(r => r.current_odds >= lo && r.current_odds < hi);
    return { label, ...calcMetrics(band) };
  });
}

function pct(v: number | null): string {
  if (v === null) return "-";
  return `${(v * 100).toFixed(2)}%`;
}
function num(v: number): string {
  return v.toFixed(2);
}

// ── Generate Report ──
const lines: string[] = [];
lines.push("# ROI Paper Forward Test Report", "");
lines.push("**条件**: 月4+6+8+12×parts=0 (isBase付き)", "");
lines.push("**禁止**: 本番decision変更不可 / app_settings変更不可 / 自動投票不可", "");
lines.push(`*生成: ${new Date().toISOString()} / DB: ${DB_PATH}*`, "");
lines.push("");

// 1. 条件定義
lines.push("## 1. 条件定義", "");
lines.push("```");
lines.push(`条件名: ${CONDITION_NAME}`);
lines.push(`説明: ${CONDITION_DESC}`);
lines.push("");
lines.push("フィルター:");
lines.push("  - run_kind = 'historical-backfill'");
lines.push("  - decision = 'BUY'");
lines.push("  - month in (4, 6, 8, 12)");
lines.push("  - race_equipment.parts_changed_count = 0 (equipmentPresent=true)");
lines.push("  - exhibition_data 存在必須 (head boat)");
lines.push("  - race_no < 10");
lines.push("  - venue NOT IN ('戸田', '多摩川')");
lines.push("  - wind_speed_mps >= 3");
lines.push("  - headFlyingCount (racer_profiles.flying_count) = 0");
lines.push("  - exSt NOT IN [0.10, 0.15)");
lines.push("```");
lines.push("");

// 1b. Rerun Safety
lines.push("## 1b. Rerun Safety", "");
lines.push("```");
lines.push("INSERT OR IGNORE による重複排除: ✅ rerun safe");
lines.push(`UNIQUE KEY: condition_name + race_id`);
lines.push("  ⚠️ 将来複数selection対応する場合は UNIQUE(condition_name, race_id, selection) を推奨");
lines.push("     (現時点では既存DBがあるため ALTER TABLE しない — 設計メモとして記録)");
lines.push("");
lines.push(`今回の実行:`);
lines.push(`  attempted    : ${attempted}`);
lines.push(`  inserted     : ${insertedRows}`);
lines.push(`  ignored (dup): ${ignoredRows}`);
lines.push(`  total in DB  : ${totalInDB}`);
if (totalInDB > attempted) {
  lines.push("");
  lines.push(`  ⚠️  旧データ残存: DB合計 ${totalInDB} > 正しいセット ${attempted}`);
  lines.push(`     差分 ${totalInDB - attempted} 件は flying_count 修正前に登録された誤データの可能性あり`);
  lines.push(`     クリーンアップコマンド (要ユーザー承認):`);
  lines.push(`       DELETE FROM paper_roi_candidates WHERE condition_name='${CONDITION_NAME}'`);
  lines.push(`     その後このスクリプトを再実行して正しい ${attempted} 件を再登録する`);
}
lines.push("```");
lines.push("");

// 2. Baseline比較
lines.push("## 2. Historical Baseline (train+val: 〜2025-08-08)", "");
lines.push("| 指標 | 歴史検証 | paper forward (確定済み) |");
lines.push("|---|---:|---:|");
lines.push(`| n (記録件数) | ${HISTORICAL_BASELINE.n} | ${confirmedForward.length} |`);
lines.push(`| 未確定 | - | ${pendingForward.length}件 |`);
lines.push(`| hits | 26 | ${fwdMetrics.hits} |`);
lines.push(`| hitRate | ${pct(HISTORICAL_BASELINE.hitRate)} | ${pct(fwdMetrics.hitRate)} |`);
lines.push(`| ROI | **${HISTORICAL_BASELINE.roi.toFixed(2)}%** | **${fwdMetrics.roi !== null ? fwdMetrics.roi.toFixed(2) + "%" : "-"}** |`);
lines.push(`| roiExMaxHit | ${HISTORICAL_BASELINE.roiExMaxHit.toFixed(2)}% | ${fwdMetrics.roiExMaxHit !== null ? fwdMetrics.roiExMaxHit.toFixed(2) + "%" : "-"} |`);
lines.push(`| roiExMax3Hits | ${HISTORICAL_BASELINE.roiExMax3Hits.toFixed(2)}% | ${fwdMetrics.roiExMax3Hits !== null ? fwdMetrics.roiExMax3Hits.toFixed(2) + "%" : "-"} |`);
lines.push(`| parts欠損率 | 0% | 0% (条件による) |`);
lines.push("");

// 3. Forward test 月別内訳
lines.push("## 3. Forward Test 月別内訳 (2025-08-09〜)", "");
const fwdMonths = monthBreakdown(forwardRows);
if (fwdMonths.length === 0) {
  lines.push("forward期間のデータなし。", "");
} else {
  lines.push("| 年月 | n | 確定済み | hits | hitRate | ROI | maxHitOdds |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const mb of fwdMonths) {
    const roi = mb.roi !== null ? mb.roi.toFixed(0) + "%" : "(未確定)";
    const hr = mb.hitRate !== null ? pct(mb.hitRate) : "-";
    lines.push(`| ${mb.ym} | ${mb.n} | ${mb.nEval} | ${mb.hits} | ${hr} | ${roi} | ${num(mb.maxHitOdds)} |`);
  }
  lines.push("");
}

// 4. Forward test odds帯内訳
lines.push("## 4. Forward Test オッズ帯別 (確定済みのみ)", "");
const fwdOdds = oddsBands(confirmedForward);
lines.push("| オッズ帯 | n | hits | ROI | maxHitOdds |");
lines.push("|---|---:|---:|---:|---:|");
for (const b of fwdOdds) {
  const roi = b.roi !== null ? b.roi.toFixed(0) + "%" : "-";
  lines.push(`| ${b.label} | ${b.n} | ${b.hits} | ${roi} | ${num(b.maxHitOdds)} |`);
}
lines.push("");

// 5. 判定
lines.push("## 5. 現時点の判定", "");
const verdict = fwdMetrics.roi === null ? "未評価"
  : fwdMetrics.roi >= 100 && fwdMetrics.roiExMax3Hits !== null && fwdMetrics.roiExMax3Hits >= 80
    ? "✅ PAPER_STRONG継続"
    : fwdMetrics.roi >= 50
      ? "⚠️ PAPER (要観察)"
      : "❌ 期待値割れ — 再評価必要";
lines.push(`**判定: ${verdict}**`, "");
lines.push(`- Forward期間: ${FORWARD_START} 〜 現在`);
lines.push(`- 記録件数: ${forwardRows.length}件 (確定済み: ${confirmedForward.length}件, 未確定: ${pendingForward.length}件)`);
lines.push(`- Forward ROI: ${fwdMetrics.roi !== null ? fwdMetrics.roi.toFixed(1) + "%" : "未確定"}`);
lines.push("");
lines.push("> **本番反映禁止**: この結果がどうであれ、app_settings や本番 decision ロジックは変更しないこと。", "");
lines.push("> paper検証として追跡のみ行う。", "");

// 5b. 本番反映条件チェックリスト
lines.push("## 5b. 本番反映条件チェックリスト", "");
lines.push("**全て ✅ になるまで本番反映しないこと**", "");
{
  const fwdN = confirmedForward.length;
  const fwdHits = fwdMetrics.hits;
  const fwdRoiExMax = fwdMetrics.roiExMaxHit;
  const hasNonAugust = fwdMonths.some(m => !m.ym.endsWith("-08") && (m.nEval ?? 0) > 0);
  const staleOk = totalInDB <= attempted;

  const checks: { label: string; value: string; ok: boolean }[] = [
    {
      label: "forward n >= 100",
      value: `現在 n=${fwdN}`,
      ok: fwdN >= 100,
    },
    {
      label: "hit >= 5",
      value: `現在 ${fwdHits}hits`,
      ok: fwdHits >= 5,
    },
    {
      label: "roiExMaxHit >= 100%",
      value: fwdRoiExMax !== null ? `現在 ${fwdRoiExMax.toFixed(1)}%` : "未集計",
      ok: fwdRoiExMax !== null && fwdRoiExMax >= 100,
    },
    {
      label: "月8以外を含む (月4/6/12 のいずれか)",
      value: hasNonAugust ? "含む" : "月8のみ",
      ok: hasNonAugust,
    },
    {
      label: "staleRows = 0",
      value: `staleRows=${Math.max(0, totalInDB - attempted)}`,
      ok: staleOk,
    },
    {
      label: "本番decision/app_settings 変更なし",
      value: "変更なし (このスクリプトは変更しない)",
      ok: true,
    },
  ];

  const allOk = checks.every(c => c.ok);
  lines.push(`| 条件 | 現状 | 判定 |`);
  lines.push(`|---|---|:---:|`);
  for (const c of checks) {
    lines.push(`| ${c.label} | ${c.value} | ${c.ok ? "✅" : "❌"} |`);
  }
  lines.push("");
  lines.push(allOk
    ? "**→ 全条件クリア: 本番反映を検討してよい段階**"
    : `**→ 未達: あと ${checks.filter(c => !c.ok).length} 項目。引き続き観測のみ**`);
  lines.push("");
}

// 6. 生データサマリー
lines.push("## 6. Forward 記録一覧 (先頭30件)", "");
lines.push("| date | venue | raceNo | selection | odds | result | hit | status |");
lines.push("|---|---|---:|---|---:|---|---|---|");
for (const r of forwardRows.slice(0, 30)) {
  const hitStr = r.hit === null ? "pending" : r.hit === 1 ? "✓" : "✗";
  lines.push(`| ${r.date} | ${r.venue} | ${r.race_no} | ${r.selection} | ${r.current_odds.toFixed(1)} | ${r.result ?? "-"} | ${hitStr} | ${r.review_status} |`);
}
if (forwardRows.length > 30) lines.push(`| ... | ${forwardRows.length - 30}件省略 | | | | | | |`);
lines.push("");

const reportData = {
  generatedAt: new Date().toISOString(),
  conditionName: CONDITION_NAME,
  conditionDesc: CONDITION_DESC,
  forwardStart: FORWARD_START,
  historicalBaseline: HISTORICAL_BASELINE,
  rerunSafety: {
    rerunSafe: true,
    uniqueKey: "condition_name + race_id",
    uniqueKeyNote: "将来複数selection対応するなら UNIQUE(condition_name, race_id, selection) 推奨",
    attempted,
    insertedRows,
    ignoredRows,
    duplicateCount,
    totalRows: totalInDB,
    staleRows: Math.max(0, totalInDB - attempted),
    staleWarning: totalInDB > attempted
      ? `DB合計 ${totalInDB} > 正しいセット ${attempted}: 差分${totalInDB - attempted}件は旧スクリプトで登録された誤データの可能性あり。クリーンアップには DELETE FROM paper_roi_candidates WHERE condition_name='${CONDITION_NAME}' が必要 (要ユーザー承認)`
      : null,
  },
  totals: {
    historical: historicalRows.length,
    forward: forwardRows.length,
    forwardConfirmed: confirmedForward.length,
    forwardPending: pendingForward.length,
  },
  histMetrics,
  forwardMetrics: fwdMetrics,
  forwardMonthBreakdown: fwdMonths,
  forwardOddsBands: fwdOdds,
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"));
writeFileSync(OUT_JSON, `${JSON.stringify(reportData, null, 2)}\n`);
console.log(`[paper-forward] wrote ${OUT_MD}`);
console.log(`[paper-forward] wrote ${OUT_JSON}`);
console.log(`[paper-forward] historical: ${historicalRows.length}, forward: ${forwardRows.length} (confirmed: ${confirmedForward.length}, pending: ${pendingForward.length})`);
if (fwdMetrics.roi !== null) {
  console.log(`[paper-forward] forward ROI: ${fwdMetrics.roi.toFixed(1)}% (n=${confirmedForward.length})`);
} else {
  console.log("[paper-forward] forward ROI: 未確定 (結果待ち)");
}

db.close();
