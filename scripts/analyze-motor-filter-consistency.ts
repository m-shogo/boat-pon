/**
 * maxMotorTop2Rate の national / venue 参照整合を読む専用レポート。
 * DB read-only。app_settings変更なし。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/motor-filter-consistency.md";

if (!existsSync(DB_PATH)) throw new Error("MOTOR_FILTER_PRIMARY_DB_MISSING");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "MOTOR_FILTER_PRIMARY_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA query_only = ON;");

try {
  const rows = loadRows();
  if (rows.length === 0) throw new Error("MOTOR_FILTER_POPULATION_EMPTY");
  const missingSettlement = rows.filter((row) => !row.marketSettled).length;
  const missingHitPayout = rows.filter((row) => row.selection === row.result && !(row.payoutYen > 0)).length;
  if (missingSettlement !== 0 || missingHitPayout !== 0) {
    throw new Error(`MOTOR_FILTER_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify({ rows: rows.length, missingSettlement, missingHitPayout })}`);
  }

  const conditions = [
    ["national motorTop2Rate >= 50", (r: Row) => (r.nationalMotor ?? -1) >= 50],
    ["venueMotorTop2Rate >= 50", (r: Row) => (r.venueMotor ?? -1) >= 50],
    ["both >= 50", (r: Row) => (r.nationalMotor ?? -1) >= 50 && (r.venueMotor ?? -1) >= 50],
    ["nationalのみ >= 50", (r: Row) => (r.nationalMotor ?? -1) >= 50 && !((r.venueMotor ?? -1) >= 50)],
    ["venueのみ >= 50", (r: Row) => (r.venueMotor ?? -1) >= 50 && !((r.nationalMotor ?? -1) >= 50)],
    ["両方 < 50", (r: Row) => !((r.nationalMotor ?? -1) >= 50) && !((r.venueMotor ?? -1) >= 50)],
    ["venueMotor missing", (r: Row) => r.venueMotor == null],
  ] as const;
  const summaries = conditions.map(([label, fn]) => ({ condition: label, ...metric(rows.filter(fn)), recommendation: recommendation(label, metric(rows.filter(fn))) }));
  const report = { generatedAt: new Date().toISOString(), roiBasis: "official-race-payouts", summaries };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/motor-filter-consistency.json", `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`[analyze-motor-filter-consistency] wrote ${OUT_MD}`);
  console.log("[analyze-motor-filter-consistency] wrote reports/motor-filter-consistency.json");
} finally {
  db.close();
}

type Row = {
  selection: string;
  result: string;
  odds: number;
  payoutYen: number;
  marketSettled: boolean;
  nationalMotor: number | null;
  venueMotor: number | null;
};

function loadRows(): Row[] {
  const rows = db.prepare(`
SELECT
  dh.selection,
  dh.result,
  dh.current_odds,
  op.raw_json,
  mbs.motor_top2_rate AS venue_motor,
  CASE WHEN dh.selection = dh.result THEN (
    SELECT rp.payout_yen
    FROM race_payouts rp
    WHERE rp.race_id = dh.race_id
      AND rp.bet_type = dh.bet_type
      AND rp.combination = dh.selection
      AND rp.returned = 0
      AND rp.payout_yen > 0
    LIMIT 1
  ) ELSE 0 END AS payout_yen,
  CASE WHEN EXISTS (
    SELECT 1
    FROM race_payouts settled
    WHERE settled.race_id = dh.race_id
      AND settled.bet_type = dh.bet_type
      AND settled.returned = 0
      AND settled.payout_yen > 0
  ) THEN 1 ELSE 0 END AS market_settled
FROM decision_history dh
LEFT JOIN official_programs op ON op.race_id = dh.race_id
LEFT JOIN motor_boat_stats mbs
  ON mbs.race_id = dh.race_id
 AND mbs.course = CAST(substr(dh.selection, 1, 1) AS INTEGER)
WHERE dh.run_kind='historical-backfill'
  AND dh.decision='BUY'
  AND dh.current_odds IS NOT NULL
  AND dh.result IS NOT NULL
`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const head = Number(String(row.selection).split("-")[0]);
    return {
      selection: String(row.selection),
      result: String(row.result),
      odds: Number(row.current_odds),
      payoutYen: Number(row.payout_yen ?? 0),
      marketSettled: Number(row.market_settled) === 1,
      nationalMotor: nationalMotor(row.raw_json, head),
      venueMotor: nullableNumber(row.venue_motor),
    };
  });
}

function nationalMotor(rawJson: unknown, course: number) {
  if (typeof rawJson !== "string") return null;
  try {
    const parsed = JSON.parse(rawJson) as { boats?: Array<Record<string, unknown>> };
    return nullableNumber(parsed.boats?.find((b) => Number(b.course) === course)?.motorTop2Rate);
  } catch {
    return null;
  }
}

function metric(rows: Row[]) {
  const hits = rows.filter((r) => r.selection === r.result);
  const stake = rows.length * 100;
  const ret = rows.reduce((sum, r) => sum + (r.selection === r.result ? r.payoutYen : 0), 0);
  return {
    n: rows.length,
    hits: hits.length,
    hitRate: rows.length ? hits.length / rows.length : 0,
    avgOdds: rows.length ? rows.reduce((s, r) => s + r.odds, 0) / rows.length : 0,
    roi: stake ? ret / stake : 0,
  };
}

function recommendation(label: string, m: ReturnType<typeof metric>) {
  if (m.n < 50) return "n不足。採用不可";
  if (label.includes("venue") && m.roi < 0.8) return "venue基準のNO BUY/減点候補";
  if (label.includes("national") && m.roi < 0.8) return "national基準も弱いが、venueとのズレ確認が必要";
  return "観察";
}

function renderMarkdown(report: { roiBasis: string; summaries: Array<{ condition: string; recommendation: string } & ReturnType<typeof metric>> }) {
  const lines = [
    "# motor filter consistency",
    "",
    `ROI basis: ${report.roiBasis}`,
    "",
    "## 結論",
    "- `featureAdjustment` は `venueMotorTop2Rate ?? motorTop2Rate` を使う一方、`programFilter.maxMotorTop2Rate` は現状 `candidateMotorTop2Rate` / `firstBoatFeature.motorTop2Rate` 側に寄っており、venue値を見ていない疑いがあります。",
    "- まず本番変更ではなく、venue基準/national基準/両方基準のA/B再生成で確認すべきです。",
    "- ROIは締切前current_oddsではなくofficial race_payoutsの100円払戻を使用し、対象market settlement欠落時はレポート自体をfail-closedにします。",
    "",
    "| condition | n | hit率 | avg odds | ROI | 削除候補か | コメント |",
    "|---|---:|---:|---:|---:|---|---|",
  ];
  for (const s of report.summaries) {
    lines.push(`| ${s.condition} | ${s.n} | ${pct(s.hitRate)} | ${fmt(s.avgOdds)} | ${fmt(s.roi)} | ${s.roi < 0.8 && s.n >= 50 ? "候補" : "観察"} | ${s.recommendation} |`);
  }
  lines.push("");
  lines.push("## 修正案");
  lines.push("- 案A: filterもvenue優先に統一する。ただし過学習検証後。");
  lines.push("- 案B: `maxMotorTop2Rate` は即除外ではなくscore減点にする。");
  lines.push("- 案C: national>=50かつvenue>=50 の両方一致時だけ強いNO BUYにする。");
  return `${lines.join("\n")}\n`;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

function pct(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "-";
}
