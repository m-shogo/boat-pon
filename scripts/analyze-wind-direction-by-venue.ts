/**
 * 会場×風向×4号艇相対能力の exacta 1-4 仮説を実払戻しで再分解する。
 * historical closing odds / 読み取り専用。T-5・本番BUY・自動購入には接続しない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/wind-direction-venue-screen.md";
const OUT_JSON = "reports/wind-direction-venue-screen.json";
const STAKE = 100;
if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

type Raw = { race_id: string; date: string; venue: string; race_no: number; odds14: number; payout: number; windDir: string | null; windMps: number | null; rawJson: string };
type Row = Raw & { period: "discovery" | "forward"; topRival4: boolean };
const raws = db.prepare(`
  SELECT h.race_id, h.race_date AS date, h.venue, h.race_no,
    MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp WHERE rp.race_id=h.race_id AND rp.bet_type='exacta' AND rp.combination='1-4' AND rp.returned=0 LIMIT 1),0) AS payout,
    c.wind_dir AS windDir, COALESCE(c.wind_mps, w.wind_speed_mps) AS windMps, op.raw_json AS rawJson
  FROM historical_alternative_odds h
  JOIN official_programs op ON op.race_id=h.race_id
  LEFT JOIN race_conditions c ON c.race_id=h.race_id
  LEFT JOIN race_weather w ON w.race_id=h.race_id
  WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
    AND json_type(op.raw_json,'$.boats')='array'
    AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
  GROUP BY h.race_id
  HAVING COUNT(*)=30 AND odds14 IS NOT NULL
  ORDER BY h.race_date, h.race_id
`).all() as Raw[];

function num(v: unknown): number | null { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function topRival4(rawJson: string): boolean {
  try {
    const boats = (JSON.parse(rawJson) as { boats?: Array<{ course?: number; nationalWinRate?: number }> }).boats ?? [];
    const by = new Map(boats.map(b => [Number(b.course), num(b.nationalWinRate)]));
    const four = by.get(4); if (four == null) return false;
    const rivals = [2, 3, 5, 6].map(c => by.get(c)).filter((x): x is number => x != null);
    return rivals.length >= 3 && four >= Math.max(...rivals);
  } catch { return false; }
}
const rows: Row[] = raws.map(r => ({ ...r, period: r.date < "2025-01-01" ? "discovery" : "forward", topRival4: topRival4(r.rawJson) }));
const mainDirections = ["北", "北東", "東", "南東", "南", "南西", "西", "北西", "無風"];
function directionOf(v: string | null): string { if (!v) return "不明"; if (mainDirections.includes(v)) return v; const map: Record<string, string> = { 南南西: "南西", 西南西: "西", 北北東: "北東", 南南東: "南東", 北北西: "北西", 東北東: "北東", 東南東: "南東", 西北西: "北西" }; return map[v] ?? "不明"; }
function round(v: number) { return Math.round(v * 100) / 100; }
type Stat = { n: number; hits: number; returnYen: number; roi: number; top2ExclRoi: number; venues: number };
function stat(xs: Row[]): Stat {
  const ret = xs.map(x => x.payout); const total = ret.reduce((a, b) => a + b, 0); const stake = xs.length * STAKE;
  const sorted = [...ret].sort((a, b) => b - a);
  return { n: xs.length, hits: ret.filter(v => v > 0).length, returnYen: total, roi: stake ? round(total / stake * 100) : 0, top2ExclRoi: stake ? round((total - (sorted[0] ?? 0) - (sorted[1] ?? 0)) / stake * 100) : 0, venues: new Set(xs.map(x => x.venue)).size };
}
const periodRows = (xs: Row[], p: Row["period"]) => xs.filter(x => x.period === p);
const wind23 = (r: Row) => r.windMps != null && r.windMps >= 2 && r.windMps < 4;
const candidates = [
  { id: "wind23_sw", label: "風速2〜3m × 南西風", test: (r: Row) => wind23(r) && directionOf(r.windDir) === "南西" },
  { id: "wind23_sw_top4", label: "風速2〜3m × 南西風 × 4号艇相対能力上位", test: (r: Row) => wind23(r) && directionOf(r.windDir) === "南西" && r.topRival4 },
  { id: "wind23_not_sw_top4", label: "風速2〜3m × 南西風以外 × 4号艇相対能力上位", test: (r: Row) => wind23(r) && directionOf(r.windDir) !== "南西" && r.topRival4 },
];
const candidateResults = candidates.map(c => { const xs = rows.filter(c.test); const d = stat(periodRows(xs, "discovery")); const f = stat(periodRows(xs, "forward")); return { ...c, discovery: d, forward: f }; });
const cellMap = new Map<string, Row[]>();
for (const r of rows) { if (!wind23(r)) continue; const key = `${r.venue}|${directionOf(r.windDir)}`; cellMap.set(key, [...(cellMap.get(key) ?? []), r]); }
const cells = [...cellMap.entries()].map(([key, xs]) => { const [venue, direction] = key.split("|"); const d = stat(periodRows(xs, "discovery")); const f = stat(periodRows(xs, "forward")); return { venue, direction, discovery: d, forward: f }; }).filter(x => x.discovery.n >= 20 && x.forward.n >= 20).sort((a, b) => Math.min(b.discovery.roi, b.forward.roi) - Math.min(a.discovery.roi, a.forward.roi));
const directionRows = mainDirections.map(direction => { const xs = rows.filter(r => wind23(r) && directionOf(r.windDir) === direction); return { direction, discovery: stat(periodRows(xs, "discovery")), forward: stat(periodRows(xs, "forward")) }; }).filter(x => x.discovery.n > 0 || x.forward.n > 0);
const now = new Date().toISOString();
const report = { generatedAt: now, safety: { readOnly: true, historicalClosingOdds: true, t5: false, productionConnected: false }, scope: { rows: rows.length, venues: new Set(rows.map(r => r.venue)).size }, candidates: candidateResults, venueDirectionCells: cells, directionRows, caveats: ["風向はrace_conditions保存値を使用。会場ごとのコース方位へは未変換", "風向/相対能力セルは探索多重度が大きい", "exacta pipelineのT-5時系列が未整備", "両期間n>=20はスクリーニングであり採用基準ではない"] };
let md = `# 会場×風向×選手相対能力 exacta 1-4 スクリーニング\n\n生成日時: ${now}\nDB: ${DB_PATH}\n\n> 実払戻しベース。historical closing oddsで、T-5・本番BUY・自動購入には接続しない。\n\n## 風向を会場方位へ変換しない理由\n\n現DBには風向はあるが、各競走場のコース方位を機械的に対応付ける確定テーブルがないため、北/南などの文字を向かい風と断定しない。まず保存値の再現性だけを見る。\n\n対象: ${rows.length}レース / ${new Set(rows.map(r => r.venue)).size}会場 / exacta 1-4\n\n## 固定候補\n\n|条件|探索n / ROI / 最大2除外|未使用n / ROI / 最大2除外|\n|---|---:|---:|\n`;
for (const c of candidateResults) md += `|${c.label}|${c.discovery.n} / ${c.discovery.roi}% / ${c.discovery.top2ExclRoi}%|${c.forward.n} / ${c.forward.roi}% / ${c.forward.top2ExclRoi}%|\n`;
md += `\n## 会場×風向セル（両期間n>=20）\n\n|会場|風向|2024 n / ROI / max2|2025 n / ROI / max2|\n|---|---|---:|---:|\n`;
for (const c of cells.slice(0, 30)) md += `|${c.venue}|${c.direction}|${c.discovery.n} / ${c.discovery.roi}% / ${c.discovery.top2ExclRoi}%|${c.forward.n} / ${c.forward.roi}% / ${c.forward.top2ExclRoi}%|\n`;
md += `\n## 判定\n\n会場×風向×能力の組合せで、両期間・最大2件除外・十分な標本を同時に満たす本番候補は未確定。最有力の南西風セルも、T-5 exacta市場がないため、次はexacta T-5保存の品質監査→paper-forwardへ進める。\n`;
mkdirSync("reports", { recursive: true }); writeFileSync(OUT_MD, md, "utf8"); writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`[wind-direction] rows=${rows.length} cells=${cells.length}`); for (const c of candidateResults) console.log(`${c.label}: discovery=${c.discovery.n}/${c.discovery.roi}% test=${c.forward.n}/${c.forward.roi}%`);
