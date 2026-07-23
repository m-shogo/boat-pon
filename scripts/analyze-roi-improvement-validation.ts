/**
 * analyze-roi-improvement-validation.ts — 読み取り専用
 *
 * 前回の探索で見つかった「1-3-2へ切替」「条件で見送り」候補を、
 * 実払戻し・時系列分割・高配当依存・会場偏りで再検証する。
 * これは本番判定やapp_settingsを変更せず、購入推奨もしない。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-improvement-validation.md";
const OUT_JSON = "reports/roi-improvement-validation.json";
const STAKE = 100;
const EXCLUDED_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCLUDED_RACE_NOS = [10, 11, 12];
const EXCL_V = EXCLUDED_VENUES.map(v => `'${v}'`).join(",");
const EXCL_R = EXCLUDED_RACE_NOS.join(",");

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1 = `EXISTS (SELECT 1 FROM race_entries re JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course WHERE re.race_id=dh.race_id AND re.boat=1 AND ed.exhibition_time IS NOT NULL AND ed.exhibition_time=(SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2 WHERE ed2.race_id=dh.race_id))`;
const BOAT3_FASTER = `EXISTS (SELECT 1 FROM race_entries re2 JOIN exhibition_data ed2 ON ed2.race_id=re2.race_id AND ed2.course=re2.entry_course JOIN race_entries re3 ON re3.race_id=re2.race_id AND re3.boat=3 JOIN exhibition_data ed3 ON ed3.race_id=re3.race_id AND ed3.course=re3.entry_course WHERE re2.race_id=dh.race_id AND re2.boat=2 AND ed2.exhibition_time IS NOT NULL AND ed3.exhibition_time IS NOT NULL AND ed3.exhibition_time < ed2.exhibition_time)`;

type RawRow = {
  date: string; venue: string; race_no: number; current_odds: number | null;
  p123: number; p132: number; hasTrifecta: number;
  wind24: number; exh1: number; boat3faster: number;
};

const rows = db.prepare(`
  SELECT dh.date, dh.venue, dh.race_no, dh.current_odds,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' AND rp.returned=0 LIMIT 1),0) p123,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' AND rp.returned=0 LIMIT 1),0) p132,
    CASE WHEN EXISTS (SELECT 1 FROM race_payouts rp WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.returned=0) THEN 1 ELSE 0 END hasTrifecta,
    CASE WHEN ${WIND24} THEN 1 ELSE 0 END wind24,
    CASE WHEN ${EXH1} THEN 1 ELSE 0 END exh1,
    CASE WHEN ${BOAT3_FASTER} THEN 1 ELSE 0 END boat3faster
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result!='' AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${EXCL_V}) AND dh.race_no NOT IN (${EXCL_R})
  ORDER BY dh.date, dh.venue, dh.race_no
`).all() as RawRow[];

type Period = { id: string; label: string; where: (r: RawRow) => boolean };
const PERIODS: Period[] = [
  { id: "discovery", label: "探索: 2024上期", where: r => r.date >= "2024-01-01" && r.date < "2024-07-01" },
  { id: "validation", label: "検証: 2024下期", where: r => r.date >= "2024-07-01" && r.date < "2025-01-01" },
  { id: "test", label: "未使用テスト: 2025年", where: r => r.date >= "2025-01-01" && r.date < "2026-01-01" },
  { id: "recent", label: "参考: 2025-09以降", where: r => r.date >= "2025-09-01" && r.date < "2026-01-01" },
];

type Candidate = {
  id: string; label: string; kind: "switch" | "filter";
  condition: (r: RawRow) => boolean;
};
const CANDIDATES: Candidate[] = [
  { id: "switch_wind24_exh1", label: "風速2〜4 × 1号展示1位で1-3-2へ切替", kind: "switch", condition: r => r.wind24 === 1 && r.exh1 === 1 },
  { id: "switch_exh1", label: "1号展示1位で1-3-2へ切替", kind: "switch", condition: r => r.exh1 === 1 },
  { id: "switch_boat3faster", label: "3号艇展示が2号艇より速い時に1-3-2へ切替", kind: "switch", condition: r => r.boat3faster === 1 },
  { id: "switch_suminoe_4049", label: "住之江かつ現行オッズ40〜49で1-3-2へ切替", kind: "switch", condition: r => r.venue === "住之江" && (r.current_odds ?? 0) >= 40 && (r.current_odds ?? 0) < 50 },
  { id: "filter_exh1", label: "1号展示1位を見送り", kind: "filter", condition: r => r.exh1 === 1 },
  { id: "filter_wind24_exh1", label: "風速2〜4 × 1号展示1位を見送り", kind: "filter", condition: r => r.wind24 === 1 && r.exh1 === 1 },
  { id: "filter_odds80", label: "現行オッズ80以上を見送り", kind: "filter", condition: r => (r.current_odds ?? 0) >= 80 },
];

type Stat = {
  n: number; covered: number; hits: number;
  returnYen: number; stakeYen: number; roi: number;
  top2ExclRoi: number; maxLosingStreak: number;
};
function round(v: number) { return Math.round(v * 100) / 100; }
function stat(items: RawRow[], payout: (r: RawRow) => number, include: (r: RawRow) => boolean = () => true): Stat {
  const rs = items.filter(include);
  const returns = rs.map(payout);
  const stake = rs.length * STAKE;
  const total = returns.reduce((a, b) => a + b, 0);
  const sorted = [...returns].sort((a, b) => b - a);
  let losing = 0, maxLosing = 0;
  for (const v of returns) { if (v > 0) losing = 0; else { losing++; maxLosing = Math.max(maxLosing, losing); } }
  return {
    n: rs.length,
    covered: rs.filter(r => r.hasTrifecta).length,
    hits: returns.filter(v => v > 0).length,
    returnYen: total, stakeYen: stake, roi: stake ? round(total / stake * 100) : 0,
    top2ExclRoi: stake ? round((total - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / stake * 100) : 0,
    maxLosingStreak: maxLosing,
  };
}

function evaluate(candidate: Candidate, items: RawRow[]): Stat {
  if (candidate.kind === "switch") return stat(items, r => candidate.condition(r) ? r.p132 : r.p123);
  return stat(items, r => r.p123, r => !candidate.condition(r));
}

const baselineByPeriod: Record<string, Stat> = {};
const candidateResults: Record<string, Record<string, Stat>> = {};
for (const p of PERIODS) {
  const items = rows.filter(p.where);
  baselineByPeriod[p.id] = stat(items, r => r.p123);
  candidateResults[p.id] = Object.fromEntries(CANDIDATES.map(c => [c.id, evaluate(c, items)]));
}

const verdicts = CANDIDATES.map(c => {
  const d = candidateResults.discovery[c.id], v = candidateResults.validation[c.id], t = candidateResults.test[c.id];
  const enough = [d, v, t].every(x => x.n >= 100);
  const passes = enough && d.roi >= 100 && v.roi >= 100 && t.roi >= 100 && t.top2ExclRoi >= 90;
  return { id: c.id, label: c.label, kind: c.kind, enough, passes, discovery: d, validation: v, test: t };
});

const now = new Date().toISOString();
const json = { generatedAt: now, db: DB_PATH, population: { rows: rows.length, dateMin: rows[0]?.date ?? null, dateMax: rows.at(-1)?.date ?? null }, periods: PERIODS.map(p => ({ id: p.id, label: p.label })), baselineByPeriod, candidates: verdicts, rules: { stakeYen: STAKE, pass: "探索・検証・未使用テストの各ROI>=100%、テスト最大2件除外ROI>=90%、各n>=100。合格しても本番採用ではなく紙運用追加検証。" } };
let md = `# ROI改善候補の時系列・頑健性検証\n\n生成日時: ${now}\nDB: ${DB_PATH}\n\n> 実払戻し（race_payouts）を主指標に固定。current_oddsは使わず、結果を見た後の条件追加を避けるため探索・検証・未使用テストを分離。購入推奨ではない。\n\n## 基準\n\n- 対象: historical-backfillのBUY、現行1-2-3、除外会場/10〜12Rを除外\n- 探索: 2024-01〜06、検証: 2024-07〜12、未使用テスト: 2025年\n- 合格目安: 各期間n>=100、各ROI>=100%、テスト最大2件除外ROI>=90%。合格しても本番変更せず紙運用へ。\n\n## 現行1-2-3ベースライン\n\n|期間|n|払戻カバレッジ|ROI|最大2件除外ROI|最大連敗|\n|---|---:|---:|---:|---:|---:|\n`;
for (const p of PERIODS) { const s = baselineByPeriod[p.id]; md += `|${p.label}|${s.n}|${round(s.covered / Math.max(1, s.n) * 100)}%|${s.roi}%|${s.top2ExclRoi}%|${s.maxLosingStreak}|\n`; }
md += `\n## 候補結果（ハイブリッド戦略）\n\n|候補|種別|探索ROI|検証ROI|テストROI|テスト最大2件除外|テストn|判定|\n|---|---|---:|---:|---:|---:|---:|---|\n`;
for (const x of verdicts) md += `|${x.label}|${x.kind}|${x.discovery.roi}%|${x.validation.roi}%|${x.test.roi}%|${x.test.top2ExclRoi}%|${x.test.n}|${x.passes ? "条件上は通過（紙運用のみ）" : x.enough ? "不採用" : "n不足・未判定"}|\n`;
md += `\n## 読み方\n\nこの表でROIが100%を超えても、標本数・市場変化・払戻しの裾に依存する可能性が残る。特に探索で見つけた候補は、検証と未使用テストを同時に満たさない限り本番ロジックへ昇格させない。\n`;
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf8");
writeFileSync(OUT_JSON, JSON.stringify(json, null, 2), "utf8");
console.log(`[roi-validation] rows=${rows.length}`);
for (const x of verdicts) console.log(`${x.id}: discovery=${x.discovery.roi}% validation=${x.validation.roi}% test=${x.test.roi}% testTop2=${x.test.top2ExclRoi}% n=${x.test.n} => ${x.passes ? "PASS (paper only)" : x.enough ? "REJECT" : "INSUFFICIENT"}`);
console.log(`[roi-validation] 完了 → ${OUT_MD}`);
