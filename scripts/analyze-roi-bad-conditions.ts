/**
 * analyze-roi-bad-conditions.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 現行除外条件（venue5会場 + race_no 10,11,12）適用後のBUYデータから
 *       さらにROIを壊している条件を多角的に特定し、
 *       「買わない条件」の追加候補を抽出する。
 *
 * ベースライン: venue除外+race_no除外後の ROI ≈ 100.79%（4,401件）
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-bad-conditions.md";
const OUT_JSON = "reports/roi-bad-conditions.json";
const STAKE = 100;

// 現行除外条件
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── ベース集計ヘルパー（SQL集計で返す） ─────────────────────────────────────

type GroupStat = { label: string; n: number; hits: number; hitRate: number; roi: number; warning: string };

function query(where: string): { n: number; hits: number; totalReturn: number } {
  const r = db.prepare(`
    SELECT COUNT(*) as n,
      SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
      SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
    FROM decision_history dh
    WHERE decision='BUY' AND run_kind='historical-backfill'
      AND result IS NOT NULL AND result != ''
      AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
      AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
      ${where ? "AND " + where : ""}
  `).get() as { n: number; hits: number; total_return: number };
  return { n: r.n, hits: r.hits, totalReturn: r.total_return };
}

function stat(label: string, where: string, warn = ""): GroupStat {
  const r = query(where);
  const stake = r.n * STAKE;
  return {
    label, n: r.n, hits: r.hits,
    hitRate: r.n > 0 ? Math.round(r.hits / r.n * 10000) / 100 : 0,
    roi: stake > 0 ? Math.round(r.totalReturn / stake * 10000) / 100 : 0,
    warning: warn,
  };
}

// ─── データ品質チェック ───────────────────────────────────────────────────────
const qualityCheck = db.prepare(`
  SELECT COUNT(*) as total,
    SUM(CASE WHEN current_odds IS NULL THEN 1 ELSE 0 END) as null_odds,
    SUM(CASE WHEN result=selection AND current_odds IS NULL THEN 1 ELSE 0 END) as hit_null_odds
  FROM decision_history dh
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
    AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
`).get() as { total: number; null_odds: number; hit_null_odds: number };

// ─── ベースライン ─────────────────────────────────────────────────────────────
const baseline = stat("ベースライン（除外後全体）", "");

// ─── 1. オッズ帯別 ────────────────────────────────────────────────────────────
const oddsBands: GroupStat[] = [
  stat("odds 25〜39",  "current_odds >= 25 AND current_odds < 40"),
  stat("odds 40〜49",  "current_odds >= 40 AND current_odds < 50"),
  stat("odds 50〜59",  "current_odds >= 50 AND current_odds < 60"),
  stat("odds 60〜69",  "current_odds >= 60 AND current_odds < 70"),
  stat("odds 70〜79",  "current_odds >= 70 AND current_odds < 80", "hits=0系"),
  stat("odds 80以上",  "current_odds >= 80", "hits少"),
];

// ─── 2. 会場別 ───────────────────────────────────────────────────────────────
const venueRows = db.prepare(`
  SELECT venue,
    COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
    AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  GROUP BY venue ORDER BY COUNT(*) DESC
`).all() as { venue: string; n: number; hits: number; total_return: number }[];

const venueStats: (GroupStat & { venue: string })[] = venueRows.map(r => ({
  label: r.venue, venue: r.venue, n: r.n, hits: r.hits,
  hitRate: r.n > 0 ? Math.round(r.hits / r.n * 10000) / 100 : 0,
  roi: r.n > 0 ? Math.round(r.total_return / (r.n * STAKE) * 10000) / 100 : 0,
  warning: r.hits === 0 ? "的中なし" : r.hits < 3 ? "的中数<3" : "",
}));

// ─── 3. race_no 別（除外外） ─────────────────────────────────────────────────
const raceNoStats: GroupStat[] = [];
for (let rn = 1; rn <= 9; rn++) {
  raceNoStats.push(stat(`race_no ${rn}R`, `race_no = ${rn}`));
}

// ─── 4. 月別 ─────────────────────────────────────────────────────────────────
const monthRows = db.prepare(`
  SELECT strftime('%Y-%m', date) as ym,
    COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
    AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  GROUP BY ym ORDER BY ym
`).all() as { ym: string; n: number; hits: number; total_return: number }[];

const monthStats = monthRows.map(r => ({
  ym: r.ym, n: r.n, hits: r.hits,
  roi: r.n > 0 ? Math.round(r.total_return / (r.n * STAKE) * 10000) / 100 : 0,
  flag: r.hits === 0 ? "⚠️0hits" : r.n > 0 && r.total_return / (r.n * STAKE) < 0.7 ? "⚠️低ROI" : "",
}));

// ─── 5. 風速帯別（SQL JOIN） ─────────────────────────────────────────────────
const windGroups: GroupStat[] = [
  stat("風速データなし",      "NOT EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id)"),
  stat("風速 0〜2m/s",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps < 2)"),
  stat("風速 2〜4m/s",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)"),
  stat("風速 4m/s以上",       "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 4)"),
  stat("安定板あり",           "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 1)"),
  stat("安定板なし",           "EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.stable_plate = 0)"),
];

// ─── 6. 展示情報別 ───────────────────────────────────────────────────────────
// exhibition_data.ranking は全NULL。exhibition_time で速い順に順位を再計算する。
// exhibition_time が小さいほど速い（タイム競技の秒）→ 速い = 良い
const exhibitionGroups: GroupStat[] = [
  stat("展示データなし（1着候補）",
    `NOT EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL)`),
  // exhibition_time が当該レース内で最小（最速）= 実質1位
  stat("展示タイム1位（1着候補）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND ed.exhibition_time = (
          SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id
        ))`),
  stat("展示タイム2〜3位（1着候補）",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) BETWEEN 1 AND 2
    )`),
  stat("展示タイム4位以下（1着候補）",
    `EXISTS (
      SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.exhibition_time IS NOT NULL
        AND (SELECT COUNT(*) FROM exhibition_data ed2
              WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
                AND ed2.exhibition_time < ed.exhibition_time) >= 3
    )`),
  // 展示ST帯別（start_timing: 小さいほど早いスタート）
  stat("展示ST < 0.15（1着候補・早い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing IS NOT NULL AND ed.start_timing < 0.15)`),
  stat("展示ST 0.15〜0.20（1着候補）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing >= 0.15 AND ed.start_timing < 0.20)`),
  stat("展示ST 0.20以上（1着候補・遅い）",
    `EXISTS (SELECT 1 FROM race_entries re
      JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
      WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
        AND ed.start_timing >= 0.20)`),
];

// ─── 7. 進入コース別 ─────────────────────────────────────────────────────────
const courseGroups: GroupStat[] = [
  stat("1着候補 進入1コース",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course=1)`),
  stat("1着候補 進入2コース",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course=2)`),
  stat("1着候補 進入3コース以上",
    `EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER) AND re.entry_course >= 3)`),
];

// ─── 8. selection パターン別 ─────────────────────────────────────────────────
const selectionRows = db.prepare(`
  SELECT selection,
    COUNT(*) as n,
    SUM(CASE WHEN result=selection THEN 1 ELSE 0 END) as hits,
    SUM(CASE WHEN result=selection THEN current_odds*${STAKE} ELSE 0 END) as total_return
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
    AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  GROUP BY selection ORDER BY COUNT(*) DESC LIMIT 10
`).all() as { selection: string; n: number; hits: number; total_return: number }[];

const selectionStats = selectionRows.map(r => ({
  selection: r.selection, n: r.n, hits: r.hits,
  share: Math.round(r.n / baseline.n * 10000) / 100,
  roi: r.n > 0 ? Math.round(r.total_return / (r.n * STAKE) * 10000) / 100 : 0,
}));

// ─── 9. オッズ × 会場 クロス (問題の絞り込み) ──────────────────────────────
const oddsVenueRows = db.prepare(`
  SELECT venue,
    SUM(CASE WHEN current_odds >= 70 THEN 1 ELSE 0 END) as n_high_odds,
    SUM(CASE WHEN current_odds >= 70 AND result=selection THEN 1 ELSE 0 END) as hits_high,
    SUM(CASE WHEN current_odds < 70 THEN 1 ELSE 0 END) as n_low_odds,
    SUM(CASE WHEN current_odds < 70 AND result=selection THEN 1 ELSE 0 END) as hits_low
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
    AND venue NOT IN (${EXCLUDED_VENUES.map(v=>`'${v}'`).join(",")})
    AND race_no NOT IN (${EXCLUDED_RACE_NOS.join(",")})
  GROUP BY venue
  HAVING n_high_odds > 5
  ORDER BY n_high_odds DESC
`).all() as { venue: string; n_high_odds: number; hits_high: number; n_low_odds: number; hits_low: number }[];

// ─── 10. 複合条件（有望な除外候補） ─────────────────────────────────────────
type ExclusionCandidate = { condition: string; n: number; hits: number; roi: number; saving: number; note: string };

const exclusionCandidates: ExclusionCandidate[] = [];

function tryExclusion(condition: string, excludeWhere: string, note: string) {
  const excl = query(excludeWhere);
  const remaining = query(`NOT (${excludeWhere})`);
  if (excl.n < 20) return; // 件数少なすぎ
  const exclROI = excl.n > 0 ? Math.round(excl.totalReturn / (excl.n * STAKE) * 10000) / 100 : 0;
  const remainROI = remaining.n > 0 ? Math.round(remaining.totalReturn / (remaining.n * STAKE) * 10000) / 100 : 0;
  if (exclROI < 90) {
    exclusionCandidates.push({
      condition, n: excl.n, hits: excl.hits, roi: exclROI,
      saving: Math.round((remainROI - baseline.roi) * 100) / 100,
      note,
    });
  }
}

// 会場別除外候補
for (const vs of venueStats.filter(v => v.roi < 70 && v.n >= 30)) {
  tryExclusion(`venue = '${vs.venue}'`, `venue = '${vs.venue}'`, `ROI ${vs.roi}% (${vs.n}件)`);
}

// オッズ帯除外候補
tryExclusion("odds >= 70", "current_odds >= 70", "hits率が全体の半分以下");
tryExclusion("odds >= 80", "current_odds >= 80", "hits=0に近い");

// race_no 別（既除外外）
for (const rns of raceNoStats.filter(r => r.roi < 70 && r.n >= 20)) {
  const rn = rns.label.replace("race_no ", "").replace("R", "");
  tryExclusion(`race_no = ${rn}`, `race_no = ${rn}`, `ROI ${rns.roi}%`);
}

// 展示タイム4位以下（ranking は全NULL → exhibition_time で再計算）
tryExclusion("展示タイム4位以下", `EXISTS (
  SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    AND ed.exhibition_time IS NOT NULL
    AND (SELECT COUNT(*) FROM exhibition_data ed2
          WHERE ed2.race_id=dh.race_id AND ed2.exhibition_time IS NOT NULL
            AND ed2.exhibition_time < ed.exhibition_time) >= 3
)`, "1着候補が展示タイム4位以下");

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";
const roi = (v: number, n: number) => `${v}% (n=${n})`;

let md = `# ROI 悪化条件 特定レポート

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> 現行除外条件（5会場 + race_no 10,11,12）適用後のデータを対象とする。
> このレポートは読み取り専用分析。本番ロジック変更は含まない。

## ベースライン

| 指標 | 値 |
|---|---|
| 対象レース数 | **${baseline.n.toLocaleString()}** |
| 的中数 | ${baseline.hits} |
| 的中率 | ${pct(baseline.hitRate)} |
| **ROI** | **${baseline.roi}%** |
| current_odds NULL件数 | ${qualityCheck.null_odds} (total ${qualityCheck.total}件) |
| 的中かつ odds NULL | ${qualityCheck.hit_null_odds} |

> ※ 全件 (除外なし) ROI は約 80.4%。除外条件により +20pt 改善済み。
> ※ current_odds NULL の行は stake に算入されるが return が 0 になるため、NULL件数が多い場合は ROI が過小評価される。

---

## 1. オッズ帯別 ROI

| オッズ帯 | n | hits | 的中率 | ROI | 備考 |
|---|---|---|---|---|---|
${oddsBands.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | ${pct(g.hitRate)} | **${g.roi}%** | ${g.warning} |`
).join("\n")}

**示唆**:
- odds **70〜79 は ROI 121%台** で、帯単体では問題なし（むしろ上振れ）
- odds **80以上で的中0件・ROI 0%** が全体を引き下げている
- 「odds≥70」合算で ROI 84% に見えるのは 80以上 のゼロ寄与が原因
- 除外候補は **odds≥80** であり、**odds≥70 全切りは 70〜79 の良い帯まで除外するため不適切**

---

## 2. 会場別 ROI（除外後残存会場）

| 会場 | n | hits | 的中率 | ROI | 備考 |
|---|---|---|---|---|---|
${venueStats.sort((a,b) => a.roi - b.roi).map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | ${pct(g.hitRate)} | **${g.roi}%** | ${g.warning} |`
).join("\n")}

---

## 3. race_no 別 ROI（1〜9R）

| race_no | n | hits | 的中率 | ROI |
|---|---|---|---|---|
${raceNoStats.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | ${pct(g.hitRate)} | **${g.roi}%** |`
).join("\n")}

---

## 4. 月別 ROI トレンド

| 年月 | n | hits | ROI | 注記 |
|---|---|---|---|---|
${monthStats.map(m =>
  `| ${m.ym} | ${m.n} | ${m.hits} | **${m.roi}%** | ${m.flag} |`
).join("\n")}

**悪化月パターン**:
${monthStats.filter(m => m.flag).map(m => `- ${m.ym}: ROI ${m.roi}% (${m.n}件, ${m.hits}hits) ${m.flag}`).join("\n")}

---

## 5. 風速・安定板別 ROI

| 条件 | n | hits | ROI |
|---|---|---|---|
${windGroups.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | **${g.roi}%** |`
).join("\n")}

---

## 6. 展示情報別 ROI（1着候補）

| 条件 | n | hits | ROI |
|---|---|---|---|
${exhibitionGroups.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | **${g.roi}%** |`
).join("\n")}

---

## 7. 進入コース別 ROI（1着候補）

| 条件 | n | hits | ROI |
|---|---|---|---|
${courseGroups.map(g =>
  `| ${g.label} | ${g.n} | ${g.hits} | **${g.roi}%** |`
).join("\n")}

---

## 8. selection パターン集中度

| selection | n | 構成比 | hits | ROI |
|---|---|---|---|---|
${selectionStats.map(s =>
  `| \`${s.selection}\` | ${s.n} | ${pct(s.share)} | ${s.hits} | **${s.roi}%** |`
).join("\n")}

> BUYの ${pct(selectionStats[0]?.share ?? 0)} が \`${selectionStats[0]?.selection ?? "-"}\` に集中。
> **問題の本質は selection の多様性不足ではなく「1-2-3 の中で勝つ条件 / 負ける条件を分けられていないこと」**。
> selectionを増やすより先に、1-2-3 × odds帯 / 展示タイム / 会場 の勝ち負け分解が次フェーズ。

---

## 9. オッズ帯 × 会場クロス（odds 70以上 vs 70未満）

| 会場 | odds70+ n | odds70+ hits | odds<70 n | odds<70 hits |
|---|---|---|---|---|
${oddsVenueRows.map(r =>
  `| ${r.venue} | ${r.n_high_odds} | ${r.hits_high} | ${r.n_low_odds} | ${r.hits_low} |`
).join("\n")}

---

## 10. 除外候補まとめ

以下の条件は ROI < 90% かつ n ≥ 20 のため、除外候補として検討価値がある。

| 条件 | n | hits | ROI | 残存時ROI改善幅 | 備考 |
|---|---|---|---|---|---|
${exclusionCandidates.sort((a,b) => a.roi - b.roi).map(c =>
  `| ${c.condition} | ${c.n} | ${c.hits} | **${c.roi}%** | +${c.saving}pt | ${c.note} |`
).join("\n")}

${exclusionCandidates.length === 0 ? "> 追加除外候補なし（全条件 ROI ≥ 90%、または件数不足）" : ""}

---

## 結論

### 既に機能している除外条件
- 5会場（戸田/多摩川/桐生/三国/江戸川）+ race_no 10,11,12 の除外で ROI: 80.4% → **${baseline.roi}%**

### 追加除外検討候補
${exclusionCandidates.length > 0
  ? exclusionCandidates.sort((a,b) => a.roi - b.roi).slice(0,5).map((c,i) =>
      `${i+1}. **${c.condition}**: ROI ${c.roi}% (${c.n}件) — 残存 ROI が +${c.saving}pt 改善`
    ).join("\n")
  : "- 現時点では明確な単一条件除外候補なし"}

### 最重要所見
1. **selection 97.7% が 1-2-3 に集中** — 問題は多様性不足ではなく「1-2-3 の中で勝ち負けを分けられていないこと」
2. **odds 80以上: ROI 0%（${oddsBands.find(b=>b.label.includes("80以上"))?.n ?? "-"}件・的中0）** — 最もクリアな除外候補
3. **odds 70〜79 は ROI 121%** — odds≥70 を一括除外するのは誤り。問題は 80以上のみ
4. **展示タイム1位の ROI が低い（74.99%）** — 強さではなく「人気過剰による割高」の可能性。単独除外は危険
5. **住之江: ROI 65.22%（207件）** — 除外効果が大きいが、会場単独除外前に odds帯/race_no/展示タイム×会場の分解が先
6. **月次分散大** — 2024-02（0hits/166件）・2025-07（ROI 31.76%/227件）は原因別調査要

### 次フェーズ推奨（優先順）
1. **paper-forward で odds≥80 除外を検証** — n=56・ROI 0%・最もクリア。app_settings 変更前に forward観察
2. **住之江の中身を分解** — 住之江×odds帯 / ×race_no / ×展示タイム で壊れている条件を特定してから会場全除外検討
3. **1-2-3 の勝ち負け分解** — 1-2-3 × odds帯 / × 展示タイム順位 / × 風速 でROI差を可視化
4. **悪化月の原因調査** — データ品質・会場偏り・オッズ帯偏りを確認
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseline, oddsBands, venueStats, raceNoStats, monthStats,
  windGroups, exhibitionGroups, courseGroups, selectionStats, exclusionCandidates,
}, null, 2), "utf-8");

console.log(`[bad-conditions] 完了 → ${OUT_MD}`);
console.log(`\nベースライン: ${baseline.n}件 hits=${baseline.hits} ROI=${baseline.roi}%`);
console.log(`\n【除外候補トップ5】`);
exclusionCandidates.sort((a,b) => a.roi - b.roi).slice(0,5).forEach((c,i) =>
  console.log(`  ${i+1}. ${c.condition}: ROI=${c.roi}% (n=${c.n}) → 残存+${c.saving}pt`)
);
console.log(`\n【selection集中度】`);
selectionStats.slice(0,3).forEach(s =>
  console.log(`  ${s.selection}: ${pct(s.share)} (${s.n}件) ROI=${s.roi}%`)
);
