/**
 * analyze-bet-type-risk-factors.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 *
 * 目的: 進入ズレ・風・展示・安定板などのリスク要因が
 *       どの券種で効いているかを SQL 集計で分析する。
 *       事前取得可能情報と結果後のみ判明する情報を明確に分ける。
 *
 * メモリ節約: payout テーブルをメモリ展開せず SQL JOIN で集計。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-risk-factors.md";
const OUT_JSON = "reports/bet-type-risk-factors.json";
const STAKE = 100;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ─── ベースクエリ（BUY + コンテキスト） ─────────────────────────────────────
// 各グループ条件をWHEREに加えてSQL集計する

type GroupROIRow = {
  n: number;
  trifecta_stake: number; trifecta_return: number;
  trio_stake: number; trio_return: number;
  exacta_stake: number; exacta_return: number;
  quinella_stake: number; quinella_return: number;
};

// ベースの結合+集計SQL（WHEREプレースホルダーつき）
function groupSQL(whereClause: string): string {
  return `
  WITH base AS (
    SELECT
      dh.race_id,
      dh.selection,
      CAST(substr(dh.selection,1,1) AS INTEGER) AS s1,
      CAST(substr(dh.selection,3,1) AS INTEGER) AS s2,
      CAST(substr(dh.selection,5,1) AS INTEGER) AS s3,
      rw.wind_speed_mps,
      rw.wave_height_cm,
      rw.stable_plate,
      rc.kimarite,
      re.entry_course AS s1_entry_course,
      ed.start_timing AS s1_start_timing,
      ed.ranking AS s1_ranking
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id=dh.race_id
    LEFT JOIN race_conditions rc ON rc.race_id=dh.race_id
    LEFT JOIN race_entries re ON re.race_id=dh.race_id
      AND re.boat=CAST(substr(dh.selection,1,1) AS INTEGER)
    LEFT JOIN exhibition_data ed ON ed.race_id=dh.race_id
      AND ed.course=re.entry_course
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      ${whereClause ? "AND " + whereClause : ""}
  ),
  tf_join AS (
    SELECT b.race_id,
      CASE WHEN p.returned=1 THEN NULL ELSE 1 END AS valid,
      COALESCE(CASE WHEN p.returned=1 THEN NULL ELSE p.payout_yen END, 0) AS payout
    FROM base b
    LEFT JOIN race_payouts p
      ON p.race_id=b.race_id AND p.bet_type='trifecta'
      AND p.combination=(b.s1||'-'||b.s2||'-'||b.s3)
  ),
  tr_join AS (
    SELECT b.race_id,
      CASE WHEN p.returned=1 THEN NULL ELSE 1 END AS valid,
      COALESCE(CASE WHEN p.returned=1 THEN NULL ELSE p.payout_yen END, 0) AS payout
    FROM base b
    LEFT JOIN race_payouts p
      ON p.race_id=b.race_id AND p.bet_type='trio'
      AND p.combination=CASE WHEN b.s1<b.s2 AND b.s2<b.s3 THEN (b.s1||'-'||b.s2||'-'||b.s3)
        WHEN b.s1<b.s3 AND b.s3<b.s2 THEN (b.s1||'-'||b.s3||'-'||b.s2)
        WHEN b.s2<b.s1 AND b.s1<b.s3 THEN (b.s2||'-'||b.s1||'-'||b.s3)
        WHEN b.s2<b.s3 AND b.s3<b.s1 THEN (b.s2||'-'||b.s3||'-'||b.s1)
        WHEN b.s3<b.s1 AND b.s1<b.s2 THEN (b.s3||'-'||b.s1||'-'||b.s2)
        ELSE (b.s3||'-'||b.s2||'-'||b.s1) END
  ),
  ex_join AS (
    SELECT b.race_id,
      CASE WHEN p.returned=1 THEN NULL ELSE 1 END AS valid,
      COALESCE(CASE WHEN p.returned=1 THEN NULL ELSE p.payout_yen END, 0) AS payout
    FROM base b
    LEFT JOIN race_payouts p
      ON p.race_id=b.race_id AND p.bet_type='exacta'
      AND p.combination=(b.s1||'-'||b.s2)
  ),
  qn_join AS (
    SELECT b.race_id,
      CASE WHEN p.returned=1 THEN NULL ELSE 1 END AS valid,
      COALESCE(CASE WHEN p.returned=1 THEN NULL ELSE p.payout_yen END, 0) AS payout
    FROM base b
    LEFT JOIN race_payouts p
      ON p.race_id=b.race_id AND p.bet_type='quinella'
      AND p.combination=CASE WHEN b.s1<b.s2 THEN (b.s1||'-'||b.s2) ELSE (b.s2||'-'||b.s1) END
  )
  SELECT
    (SELECT COUNT(*) FROM base) AS n,
    SUM(tf_join.valid) AS trifecta_stake_n, SUM(tf_join.payout) AS trifecta_return,
    SUM(tr_join.valid) AS trio_stake_n, SUM(tr_join.payout) AS trio_return,
    SUM(ex_join.valid) AS exacta_stake_n, SUM(ex_join.payout) AS exacta_return,
    SUM(qn_join.valid) AS quinella_stake_n, SUM(qn_join.payout) AS quinella_return
  FROM base
  LEFT JOIN tf_join ON tf_join.race_id=base.race_id
  LEFT JOIN tr_join ON tr_join.race_id=base.race_id
  LEFT JOIN ex_join ON ex_join.race_id=base.race_id
  LEFT JOIN qn_join ON qn_join.race_id=base.race_id
  `;
}

type RawGroupRow = {
  n: number;
  trifecta_stake_n: number; trifecta_return: number;
  trio_stake_n: number; trio_return: number;
  exacta_stake_n: number; exacta_return: number;
  quinella_stake_n: number; quinella_return: number;
};

function roi(ret: number, n: number) {
  const stake = n * STAKE;
  return stake > 0 ? Math.round(ret / stake * 10000) / 100 : 0;
}

type RiskGroup = {
  label: string;
  timing: "事前取得可能" | "結果後のみ";
  n: number;
  trifecta: number; trio: number; exacta: number; quinella: number;
};

const riskGroups: RiskGroup[] = [];

function evalGroup(label: string, timing: "事前取得可能" | "結果後のみ", where: string) {
  try {
    const r = db.prepare(groupSQL(where)).get() as RawGroupRow | null;
    if (!r || r.n === 0) return;
    riskGroups.push({
      label, timing, n: r.n,
      trifecta: roi(r.trifecta_return, r.trifecta_stake_n),
      trio: roi(r.trio_return, r.trio_stake_n),
      exacta: roi(r.exacta_return, r.exacta_stake_n),
      quinella: roi(r.quinella_return, r.quinella_stake_n),
    });
  } catch (e) {
    console.warn(`  [skip] ${label}: ${(e as Error).message.slice(0, 60)}`);
  }
}

// ─── 全体ベースライン ─────────────────────────────────────────────────────────
evalGroup("全体ベースライン", "事前取得可能", "");

// ─── 風速帯（事前取得可能） ──────────────────────────────────────────────────
evalGroup("風速 0〜2m/s (穏やか)", "事前取得可能", "rw.wind_speed_mps < 2 AND rw.wind_speed_mps IS NOT NULL");
evalGroup("風速 2〜4m/s", "事前取得可能", "rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4");
evalGroup("風速 4m/s以上 (荒れ傾向)", "事前取得可能", "rw.wind_speed_mps >= 4");
evalGroup("風速データなし", "事前取得可能", "rw.wind_speed_mps IS NULL");

// ─── 波高帯（事前取得可能） ──────────────────────────────────────────────────
evalGroup("波高 0〜5cm", "事前取得可能", "rw.wave_height_cm < 5 AND rw.wave_height_cm IS NOT NULL");
evalGroup("波高 5〜15cm", "事前取得可能", "rw.wave_height_cm >= 5 AND rw.wave_height_cm < 15");
evalGroup("波高 15cm以上 (荒れ)", "事前取得可能", "rw.wave_height_cm >= 15");

// ─── 安定板（事前取得可能） ──────────────────────────────────────────────────
evalGroup("安定板あり", "事前取得可能", "rw.stable_plate = 1");
evalGroup("安定板なし", "事前取得可能", "rw.stable_plate = 0");
evalGroup("安定板データなし", "事前取得可能", "rw.stable_plate IS NULL");

// ─── 展示ST（事前取得可能） ──────────────────────────────────────────────────
evalGroup("1着候補 展示ST < 0.15", "事前取得可能", "ed.start_timing < 0.15 AND ed.start_timing IS NOT NULL");
evalGroup("1着候補 展示ST 0.15〜0.20", "事前取得可能", "ed.start_timing >= 0.15 AND ed.start_timing < 0.20");
evalGroup("1着候補 展示ST 0.20以上", "事前取得可能", "ed.start_timing >= 0.20");
evalGroup("展示STデータなし", "事前取得可能", "ed.start_timing IS NULL");

// ─── 展示順位（事前取得可能） ────────────────────────────────────────────────
evalGroup("1着候補 展示順位1位", "事前取得可能", "ed.ranking = 1");
evalGroup("1着候補 展示順位2位", "事前取得可能", "ed.ranking = 2");
evalGroup("1着候補 展示順位3位以下", "事前取得可能", "ed.ranking >= 3 AND ed.ranking IS NOT NULL");
evalGroup("展示順位データなし", "事前取得可能", "ed.ranking IS NULL");

// ─── 進入コース（事前取得可能） ──────────────────────────────────────────────
evalGroup("1着候補 進入1コース", "事前取得可能", "re.entry_course = 1");
evalGroup("1着候補 進入2コース以降", "事前取得可能", "re.entry_course >= 2 AND re.entry_course IS NOT NULL");
evalGroup("進入コースデータなし", "事前取得可能", "re.entry_course IS NULL");

// ─── 決まり手（結果後のみ） ──────────────────────────────────────────────────
evalGroup("決まり手: 逃げ", "結果後のみ", "rc.kimarite = '逃げ'");
evalGroup("決まり手: 差し", "結果後のみ", "rc.kimarite = '差し'");
evalGroup("決まり手: まくり系", "結果後のみ", "rc.kimarite LIKE '%まくり%'");

// ─── オッズ時系列の行数確認のみ（メモリ節約）────────────────────────────────
const oddsCount = (db.prepare("SELECT COUNT(*) as n FROM odds_timeseries_snapshots").get() as { n: number }).n;

// ─── Markdown ────────────────────────────────────────────────────────────────

const pct = (v: number) => v.toFixed(1) + "%";
const r2 = (v: number) => v > 0 ? `${v}%` : "-";

let md = `# リスク要因 × 券種 ROI 分析

生成日時: ${new Date().toISOString()}
DB: ${DB_PATH}

> **重要**: 事前取得可能なリスク要因のみが本番ロジックに組み込める。
> 結果後のみの情報（kimarite等）は因果分析・事後評価用途に限定。

- odds_timeseries_snapshots 総行数: ${oddsCount.toLocaleString()}

## リスク要因別 ROI 比較

| 条件 | タイミング | n | 3連単 | 3連複 | 2連単 | 2連複 |
|---|---|---|---|---|---|---|
${riskGroups.map(g =>
  `| ${g.label} | ${g.timing} | ${g.n} | ${r2(g.trifecta)} | ${r2(g.trio)} | ${r2(g.exacta)} | ${r2(g.quinella)} |`
).join("\n")}

## 読み取りポイント

### 風速・波高・安定板（事前取得可能）
- **荒天条件**（風速4m/s以上、波高15cm以上）では3連単より3連複・2連複の ROI が相対的に高くなるなら、券種落とし条件として使える。
- **安定板使用**は波高・荒天のサイン。3連複か2連複への切替が合理的な可能性。

### 展示情報（事前取得可能）
- 1着候補の展示ST・展示順位が良い条件で3連単ROIが上がるなら、精度が高い。
- 展示データなし群が多い場合はデータ収集強化が必要。

### 進入コース（事前取得可能）
- 1コース進入: 逃げやすく3連単精度が高い可能性。
- 2コース以降: 差し・まくりが増え3連複・2連複が相対的に有利。

### 決まり手（結果後のみ）
- 逃げ・差し・まくり系での ROI 差は事後評価用。本番ロジックには直接使えない。
- ただし逃げ/まくり比率が高い会場・レース番号と組み合わせると間接的な事前情報になる可能性。

## 注意事項

- entry_course（進入コース）はレース前に公開される事前情報。
- kimarite（決まり手）はレース後のみ判明するため本番ロジックには使用不可。
- ROI は検証指標であり購入推奨ではない。
`;

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), riskGroups, oddsCount }, null, 2), "utf-8");

console.log(`[risk-factors] 完了 → ${OUT_MD}`);
console.log(`  グループ数: ${riskGroups.length}`);
riskGroups.slice(0, 6).forEach(g =>
  console.log(`  ${g.label}: n=${g.n} trifecta=${g.trifecta}% trio=${g.trio}%`)
);
