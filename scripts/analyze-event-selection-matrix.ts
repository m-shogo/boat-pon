/** 開催文脈×1着1号艇のexacta 5買い目を横断し、1-4だけの後付け物語を崩すread-only screen。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import { EVENT_CONTEXT_CATEGORIES, eventContextFlags } from "../src/domain/eventContext";

type OddsRow = { race_id: string; date: string; combination: string; odds: number; winner: string | null; payout_yen: number | null };
type EvalRow = OddsRow & { period: "discovery" | "forward"; implied: number; hit: boolean; flags: string[] };
type Metric = { n: number; hits: number; edgePp: number; roi: number; max2HitExclRoi: number };
const selections = ["1-2", "1-3", "1-4", "1-5", "1-6"];

const db = new DatabaseSync(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const odds = db.prepare(`
    SELECT h.race_id, h.race_date AS date, h.combination, h.odds, p.combination AS winner, p.payout_yen
    FROM historical_alternative_odds h
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND h.combination IN ('1-2','1-3','1-4','1-5','1-6')
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      AND (SELECT COUNT(*) FROM historical_alternative_odds all_odds WHERE all_odds.race_id=h.race_id AND all_odds.bet_type='exacta')=30
  `).all() as OddsRow[];
  const raceIds = [...new Set(odds.map(row => row.race_id))];
  const overround = new Map((db.prepare(`
    SELECT race_id, SUM(1.0/odds) AS value FROM historical_alternative_odds
    WHERE bet_type='exacta' AND race_date BETWEEN '2024-01-01' AND '2025-12-31' GROUP BY race_id HAVING COUNT(*)=30
  `).all() as Array<{ race_id: string; value: number }>).map(row => [row.race_id, row.value]));
  const flagsByRace = new Map(raceIds.map(raceId => {
    const date = `${raceId.slice(0, 4)}-${raceId.slice(4, 6)}-${raceId.slice(6, 8)}`;
    return [raceId, eventContextFlags(readEventTitle(raceId, date), date)] as const;
  }));
  const rows: EvalRow[] = odds.map(row => ({ ...row, period: row.date <= "2024-12-31" ? "discovery" : "forward", implied: (1 / row.odds) / (overround.get(row.race_id) ?? 1), hit: row.winner === row.combination, flags: flagsByRace.get(row.race_id) ?? [] }));
  const cells = EVENT_CONTEXT_CATEGORIES.flatMap(category => selections.map(selection => {
    const inside = rows.filter(row => row.combination === selection && row.flags.includes(category.id));
    const outside = rows.filter(row => row.combination === selection && !row.flags.includes(category.id));
    return { category: category.id, categoryLabel: category.label, selection, inside: byPeriod(inside), outside: byPeriod(outside) };
  }));
  const eligible = cells.filter(cell => cell.inside.discovery.n >= 30 && cell.inside.forward.n >= 30);
  const stable = eligible.filter(cell => cell.inside.discovery.edgePp > 0 && cell.inside.forward.edgePp > 0)
    .sort((a, b) => Math.min(b.inside.discovery.edgePp, b.inside.forward.edgePp) - Math.min(a.inside.discovery.edgePp, a.inside.forward.edgePp));
  const robust = stable.filter(cell => cell.inside.discovery.max2HitExclRoi >= 1 && cell.inside.forward.max2HitExclRoi >= 1);
  const report = { generatedAt: new Date().toISOString(), safety: { readOnly: true, preDefinedFamily: true, productionConnected: false },
    family: { categories: EVENT_CONTEXT_CATEGORIES.length, selections: selections.length, cells: cells.length, eligibleCells: eligible.length }, stable, robust,
    caveats: ["安定セル順位も探索結果でありfamily-wise補正前", "1着1号艇の5買い目だけを比較", "historical closing oddsでT-5価格ではない"] };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/event-selection-matrix.json", `${JSON.stringify(report, null, 2)}\n`);
  const lines = ["# イベント文脈×exacta買い目matrix", "", `探索族: ${EVENT_CONTEXT_CATEGORIES.length}カテゴリ × ${selections.length}買い目 = ${cells.length}セル（両期n≥30: ${eligible.length}）`, "",
    "## 両期で市場残差がプラスのセル", "", "| 順位 | 文脈 | 買い目 | 2024 n / edge / ROI / max2 | 2025 n / edge / ROI / max2 |", "|---:|---|---:|---:|---:|",
    ...stable.map((cell, index) => `| ${index + 1} | ${cell.categoryLabel} | ${cell.selection} | ${metricCell(cell.inside.discovery)} | ${metricCell(cell.inside.forward)} |`), "",
    "## 最大2的中除外まで両期100%以上", "", robust.length ? robust.map(cell => `- ${cell.categoryLabel} × ${cell.selection}`).join("\n") : "該当なし。", "",
    "> この順位は仮説生成用。55セルを見た後の順位であり、future-only T-5へ事前固定するまではedge認定しない。"];
  writeFileSync("reports/event-selection-matrix.md", `${lines.join("\n")}\n`);
  console.log(`event selection matrix: races=${raceIds.length} eligible=${eligible.length} stable=${stable.length} robust=${robust.length}`);
} finally { db.close(); }

function readEventTitle(raceId: string, date: string) { const path=`data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`; if(!existsSync(path))return ""; const $=load(readFileSync(path,"utf8")); return $(".rname a").first().text().replace(/\s+/g," ").trim(); }
function byPeriod(rows: EvalRow[]) { return { discovery: metric(rows.filter(row => row.period === "discovery")), forward: metric(rows.filter(row => row.period === "forward")) }; }
function metric(rows: EvalRow[]): Metric { const payouts=rows.filter(row=>row.hit).map(row=>row.payout_yen??0).sort((a,b)=>b-a); const total=payouts.reduce((a,b)=>a+b,0); const expected=rows.reduce((sum,row)=>sum+row.implied,0); return {n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0}; }
function pct(value:number){return `${(value*100).toFixed(1)}%`;}
function metricCell(value:Metric){return `${value.n} / ${value.edgePp>=0?"+":""}${value.edgePp.toFixed(2)}pt / ${pct(value.roi)} / ${pct(value.max2HitExclRoi)}`;}
