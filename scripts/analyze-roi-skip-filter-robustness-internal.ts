/**
 * analyze-roi-skip-filter-robustness.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 主評価: race_payouts.payout_yen 実払戻ベース
 *
 * 前回 analyze:roi-skip-filters の結果から、見送り候補の頑健性を検証する。
 * - 2025-07 依存度（後付きか構造的か）
 * - 高配当依存度（1件依存か継続的か）
 * - 月別安定性（局所的か横断的か）
 * - 候補間の重複率
 * - 複合除外セットの効果
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/roi-skip-filter-robustness.md";
const OUT_JSON = "reports/roi-skip-filter-robustness.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const JUL25_PREFIX = "2025-07";
const FWD_H2_START = "2025-09-01"; // forward後半開始
const EXCL_VENUES  = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES   = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

function r2(v: number) { return Math.round(v * 100) / 100; }
function calcRoi(payout: number, n: number) { return n > 0 ? r2(payout / (n * STAKE) * 100) : 0; }
function fmtDelta(v: number) {
  if (v >= 2)  return `**+${v}pt**`;
  if (v <= -2) return `**${v}pt**`;
  return `${v}pt`;
}

// ─── 直近3M 動的取得 ─────────────────────────────────────────────────────────────

const dbMaxDate = (db.prepare(
  "SELECT MAX(date) as d FROM decision_history WHERE date >= ?"
).get(FORWARD_START) as { d: string }).d;
const recent3mCutoff = (() => {
  const [y, m, d] = dbMaxDate.split("-").map(Number);
  const dt = new Date(y, m - 4, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
})();

// ─── 全 forward BUY 取得 ────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

type ForwardRow = {
  date: string; venue: string; race_no: number;
  current_odds: number; result: string; payout: number; is_condB: number;
};

console.log("[robustness] forward BUY 取得中...");
const allRows = db.prepare(`
  SELECT dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp
      WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta'
        AND rp.combination='1-2-3' LIMIT 1), 0) as payout,
    CASE WHEN (${WIND24}) AND (${EXH1}) THEN 1 ELSE 0 END as is_condB
  FROM decision_history dh
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND current_odds IS NOT NULL
    AND venue NOT IN (${excl_v}) AND race_no NOT IN (${excl_r})
    AND selection='1-2-3' AND date >= '${FORWARD_START}'
  ORDER BY date
`).all() as ForwardRow[];

const totalN      = allRows.length;
const totalPayout = allRows.reduce((a, r) => a + r.payout, 0);
const totalHits   = allRows.filter(r => r.result === "1-2-3").length;
const baselineRoi = calcRoi(totalPayout, totalN);
console.log(`[robustness] n=${totalN} hits=${totalHits} ROI=${baselineRoi}%`);

// ─── 汎用統計 ────────────────────────────────────────────────────────────────────

type SliceStats = {
  n: number; payout: number; hits: number; roi: number;
  top1Roi: number; top2Roi: number; top3Roi: number;
  jackpotRatio: number; maxPayout: number;
};

function sliceStats(rows: ForwardRow[]): SliceStats {
  const n = rows.length;
  const payout = rows.reduce((a, r) => a + r.payout, 0);
  const hits   = rows.filter(r => r.result === "1-2-3").length;
  const sorted = [...rows].sort((a, b) => b.payout - a.payout).map(r => r.payout);
  const top1 = sorted[0] ?? 0;
  const top2 = top1 + (sorted[1] ?? 0);
  const top3 = top2 + (sorted[2] ?? 0);
  return {
    n, payout, hits, roi: calcRoi(payout, n),
    top1Roi: calcRoi(payout - top1, n),
    top2Roi: calcRoi(payout - top2, n),
    top3Roi: calcRoi(payout - top3, n),
    jackpotRatio: payout > 0 ? r2(top1 / payout * 100) : 0,
    maxPayout: top1,
  };
}

function skipEffect(excluded: ForwardRow[]): { remainN: number; remainRoi: number; delta: number } {
  const remainN      = totalN - excluded.length;
  const remainPayout = totalPayout - excluded.reduce((a, r) => a + r.payout, 0);
  const remainRoi    = calcRoi(remainPayout, remainN);
  return { remainN, remainRoi, delta: r2(remainRoi - baselineRoi) };
}

type MonthSlice = { month: string; n: number; hits: number; roi: number };

function monthlySlice(rows: ForwardRow[], minN = 3): MonthSlice[] {
  const months = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
  return months.map(m => {
    const mRows = rows.filter(r => r.date.startsWith(m));
    return {
      month: m, n: mRows.length,
      hits: mRows.filter(r => r.result === "1-2-3").length,
      roi: calcRoi(mRows.reduce((a, r) => a + r.payout, 0), mRows.length),
    };
  }).filter(m => m.n >= minN);
}

// ─── 候補定義 ────────────────────────────────────────────────────────────────────

type CandidateDef = { id: string; name: string; pred: (r: ForwardRow) => boolean };

const CANDIDATES: CandidateDef[] = [
  { id: "jul25",    name: "2025-07",             pred: r => r.date.startsWith("2025-07") },
  { id: "r6",       name: "6R",                  pred: r => r.race_no === 6 },
  { id: "r5",       name: "5R",                  pred: r => r.race_no === 5 },
  { id: "r2",       name: "2R",                  pred: r => r.race_no === 2 },
  { id: "hamanako", name: "浜名湖",               pred: r => r.venue === "浜名湖" },
  { id: "suminoe",  name: "住之江",               pred: r => r.venue === "住之江" },
  { id: "odds4079", name: "odds40〜79",           pred: r => r.current_odds >= 40 && r.current_odds < 80 },
  { id: "condB",    name: "条件B重複",             pred: r => r.is_condB === 1 },
];

// ─── 複合セット ──────────────────────────────────────────────────────────────────

type ComboSet = { id: string; name: string; ids: string[] };

const COMBO_SETS: ComboSet[] = [
  { id: "A", name: "odds40〜79",               ids: ["odds4079"] },
  { id: "B", name: "浜名湖+住之江",             ids: ["hamanako", "suminoe"] },
  { id: "C", name: "2R+5R+6R",               ids: ["r2", "r5", "r6"] },
  { id: "D", name: "odds40〜79+浜名湖+住之江", ids: ["odds4079", "hamanako", "suminoe"] },
  { id: "E", name: "odds40〜79+2R+5R+6R",    ids: ["odds4079", "r2", "r5", "r6"] },
  { id: "F", name: "全候補(2025-07除く)",      ids: ["odds4079", "hamanako", "suminoe", "r2", "r5", "r6", "condB"] },
  { id: "G", name: "全候補合計",               ids: CANDIDATES.map(c => c.id) },
];

// ─── 候補別分析 ──────────────────────────────────────────────────────────────────

type CandidateResult = {
  id: string; name: string;
  // 単独除外
  slice: SliceStats;
  skip: { remainN: number; remainRoi: number; delta: number };
  // 2025-07 依存チェック
  inJul25: SliceStats;
  exJul25: SliceStats;
  deltaExJul25: number; // skip効果 (2025-07除外の全体ベースで計算)
  // forward前半/後半
  h1: SliceStats; h2: SliceStats;
  // 直近3M
  recent: SliceStats;
  // 月別安定性（候補内）
  monthly: MonthSlice[];
  weakMonths: number;  // ROI < 50% の月数
  totalMonths: number;
  // odds プロファイル（候補内の分布）
  oddsLt20Pct: number; odds2039Pct: number;
  odds4079Pct: number; odds80Pct: number;
  // 他候補との重複
  overlapPct: Record<string, number>;
  // 判定
  verdicts: string[];
  finalVerdict: string;
};

// 2025-07抜き ベースライン
const exJul25All   = allRows.filter(r => !r.date.startsWith(JUL25_PREFIX));
const exJul25Total = exJul25All.reduce((a, r) => a + r.payout, 0);
const exJul25Base  = calcRoi(exJul25Total, exJul25All.length);

const results: CandidateResult[] = CANDIDATES.map(c => {
  const excluded = allRows.filter(c.pred);
  const slice    = sliceStats(excluded);
  const skip     = skipEffect(excluded);

  const inJul25  = sliceStats(excluded.filter(r => r.date.startsWith(JUL25_PREFIX)));
  const exJul25  = sliceStats(excluded.filter(r => !r.date.startsWith(JUL25_PREFIX)));

  // 2025-07を除いた全体での skip効果
  const exJul25Remain = exJul25All.filter(r => !c.pred(r));
  const deltaExJul25  = r2(
    calcRoi(exJul25Remain.reduce((a, r) => a + r.payout, 0), exJul25Remain.length)
    - exJul25Base
  );

  const h1     = sliceStats(excluded.filter(r => r.date >= FORWARD_START && r.date < FWD_H2_START));
  const h2     = sliceStats(excluded.filter(r => r.date >= FWD_H2_START));
  const recent = sliceStats(excluded.filter(r => r.date >= recent3mCutoff));

  const monthly     = monthlySlice(excluded, 3);
  const weakMonths  = monthly.filter(m => m.roi < 50).length;

  const np = (pred: (r: ForwardRow) => boolean) =>
    excluded.length > 0 ? r2(excluded.filter(pred).length / excluded.length * 100) : 0;

  const oddsLt20Pct  = np(r => r.current_odds < 20);
  const odds2039Pct  = np(r => r.current_odds >= 20 && r.current_odds < 40);
  const odds4079Pct  = np(r => r.current_odds >= 40 && r.current_odds < 80);
  const odds80Pct    = np(r => r.current_odds >= 80);

  const overlapPct: Record<string, number> = {};
  for (const other of CANDIDATES) {
    if (other.id === c.id) continue;
    const ov = excluded.filter(other.pred).length;
    overlapPct[other.id] = excluded.length > 0 ? r2(ov / excluded.length * 100) : 0;
  }

  // 判定ロジック
  const verdicts: string[] = [];
  if (slice.n < 30) verdicts.push("⚫ data-insufficient (n<30)");
  else {
    // 2025-07 依存チェック
    if (slice.n > 0 && inJul25.n / slice.n >= 0.4 && exJul25.roi >= 80) {
      verdicts.push("🟡 2025-07依存疑い (July外でROI回復)");
    } else if (deltaExJul25 >= 2 && exJul25.n >= 20) {
      verdicts.push("🟢 2025-07外でも効果あり (delta=" + deltaExJul25 + "pt)");
    } else if (deltaExJul25 < 1 && exJul25.n >= 20) {
      verdicts.push("🟡 2025-07除外後は効果弱い (delta=" + deltaExJul25 + "pt)");
    }
    // 高配当依存チェック
    if (slice.jackpotRatio > 70 && slice.top2Roi < 10) {
      verdicts.push("⚠️ 高配当1件依存(jackpot=" + slice.jackpotRatio + "%) — top2除外でROIほぼゼロ");
    } else if (slice.jackpotRatio > 70) {
      verdicts.push("🟡 高配当依存あり (jackpot=" + slice.jackpotRatio + "%)");
    }
    // 月別安定性
    if (monthly.length >= 3 && weakMonths >= monthly.length * 0.6) {
      verdicts.push("🟢 月別: " + weakMonths + "/" + monthly.length + "ヶ月でROI<50% (横断的弱さ)");
    } else if (monthly.length >= 3) {
      verdicts.push("⚪ 月別: " + weakMonths + "/" + monthly.length + "ヶ月でROI<50%");
    }
    // 0hit
    if (slice.hits === 0) verdicts.push("🔶 forward期間 0hit");
    // odds40-79 偏り
    if (c.id !== "odds4079" && odds4079Pct > 60) {
      verdicts.push("⚠️ 候補内" + odds4079Pct + "%がodds40〜79 (odds帯効果と混在の可能性)");
    }
  }

  // 最終判定 (優先順序: 月別後付き → 0hit → 構造的弱さ → 高配当依存 → monitor)
  let finalVerdict: string;
  if (slice.n < 30) {
    finalVerdict = "⚫ data-insufficient";
  } else if (skip.delta >= 5 && deltaExJul25 < 0.5) {
    // 大きな改善があるが 2025-07 を除いたら消える → 後付き月別フィルター
    finalVerdict = "⚠️ 後付き月別フィルター — 運用不可";
  } else if (slice.hits === 0 && slice.n >= 30) {
    finalVerdict = "🔴 forward 0hit → 有力見送り候補";
  } else if (
    deltaExJul25 >= 5 &&
    (slice.roi < 65 || weakMonths >= Math.ceil(monthly.length * 0.6))
  ) {
    // 2025-07 外でも大きな効果 かつ 全期間ROI低 or 大半の月で弱い → 構造的弱さ確認
    finalVerdict = "🟢 有力見送り候補";
  } else if (
    deltaExJul25 >= 3 && slice.jackpotRatio <= 70 &&
    weakMonths >= Math.ceil(monthly.length * 0.5)
  ) {
    finalVerdict = "🟢 有力見送り候補";
  } else if (slice.jackpotRatio > 70 && slice.top2Roi < 10 && deltaExJul25 < 5) {
    finalVerdict = "🟡 高配当依存 — 採用保留";
  } else if (inJul25.n / (slice.n || 1) >= 0.4 && exJul25.roi >= 80) {
    finalVerdict = "🟡 2025-07依存疑い";
  } else if (deltaExJul25 >= 1) {
    finalVerdict = "🔵 monitor継続";
  } else {
    finalVerdict = "⚪ 効果不明 — monitor継続";
  }

  return {
    id: c.id, name: c.name,
    slice, skip,
    inJul25, exJul25, deltaExJul25,
    h1, h2, recent,
    monthly, weakMonths, totalMonths: monthly.length,
    oddsLt20Pct, odds2039Pct, odds4079Pct, odds80Pct,
    overlapPct, verdicts, finalVerdict,
  };
});

// ─── 複合セット分析 ──────────────────────────────────────────────────────────────

type ComboResult = {
  id: string; name: string;
  excludedN: number; excludedPct: number;
  overlap: number; // 重複行数（複数候補にまたがる）
  slice: SliceStats;
  skip: { remainN: number; remainRoi: number; delta: number };
  // 2025-07 除外後の効果
  skipExJul25: { remainRoi: number; delta: number };
};

const predMap: Record<string, (r: ForwardRow) => boolean> = Object.fromEntries(
  CANDIDATES.map(c => [c.id, c.pred])
);

const comboResults: ComboResult[] = COMBO_SETS.map(cs => {
  const preds = cs.ids.map(id => predMap[id]).filter(Boolean);
  const excluded = allRows.filter(r => preds.some(p => p(r)));

  // 重複カウント（複数条件に該当する行）
  const overlap = excluded.filter(r => preds.filter(p => p(r)).length > 1).length;

  const slice = sliceStats(excluded);
  const skip  = skipEffect(excluded);

  // 2025-07なし版
  const exJul25Remain = exJul25All.filter(r => !preds.some(p => p(r)));
  const exJul25RemainRoi = calcRoi(
    exJul25Remain.reduce((a, r) => a + r.payout, 0), exJul25Remain.length
  );
  const skipExJul25 = {
    remainRoi: exJul25RemainRoi,
    delta: r2(exJul25RemainRoi - exJul25Base),
  };

  return {
    id: cs.id, name: cs.name,
    excludedN: excluded.length,
    excludedPct: r2(excluded.length / totalN * 100),
    overlap,
    slice, skip, skipExJul25,
  };
});

// ─── Markdown 生成 ───────────────────────────────────────────────────────────────

const now = new Date().toISOString();

// 候補サマリー表
const summaryTable = results.map(r => {
  const j25dep = r.slice.n > 0 ? r2(r.inJul25.n / r.slice.n * 100) : 0;
  return `| ${r.finalVerdict} | ${r.name} | ${r.slice.n} | ${r.slice.roi}% | ${r.skip.remainRoi}% | ${fmtDelta(r.skip.delta)} | ${fmtDelta(r.deltaExJul25)} | ${r.slice.jackpotRatio}% | ${j25dep}% |`;
}).join("\n");

// 月別安定性表
function monthlyTable(r: CandidateResult): string {
  if (r.monthly.length === 0) return "（月別データなし）";
  return r.monthly.map(m => {
    const flag = m.roi === 0 ? "⚠️ 0hit" : m.roi < 50 ? "❌ 低" : m.roi >= 100 ? "✅" : "—";
    const isJul = m.month === JUL25_PREFIX;
    return `| ${isJul ? "**" + m.month + "**" : m.month} | ${m.n} | ${m.hits} | **${m.roi}%** | ${flag} |`;
  }).join("\n");
}

// 重複マトリクス
function overlapMatrix(): string {
  const ids = CANDIDATES.map(c => c.id);
  const header = "| 候補 | " + CANDIDATES.map(c => c.name).join(" | ") + " |";
  const sep    = "|---|" + CANDIDATES.map(() => "---").join("|") + "|";
  const rows = results.map(r =>
    `| ${r.name} | ` + ids.map(id => {
      if (id === r.id) return "—";
      return `${r.overlapPct[id] ?? 0}%`;
    }).join(" | ") + " |"
  ).join("\n");
  return `${header}\n${sep}\n${rows}`;
}

// 複合セット表
const comboTable = comboResults.map(c =>
  `| ${c.id} | ${c.name} | ${c.excludedN}(${c.excludedPct}%) | ${c.overlap} | ${c.slice.roi}% | ${c.skip.remainRoi}% | ${fmtDelta(c.skip.delta)} | ${fmtDelta(c.skipExJul25.delta)} |`
).join("\n");

// 候補別詳細セクション
function candidateSection(r: CandidateResult): string {
  const j25dep = r.slice.n > 0 ? r2(r.inJul25.n / r.slice.n * 100) : 0;
  return `### ${r.finalVerdict} ${r.name}

| 項目 | 全期間 | 2025-07内 | 2025-07外 | forward H1 | forward H2 | 直近3M |
|---|---|---|---|---|---|---|
| n | ${r.slice.n} | ${r.inJul25.n}(${j25dep}%) | ${r.exJul25.n} | ${r.h1.n} | ${r.h2.n} | ${r.recent.n} |
| 的中 | ${r.slice.hits} | ${r.inJul25.hits} | ${r.exJul25.hits} | ${r.h1.hits} | ${r.h2.hits} | ${r.recent.hits} |
| ROI(除外対象内) | ${r.slice.roi}% | ${r.inJul25.roi}% | ${r.exJul25.roi}% | ${r.h1.roi}% | ${r.h2.roi}% | ${r.recent.roi}% |

| 高配当依存 | jackpot比率 | top1除外ROI | top2除外ROI | top3除外ROI |
|---|---|---|---|---|
| ${r.name} | ${r.slice.jackpotRatio}% | ${r.slice.top1Roi}% | ${r.slice.top2Roi}% | ${r.slice.top3Roi}% |

skip効果: baseline ${baselineRoi}% → 残存 ${r.skip.remainRoi}% (delta=${fmtDelta(r.skip.delta)})
2025-07除外ベースでの skip効果: ${exJul25Base}% → (残存) (delta=${fmtDelta(r.deltaExJul25)})

odds分布(候補内): <20: ${r.oddsLt20Pct}% / 20〜39: ${r.odds2039Pct}% / 40〜79: ${r.odds4079Pct}% / 80+: ${r.odds80Pct}%

月別（候補内・n>=3の月のみ）:

| 月 | n | 的中 | ROI | 判定 |
|---|---|---|---|---|
${monthlyTable(r)}

判定:
${r.verdicts.map(v => `- ${v}`).join("\n") || "- —"}
`;
}

let md = `# 見送り候補 頑健性検証 (skip-filter robustness)

生成日時: ${now}
DB: ${DB_PATH}
forward期間: ${FORWARD_START}〜${dbMaxDate}
直近3M基準: ${recent3mCutoff}〜
2025-07 除外ベース ROI: ${exJul25Base}%（全体 baseline: ${baselineRoi}%）

> **読み取り専用。BUY は検証候補、ROI は検証指標。購入指示ではない。**
> **app_settings / 本番 decision 変更禁止。新規BUY探索ではない。**
> ROI基準: race_payouts.payout_yen 実払戻

---

## ベースライン

| 期間 | n | 的中 | ROI |
|---|---|---|---|
| forward 全体 | ${totalN} | ${totalHits} | **${baselineRoi}%** |
| forward (2025-07除く) | ${exJul25All.length} | ${exJul25All.filter(r => r.result === "1-2-3").length} | **${exJul25Base}%** |

---

## 候補サマリー

> delta: 単独除外後の残存ROI - ベースライン / deltaExJul25: 2025-07を除いた全体での同効果
> jackpot%: 最大払戻 / 除外対象合計払戻 / Jul25%: 除外対象のうち2025-07の割合

| 判定 | 候補 | 除外n | 除外ROI | 残存ROI | **delta** | **deltaExJul25** | jackpot% | Jul25% |
|---|---|---|---|---|---|---|---|---|
${summaryTable}

---

## 候補別詳細

${results.map(candidateSection).join("\n---\n\n")}

---

## 重複マトリクス（除外対象内の他候補との重複率）

${overlapMatrix()}

> 例: 「6R」の「odds40〜79」欄が 60% → 6Rの除外対象のうち 60% が odds40〜79 でもある

---

## 複合除外セット

> skipExJul25 delta: 2025-07を除いた全体ベースでの効果 (後付き除去後の効果確認)

| セット | 内容 | 除外n(%) | 重複行 | 除外ROI | 残存ROI | **delta** | **skipExJul25 delta** |
|---|---|---|---|---|---|---|---|
${comboTable}

### 複合セット詳細

${comboResults.map(c => {
  const additiveDelta = c.id !== "A"
    ? COMBO_SETS.find(cs => cs.id === c.id)!.ids
        .map(id => results.find(r => r.id === id)?.skip.delta ?? 0)
        .reduce((a, b) => a + b, 0)
    : null;
  const synergyNote = additiveDelta !== null
    ? `個別delta合計: ${r2(additiveDelta)}pt → 複合delta: ${c.skip.delta}pt (${c.skip.delta > additiveDelta ? "シナジーあり" : "重複により減衰"} ${r2(c.skip.delta - additiveDelta)}pt)`
    : "";
  return `- **セット${c.id}** (${c.name}): 除外${c.excludedN}件(${c.excludedPct}%) / 残存ROI ${c.skip.remainRoi}% / delta=${fmtDelta(c.skip.delta)} / 2025-07外delta=${fmtDelta(c.skipExJul25.delta)}${synergyNote ? " — " + synergyNote : ""}`;
}).join("\n")}

---

## 結論

### 今すぐ app_settings に反映してよい候補

**原則なし。** monitor-only フェーズ継続。以下はすべて観察候補。

### 有力見送り候補（monitor優先度: 高）

${(() => {
  const high = results.filter(r =>
    r.finalVerdict.includes("有力") || (r.slice.hits === 0 && r.slice.n >= 30)
  );
  if (high.length === 0) return "> 現時点で確度の高い見送り候補なし";
  return high.map(r =>
    `- **${r.name}**: 除外delta=+${r.skip.delta}pt / 残存ROI=${r.skip.remainRoi}% — ${r.verdicts.join(" / ")}`
  ).join("\n");
})()}

### monitor継続候補（追加データ蓄積を待つ）

${results.filter(r => r.finalVerdict.includes("monitor") || r.finalVerdict.includes("🔵")).map(r =>
  `- **${r.name}**: deltaExJul25=${r.deltaExJul25}pt — ${r.finalVerdict}`
).join("\n") || "> なし"}

### 凍結候補（採用不可）

${results.filter(r =>
  r.finalVerdict.includes("2025-07依存") || r.finalVerdict.includes("高配当依存")
).map(r =>
  `- **${r.name}**: ${r.finalVerdict} — ${r.verdicts.find(v => v.includes("依存")) ?? ""}`
).join("\n") || "> なし（凍結すべき候補なし）"}

### 次に見るべき別メカニズム

- **odds40〜79 × 弱raceNo の交差** — 単独効果の構造的共通原因を特定
- **会場 × 月別 交差** — 浜名湖/住之江の0hitが季節性か会場固有かを分解
- **2025-07 不振の原因** — 7月に偏った外れ条件（venue/raceNo/odds帯）を分解
- **2025-04〜05 高ROI月の特徴** — 現行モデルが得意な条件を把握

### 条件B n=200 到達までの判断保留事項

- 条件B (風速2〜4 × 1号艇展示1位 → 1-3-2) は現在 n=167、直近3M 0hit
- top2除外ROI=91.08% で格上げ基準(100%)未達
- 1-2-3 の skip-filter では条件B重複除外 delta=+${results.find(r => r.id === "condB")?.skip.delta ?? "?"}pt
- **n=200 到達まで判断保留。app_settings 変更不可。**

---
*生成: analyze-roi-skip-filter-robustness.ts*
`;

// ─── JSON 出力 ───────────────────────────────────────────────────────────────────

const jsonOut = {
  generatedAt: now,
  forwardStart: FORWARD_START,
  forwardEnd: dbMaxDate,
  recent3mCutoff,
  baseline: { n: totalN, hits: totalHits, roi: baselineRoi },
  baselineExJul25: { n: exJul25All.length, roi: exJul25Base },
  candidates: results.map(r => ({
    id: r.id, name: r.name, finalVerdict: r.finalVerdict,
    skipDelta: r.skip.delta, deltaExJul25: r.deltaExJul25,
    excludedN: r.slice.n, excludedRoi: r.slice.roi,
    remainingRoi: r.skip.remainRoi,
    jackpotRatio: r.slice.jackpotRatio,
    jul25Pct: r.slice.n > 0 ? r2(r.inJul25.n / r.slice.n * 100) : 0,
    verdicts: r.verdicts,
  })),
  combos: comboResults.map(c => ({
    id: c.id, name: c.name,
    excludedN: c.excludedN, excludedPct: c.excludedPct,
    remainingRoi: c.skip.remainRoi, delta: c.skip.delta,
    deltaExJul25: c.skipExJul25.delta,
  })),
};

// ─── 書き出し ────────────────────────────────────────────────────────────────────

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD,   md,                             "utf-8");
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf-8");

console.log(`\n[robustness] 完了 → ${OUT_MD}`);
console.log(`  baseline: ${baselineRoi}%  /  2025-07除外ベース: ${exJul25Base}%`);
console.log("\n  候補別 final verdict:");
results.forEach(r => console.log(`    ${r.name}: ${r.finalVerdict} (delta=${r.skip.delta}pt / exJul25=${r.deltaExJul25}pt)`));
console.log("\n  複合セット:");
comboResults.forEach(c => console.log(`    [${c.id}] ${c.name}: delta=${c.skip.delta}pt / exJul25delta=${c.skipExJul25.delta}pt`));
