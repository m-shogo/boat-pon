/**
 * report-research-governor.ts
 *
 * 禁止: 既存DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標。購入指示・採用判断ではない。
 *
 * 目的: 研究仮説の状態を自動集計し、次にやるべき1本・禁止事項・データ準備状況を出力する。
 *   - data/research-hypotheses.json を読み込み
 *   - 各種 reports/*.json から最新データを取得
 *   - DB から現在のデータ準備状況を集計
 *   - 人間が迷わず次のアクションを決められる司令塔レポートを生成
 *
 * writeは一切しない。提案のみ。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH   = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const HYP_PATH  = "data/research-hypotheses.json";
const OUT_MD    = "reports/research-governor.md";
const OUT_JSON  = "reports/research-governor.json";

const REPORT_FILES = {
  roiGovernor:            "reports/roi-governor.json",
  altOddsQuality:         "reports/historical-alternative-odds-quality.json",
  condBSwitch:            "reports/condb-switch-historical-closing-odds.json",
  skip6RSwitch:           "reports/skip6r-switch-historical-closing-odds.json",
  skipVenueSwitch:        "reports/skipvenue-switch-historical-closing-odds.json",
  timeseriesHealth:       "reports/alternative-odds-timeseries-health.json",
  skipPolicy:             "reports/roi-skip-policy-simulation.json",
  paperForwardMonitor:    "reports/paper-forward-monitor.json",
  paperForwardCandidates: "reports/paper-forward-candidates.json",
};

// ─── JSON ロードヘルパー ──────────────────────────────────────────────────────

function loadJson(path: string, label: string): { ok: boolean; data: Record<string, unknown> | null; warn: string | null } {
  if (!existsSync(path)) return { ok: false, data: null, warn: `⚠️ ${label} not found: ${path}` };
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    return { ok: true, data, warn: null };
  } catch {
    return { ok: false, data: null, warn: `⚠️ ${label} parse error: ${path}` };
  }
}

const warnings: string[] = [];
function w(msg: string) { warnings.push(msg); console.warn(msg); }

// ─── 仮説レジストリ読み込み ──────────────────────────────────────────────────

if (!existsSync(HYP_PATH)) { console.error(`仮説レジストリ not found: ${HYP_PATH}`); process.exit(1); }
type Hypothesis = {
  id: string; name: string; description: string; status: string; priority: number;
  adoptionAllowed: boolean; adoptionBlockReason?: string;
  lastKnownMetrics?: Record<string, unknown>;
  gateStatus?: Record<string, boolean | null>;
  requiredData?: string[];
  dataReadiness?: Record<string, string>;
  nextAction?: string;
  blockedReason?: string;
  nextReviewTrigger?: string;
  notes?: string[];
};
type Registry = { _meta: Record<string, unknown>; hypotheses: Hypothesis[] };
const registry = JSON.parse(readFileSync(HYP_PATH, "utf-8")) as Registry;
const hypotheses = registry.hypotheses;

// ─── レポートファイル読み込み ─────────────────────────────────────────────────

const r_condBSwitch   = loadJson(REPORT_FILES.condBSwitch, "condB switch report");
const r_skip6RSwitch  = loadJson(REPORT_FILES.skip6RSwitch, "skip6R switch report");
const r_skipVenueSwitch = loadJson(REPORT_FILES.skipVenueSwitch, "skipVenue switch report");
const r_altOdds       = loadJson(REPORT_FILES.altOddsQuality, "alt-odds quality");
const r_timeseries    = loadJson(REPORT_FILES.timeseriesHealth, "timeseries health");
const r_skipPolicy    = loadJson(REPORT_FILES.skipPolicy, "skip policy");
const r_roiGov        = loadJson(REPORT_FILES.roiGovernor, "roi-governor");
const r_monitor       = loadJson(REPORT_FILES.paperForwardMonitor, "paper-forward-monitor");

for (const r of [r_condBSwitch, r_altOdds, r_timeseries, r_skipPolicy, r_roiGov, r_monitor]) {
  if (!r.ok && r.warn) w(r.warn);
}

// ─── DB からデータ準備状況を集計 ─────────────────────────────────────────────

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const EXCL_V = `'戸田','多摩川','桐生','三国','江戸川'`;
const EXCL_R = "10,11,12";
const FORWARD_START = "2025-01-01";

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1 = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const baseWhere = `
  dh.decision='BUY' AND dh.run_kind='historical-backfill'
  AND dh.result IS NOT NULL AND dh.result != ''
  AND dh.current_odds IS NOT NULL
  AND dh.venue NOT IN (${EXCL_V})
  AND dh.race_no NOT IN (${EXCL_R})
  AND dh.selection='1-2-3'
  AND dh.date >= '${FORWARD_START}'`;

type NRow = { n: number };

const fwdTotal      = (db.prepare(`SELECT COUNT(DISTINCT dh.race_id) n FROM decision_history dh WHERE ${baseWhere}`).get() as NRow).n;
const condBTotal    = (db.prepare(`SELECT COUNT(DISTINCT dh.race_id) n FROM decision_history dh WHERE ${baseWhere} AND ${WIND24} AND ${EXH1}`).get() as NRow).n;
const skip6RTotal   = (db.prepare(`SELECT COUNT(DISTINCT dh.race_id) n FROM decision_history dh WHERE ${baseWhere} AND dh.race_no=6`).get() as NRow).n;
const skipVenueTotal= (db.prepare(`SELECT COUNT(DISTINCT dh.race_id) n FROM decision_history dh WHERE ${baseWhere} AND dh.venue IN ('浜名湖','住之江')`).get() as NRow).n;

const haoCondB      = (db.prepare(`SELECT COUNT(DISTINCT hao.race_id) n FROM historical_alternative_odds hao JOIN decision_history dh ON dh.race_id=hao.race_id WHERE hao.source_quality='historical_closing_odds' AND ${baseWhere.replace(/dh\./g, 'dh.')} AND ${WIND24} AND ${EXH1}`).get() as NRow).n;
const haoSkip6R     = (db.prepare(`SELECT COUNT(DISTINCT hao.race_id) n FROM historical_alternative_odds hao JOIN decision_history dh ON dh.race_id=hao.race_id WHERE hao.source_quality='historical_closing_odds' AND ${baseWhere} AND dh.race_no=6`).get() as NRow).n;
const haoSkipVenue  = (db.prepare(`SELECT COUNT(DISTINCT hao.race_id) n FROM historical_alternative_odds hao JOIN decision_history dh ON dh.race_id=hao.race_id WHERE hao.source_quality='historical_closing_odds' AND ${baseWhere} AND dh.venue IN ('浜名湖','住之江')`).get() as NRow).n;

// odds_timeseries x BUY forward overlap
type TsRow = { n_total: number; n_condb: number; min_date: string; max_date: string };
let tsOverlapTotal = 0, tsOverlapCondB = 0, tsMinDate = "—", tsMaxDate = "—";
try {
  const tsRow = db.prepare(`
    SELECT
      COUNT(DISTINCT ots.race_id) n_total,
      SUM(CASE WHEN ${WIND24.replace(/dh\./g, 'dh.')} AND ${EXH1.replace(/dh\./g, 'dh.')} THEN 1 ELSE 0 END) n_condb,
      MIN(dh.date) min_date, MAX(dh.date) max_date
    FROM odds_timeseries_snapshots ots
    JOIN decision_history dh ON dh.race_id=ots.race_id
    WHERE ${baseWhere}
      AND ots.checkpoint_label='T-5'
  `).get() as TsRow | null;
  if (tsRow) {
    tsOverlapTotal = tsRow.n_total ?? 0;
    tsOverlapCondB = tsRow.n_condb ?? 0;
    tsMinDate = tsRow.min_date ?? "—";
    tsMaxDate = tsRow.max_date ?? "—";
  }
} catch { w("⚠️ timeseries overlap query error"); }

// ─── データ準備状況 ───────────────────────────────────────────────────────────

const dataReadiness = {
  forwardTotal: fwdTotal,
  condB: { total: condBTotal, haoSaved: haoCondB, coverage: condBTotal > 0 ? Math.round(haoCondB / condBTotal * 100) : 0 },
  skip6R: { total: skip6RTotal, haoSaved: haoSkip6R, coverage: skip6RTotal > 0 ? Math.round(haoSkip6R / skip6RTotal * 100) : 0 },
  skipVenue: { total: skipVenueTotal, haoSaved: haoSkipVenue, coverage: skipVenueTotal > 0 ? Math.round(haoSkipVenue / skipVenueTotal * 100) : 0 },
  timeseries: {
    buyForwardOverlap: tsOverlapTotal,
    condBOverlap: tsOverlapCondB,
    dateRange: tsOverlapTotal > 0 ? `${tsMinDate} 〜 ${tsMaxDate}` : "なし",
    futureOnlySwitchReady: tsOverlapCondB >= 30,
  },
};

// ─── 次にやるべき1本 ─────────────────────────────────────────────────────────

let nextAction = "";
let nextActionCommand = "";
let nextActionPriority = 0;

if (dataReadiness.timeseries.futureOnlySwitchReady) {
  nextAction = "condB future-only odds_timeseries 確認 (timeseries overlap n>=30 達成)";
  nextActionCommand = "pnpm analyze:condb-switch-historical (timeseries版 実装後)";
  nextActionPriority = 1;
} else if (dataReadiness.condB.coverage < 100) {
  nextAction = `condB historical closing odds 残件取得 (${condBTotal - haoCondB}件未保存)`;
  nextActionCommand = `pnpm backfill:historical-alt-odds --limit 10 --priority condB --write --sleep-ms 1000`;
  nextActionPriority = 2;
} else if (dataReadiness.skip6R.coverage < 100) {
  nextAction = `skip6R historical alternative odds の小規模backfill準備 (${skip6RTotal - haoSkip6R}/${skip6RTotal}件未保存)`;
  nextActionCommand = `pnpm backfill:historical-alt-odds --limit 30 --priority skip6R --write --sleep-ms 1000`;
  nextActionPriority = 3;
} else if (!r_skip6RSwitch.ok) {
  nextAction = "skip6R switch 予備検証 (H004) を実行";
  nextActionCommand = "pnpm analyze:skip6r-switch-historical";
  nextActionPriority = 4;
} else if (dataReadiness.skipVenue.coverage < 100) {
  nextAction = `skipVenue historical alternative odds の小規模backfill準備 (${skipVenueTotal - haoSkipVenue}/${skipVenueTotal}件未保存, H006用)`;
  nextActionCommand = `pnpm backfill:historical-alt-odds --limit 30 --priority skipVenue --write --sleep-ms 1000`;
  nextActionPriority = 5;
} else if (!r_skipVenueSwitch.ok) {
  nextAction = "skipVenue switch 予備検証 (H006) を実行";
  nextActionCommand = "pnpm analyze:skipvenue-switch-historical";
  nextActionPriority = 6;
} else {
  nextAction = "switch検証は全て完了 (H004/H006 とも switch reject)。condB timeseries overlap 蓄積待ち。次の大型候補: 全券種ROIシミュレーター";
  nextActionCommand = "pnpm report:paper-forward-monitor (monitor継続)";
  nextActionPriority = 7;
}

const condBSwitchMetrics = r_condBSwitch.ok && r_condBSwitch.data
  ? (r_condBSwitch.data as { verdict?: Record<string, unknown> }).verdict ?? {}
  : {};

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# Research Governor`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **⚠️ BUY は検証候補。ROI は検証指標。購入指示・採用判断ではない。**`);
lines.push(`> **app_settings / 本番 decision / 自動投票 は絶対に変更しない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);

// A. 現在フェーズ
lines.push(`## A. 現在フェーズ`);
lines.push(``);
lines.push(`| 項目 | 状態 |`);
lines.push(`|---|---|`);
lines.push(`| フェーズ | **research-monitor** (monitor-only) |`);
lines.push(`| app_settings 反映候補 | **なし** |`);
lines.push(`| 本番 decision 変更 | **禁止** |`);
lines.push(`| 自動投票 | **禁止** |`);
lines.push(`| forward baseline ROI | ${(r_skipPolicy.data as { baseline?: { roi?: number } } | null)?.baseline?.roi ?? 87.12}% (n=${fwdTotal}) |`);
lines.push(`| 採用可能な edge | **なし** |`);
lines.push(``);

// B. 次にやるべき1本
lines.push(`## B. 次にやるべき1本`);
lines.push(``);
lines.push(`**${nextAction}**`);
lines.push(``);

if (nextActionPriority === 3) {
  lines.push(`> ⚠️ **書き込みを行う場合は以下の手順を守ること:**`);
  lines.push(`> 1. backup を先に実行: \`pnpm backup\``);
  lines.push(`> 2. dry-run で確認: \`pnpm backfill:historical-alt-odds --limit 5 --priority skip6R\``);
  lines.push(`> 3. 人間確認後に小規模 write: \`${nextActionCommand}\``);
  lines.push(`> 4. historical_alternative_odds のみへの INSERT`);
  lines.push(`> 5. 既存テーブルへの書き込みは禁止`);
} else {
  lines.push(`実行候補: \`${nextActionCommand}\``);
}
lines.push(``);

if (warnings.length > 0) {
  lines.push(`**⚠️ 警告:**`);
  for (const w of warnings) lines.push(`- ${w}`);
  lines.push(``);
}

// C. 今やってはいけないこと
lines.push(`## C. 今やってはいけないこと`);
lines.push(``);
const forbidden = [
  "app_settings 変更",
  "本番 decision ロジック変更",
  "1-3-5 / 1-3-6 新規買い目追加",
  "選手相性の深掘り (condB/skip 完了前)",
  "allForward 一括 backfill (--priority allForward --write)",
  "複数仮説の同時採用",
  "historical closing odds を live/T-5 forward として扱うこと",
  "top2除外ROI < 100% の候補を採用すること (condB top2=92.2%)",
  "future-only timeseries 未確認の候補を本採用すること",
  "skip6R / skipVenue の write (今回は確認ステップを先に)",
];
for (const f of forbidden) lines.push(`- ❌ ${f}`);
lines.push(``);

// D. 仮説一覧
lines.push(`## D. 仮説一覧`);
lines.push(``);

const statusEmoji: Record<string, string> = {
  "testing-historical": "🔬",
  "testing-ready":      "🟡",
  "tested-historical":  "🟠",
  "monitor":            "👁️",
  "waiting-data":       "⏳",
  "secondary":          "🔵",
  "backlog":            "📋",
  "frozen":             "🧊",
  "rejected":           "❌",
};

lines.push(`| ID | 名前 | 状態 | 採用可否 | 次アクション |`);
lines.push(`|---|---|---|:---:|---|`);
for (const h of hypotheses.sort((a, b) => a.priority - b.priority)) {
  const e = statusEmoji[h.status] ?? "—";
  const adp = h.adoptionAllowed ? "✅" : "❌ 不可";
  lines.push(`| ${h.id} | ${h.name} | ${e} ${h.status} | ${adp} | ${h.nextAction ?? "—"} |`);
}
lines.push(``);

// H001 詳細
const h001 = hypotheses.find(h => h.id === "H001");
if (h001) {
  lines.push(`### H001 condB 1-3-2 switch 詳細`);
  lines.push(``);
  lines.push(`| 指標 | 値 |`);
  lines.push(`|---|---|`);
  const m = h001.lastKnownMetrics ?? {};
  lines.push(`| condB n | ${m.condB_n ?? "—"} |`);
  lines.push(`| baseline 1-2-3 ROI | ${m.baseline_1_2_3_roi ?? "—"}% |`);
  lines.push(`| switch 1-3-2 ROI | **${m.switch_1_3_2_roi ?? "—"}%** |`);
  lines.push(`| top2除外 ROI | **${m.switch_1_3_2_top2ExcludeRoi ?? "—"}%** ← 100%未達 ❌ |`);
  lines.push(`| 2025-07除外 ROI | ${m.switch_1_3_2_excl2507_roi ?? "—"}% |`);
  lines.push(`| hybrid condB→1-3-2 ROI | ${m.hybrid_condB_1_3_2_roi ?? "—"}% |`);
  lines.push(`| skip残存 ROI | ${m.skip_remaining_roi ?? "—"}% |`);
  lines.push(`| 直近3M n | ${m.recent3mN === 0 ? "0 (データなし)" : (m.recent3mN ?? "—")} |`);
  lines.push(`| odds ソース | ${m.odds_source ?? "—"} |`);
  lines.push(`| future-only 確認 | ❌ 未確認 |`);
  lines.push(`| **本採用判断** | **❌ 不可** |`);
  lines.push(``);
  const g = h001.gateStatus ?? {};
  lines.push(`**Gate 判定**`);
  lines.push(``);
  lines.push(`| Gate | 結果 |`);
  lines.push(`|---|---|`);
  lines.push(`| n ≥ 30 | ${g.nSufficient ? "✅" : "❌"} |`);
  lines.push(`| ROI > baseline | ${g.roiBeatsBaseline ? "✅" : "❌"} |`);
  lines.push(`| top2除外ROI ≥ 100% | ${g.top2ExcludeRoiOk ? "✅" : "❌ 92.2%"} |`);
  lines.push(`| 直近3ヶ月 OK | ${g.recent3mOk === null ? "⚠️ 判定不可 (n=0)" : g.recent3mOk ? "✅" : "❌"} |`);
  lines.push(`| future-only 確認済み | ${g.futureOnlyConfirmed ? "✅" : "❌ 未確認"} |`);
  lines.push(``);
}

// E. データ準備状況
lines.push(`## E. データ準備状況`);
lines.push(``);
lines.push(`| 項目 | 対象 | 保存済 | coverage |`);
lines.push(`|---|---:|---:|---:|`);
lines.push(`| condB historical closing odds | ${dataReadiness.condB.total} | ${dataReadiness.condB.haoSaved} | ${dataReadiness.condB.coverage}% |`);
lines.push(`| skip6R historical closing odds | ${dataReadiness.skip6R.total} | ${dataReadiness.skip6R.haoSaved} | ${dataReadiness.skip6R.coverage}% |`);
lines.push(`| skipVenue historical closing odds | ${dataReadiness.skipVenue.total} | ${dataReadiness.skipVenue.haoSaved} | ${dataReadiness.skipVenue.coverage}% |`);
lines.push(`| timeseries BUY forward overlap (T-5) | — | ${dataReadiness.timeseries.buyForwardOverlap} | — |`);
lines.push(`| timeseries condB overlap (T-5) | — | ${dataReadiness.timeseries.condBOverlap} | — |`);
lines.push(``);
lines.push(`| 項目 | 状態 |`);
lines.push(`|---|---|`);
lines.push(`| condB historical odds 完備 | ${dataReadiness.condB.coverage >= 99 ? "✅ 完了" : "⚠️ 未完了"} |`);
lines.push(`| skip6R historical odds 完備 | ${dataReadiness.skip6R.coverage >= 99 ? "✅" : `❌ ${dataReadiness.skip6R.haoSaved}/${dataReadiness.skip6R.total}`} |`);
lines.push(`| skipVenue historical odds 完備 | ${dataReadiness.skipVenue.coverage >= 99 ? "✅" : `❌ ${dataReadiness.skipVenue.haoSaved}/${dataReadiness.skipVenue.total}`} |`);
lines.push(`| future-only switch 評価可能 | ${dataReadiness.timeseries.futureOnlySwitchReady ? "✅ (n>=30)" : `❌ condB overlap n=${dataReadiness.timeseries.condBOverlap} (<30)`} |`);
lines.push(`| timeseries 日付範囲 | ${dataReadiness.timeseries.dateRange} |`);
lines.push(``);

// F. Gate 判定サマリ
lines.push(`## F. Gate 判定`);
lines.push(``);
lines.push(`| Gate 条件 | condB 1-3-2 | 6R skip (H003) | 6R switch (H004) | venue skip (H005) | venue switch (H006) |`);
lines.push(`|---|:---:|:---:|:---:|:---:|:---:|`);
lines.push(`| historical closing odds 完備 | ✅ 167/167 | ✅ 215/215 | ✅ 215/215 | ✅ 159/159 | ✅ 159/159 |`);
lines.push(`| データ品質 OK | ✅ | ✅ | ✅ | ✅ | ✅ |`);
lines.push(`| n ≥ 100 | ✅ | ✅ | ✅ | ✅ | ✅ |`);
lines.push(`| ROI > baseline | ✅ (174.4% vs 65.6%) | ✅ (97.95%) | ❌ 全候補<100% | ✅ (97.3%) | ❌ 安定候補なし |`);
lines.push(`| top2除外ROI ≥ 100% | ❌ 92.2% | ❌ 88.94% | ❌ best 39.7% | ❌ 88.8% | ❌ best 29.4% |`);
lines.push(`| 期間依存なし | ✅ (162.4%) | ✅ | ❌ 0hit月4〜7 | ⚠️ forward要確認 | ❌ 0hit月6〜8 |`);
lines.push(`| future-only 確認済 | ❌ | — (monitor) | 未対象 | — (monitor) | 未対象 |`);
lines.push(`| switch 判定 | watch | — | **reject** | — | **reject** |`);
lines.push(`| skip 判定 | — | watch | — | watch | — |`);
lines.push(`| **本採用可 (app_settings反映)** | **❌** | **❌** | **❌** | **❌** | **❌** |`);
lines.push(``);

// G. 状態分類
lines.push(`## G. 状態分類`);
lines.push(``);
const statusGroups: Record<string, Hypothesis[]> = {};
for (const h of hypotheses) {
  if (!statusGroups[h.status]) statusGroups[h.status] = [];
  statusGroups[h.status].push(h);
}
const statusOrder = ["testing-historical", "testing-ready", "tested-historical", "monitor", "waiting-data", "secondary", "backlog", "frozen", "rejected"];
for (const s of statusOrder) {
  const group = statusGroups[s] ?? [];
  if (group.length === 0) continue;
  const e = statusEmoji[s] ?? "—";
  lines.push(`**${e} ${s}**: ${group.map(h => `${h.id} ${h.name}`).join(" / ")}`);
  lines.push(``);
}

// H. write 許可
lines.push(`## H. write 許可`);
lines.push(``);
lines.push(`**今回: 自動 write 禁止**`);
lines.push(``);
const backfillRemaining =
  (dataReadiness.condB.total - dataReadiness.condB.haoSaved) +
  (dataReadiness.skip6R.total - dataReadiness.skip6R.haoSaved) +
  (dataReadiness.skipVenue.total - dataReadiness.skipVenue.haoSaved);
if (backfillRemaining > 0) {
  lines.push(`人間確認後に次回実行可能な候補:`);
  lines.push(``);
  lines.push(`\`\`\`bash`);
  lines.push(`# 1. 事前 backup → 2. dry-run 確認 → 3. 人間確認後に小規模 write`);
  lines.push(`pnpm backup`);
  lines.push(`pnpm backfill:historical-alt-odds --limit 30 --priority <condB|skip6R|skipVenue> --sleep-ms 1000`);
  lines.push(`\`\`\``);
} else {
  lines.push(`**現時点で historical closing odds backfill の write 候補なし** (condB ${dataReadiness.condB.haoSaved}/${dataReadiness.condB.total} / skip6R ${dataReadiness.skip6R.haoSaved}/${dataReadiness.skip6R.total} / skipVenue ${dataReadiness.skipVenue.haoSaved}/${dataReadiness.skipVenue.total} すべて完走済み)。`);
  lines.push(``);
  lines.push(`次は monitor 継続、または全券種ROIシミュレーター (読み取り専用) が候補。完了済み backfill を再実行しないこと。`);
}
lines.push(``);
lines.push(`> ⚠️ 既存テーブル (odds_snapshots / odds_timeseries_snapshots) への書き込みは禁止`);
lines.push(``);

// I. 1行結論
const oneLiner = `次は「${nextAction}」（write系は人間確認後）。switch検証: H004 6R=reject / H006 venue=reject / H001 condBはfuture-only timeseries overlap蓄積待ち（historical 174.4%だがtop2=92.2%）。skip: H003 6R / H005 venueともwatch（top2除外<100%・in-sampleバイアスありforward確認要）。本採用可能な edge はなし。次の大型候補は全券種ROIシミュレーター。`;
lines.push(`## I. 1行結論`);
lines.push(``);
lines.push(`> **${oneLiner}**`);
lines.push(``);

// 注記
lines.push(`---`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- condB 1-3-2 switch は **historical closing odds では有望** (ROI=174.4%)`);
lines.push(`- ただし **top2除外ROI=92.2% で 100% 未達** → 格上げ条件を満たさない`);
lines.push(`- **future-only odds_timeseries 未確認** → 本採用不可`);
lines.push(`- **historical closing odds は live/T-5 forward ではない**`);
lines.push(`- **app_settings 反映候補なし**`);
lines.push(`- **現時点で本採用可能な edge はなし**`);
lines.push(`- skip monitor は継続`);
lines.push(`- 1-3-5 / 1-3-6 の追加は過学習リスクのため禁止`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: report-research-governor.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  phase: "research-monitor",
  warnings,
  nextAction: { priority: nextActionPriority, action: nextAction, command: nextActionCommand },
  dataReadiness,
  hypotheses: hypotheses.map(h => ({
    id: h.id, name: h.name, status: h.status, priority: h.priority,
    adoptionAllowed: h.adoptionAllowed,
    adoptionBlockReason: h.adoptionBlockReason ?? null,
    nextAction: h.nextAction ?? null,
    blockedReason: h.blockedReason ?? null,
    gateStatus: h.gateStatus ?? null,
    lastKnownMetrics: h.lastKnownMetrics ?? null,
  })),
  condBSwitchVerdict: condBSwitchMetrics,
  forbidden: forbidden,
  oneLiner,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log("=== Research Governor ===");
console.log(`  フェーズ: research-monitor`);
console.log(`  次にやるべき1本: ${nextAction}`);
console.log(`  採用可能な edge: なし`);
console.log(`  condB timeseries overlap: ${dataReadiness.timeseries.condBOverlap}`);
console.log(`  skip6R hao coverage: ${dataReadiness.skip6R.haoSaved}/${dataReadiness.skip6R.total}`);
if (warnings.length > 0) console.log(`  ⚠️ 警告: ${warnings.length}件`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
