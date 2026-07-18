/**
 * 選手間の公開レース履歴をpoint-in-timeで再構成し、exacta 1-4市場残差との関係を調べるread-only研究。
 * 師弟・私的関係は推測せず、過去日までの同走・直接対戦と登録番号近接proxyだけを使う。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";

type ExactaRow = { race_id: string; date: string; venue: string; overround: number; odds14: number; winner: string | null; payout_yen: number | null; wind_speed_mps: number | null; wind_dir: string | null };
type ProgramRow = { race_id: string; date: string; venue: string; raw_json: string; trifecta: string };
type PairState = { meetings: number; wins: Map<string, number>; lastWinner: string | null };
type EvalRow = ExactaRow & { period: "discovery" | "forward"; hit: boolean; implied: number; flags: string[] };
type Metric = { n: number; hits: number; edgePp: number; roi: number; max2HitExclRoi: number; zScore: number };
type OfficialRelationshipRegistry = { relationships: Array<{ relationshipType: string; mentor: { registrationNo: string }; apprentice: { registrationNo: string }; sourcePublishedDate: string }> };

const officialRegistry = JSON.parse(readFileSync("docs/official-racer-relationships.json", "utf8")) as OfficialRelationshipRegistry;
const officialPairs = new Map(officialRegistry.relationships.map(row => [pairKey(row.mentor.registrationNo, row.apprentice.registrationNo), row]));

const db = new DatabaseSync(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const exacta = db.prepare(`
    SELECT h.race_id, h.race_date AS date, h.venue, SUM(1.0/h.odds) AS overround,
      MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,
      p.combination AS winner, p.payout_yen, w.wind_speed_mps, c.wind_dir
    FROM historical_alternative_odds h
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    LEFT JOIN race_weather w ON w.race_id=h.race_id
    LEFT JOIN race_conditions c ON c.race_id=h.race_id
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
    GROUP BY h.race_id HAVING COUNT(*)=30 AND odds14 IS NOT NULL
  `).all() as ExactaRow[];
  const exactaMap = new Map(exacta.map(row => [row.race_id, row]));
  const programs = db.prepare(`
    SELECT op.race_id, op.date, op.venue, op.raw_json, rr.trifecta
    FROM official_programs op JOIN race_results rr ON rr.race_id=op.race_id AND rr.returned=0
    WHERE op.date BETWEEN '2023-01-01' AND '2025-12-31' AND json_type(op.raw_json,'$.boats')='array'
      AND rr.trifecta IS NOT NULL AND rr.trifecta!=''
    ORDER BY op.date, op.venue, op.race_no
  `).all() as ProgramRow[];

  const pairs = new Map<string, PairState>(); const evaluations: EvalRow[] = [];
  let currentDate = ""; let pending: Array<{ program: UnconventionalProgram; winnerCourse: number }> = [];
  for (const row of programs) {
    if (currentDate && row.date !== currentDate) { applyDay(pending, pairs); pending = []; }
    currentDate = row.date;
    const program = JSON.parse(row.raw_json) as UnconventionalProgram; const boats = [...program.boats].sort((a, b) => a.course - b.course);
    const one = boats.find(boat => boat.course === 1); const four = boats.find(boat => boat.course === 4); const market = exactaMap.get(row.race_id);
    if (market && one?.registrationNo && four?.registrationNo) {
      const pair = pairs.get(pairKey(one.registrationNo, four.registrationNo)); const flags: string[] = [];
      if ((pair?.meetings ?? 0) >= 5) flags.push("1号艇4号艇_過去同走5回以上");
      if ((pair?.meetings ?? 0) >= 10) flags.push("1号艇4号艇_過去同走10回以上");
      if ((pair?.meetings ?? 0) >= 3 && (pair?.wins.get(four.registrationNo) ?? 0) > (pair?.wins.get(one.registrationNo) ?? 0)) flags.push("4号艇_直接対戦優勢");
      if ((pair?.meetings ?? 0) >= 3 && (pair?.wins.get(one.registrationNo) ?? 0) > (pair?.wins.get(four.registrationNo) ?? 0)) flags.push("1号艇_直接対戦優勢");
      if (pair?.lastWinner === four.registrationNo) flags.push("直近直接対戦_4号艇勝ち");
      const officialRelationship = officialPairs.get(pairKey(one.registrationNo, four.registrationNo));
      if (officialRelationship && row.date >= officialRelationship.sourcePublishedDate) flags.push("公式出典付き師弟pair");
      if (Math.abs(Number(one.registrationNo) - Number(four.registrationNo)) <= 60) flags.push("登録番号近接60以内_proxy");
      const familiarity = fieldFamiliarity(boats.map(boat => boat.registrationNo).filter((v): v is string => Boolean(v)), pairs);
      if (familiarity >= 30) flags.push("メンバー過去同走合計30以上");
      if (isTopRival(program, 4)) flags.push("4号艇_最強ライバル");
      if (market.wind_speed_mps != null && market.wind_speed_mps >= 2 && market.wind_speed_mps < 4 && market.wind_dir === "南西") flags.push("風2_3m南西");
      evaluations.push({ ...market, period: row.date <= "2024-12-31" ? "discovery" : "forward", hit: market.winner === "1-4", implied: (1 / market.odds14) / market.overround, flags });
    }
    pending.push({ program, winnerCourse: Number(row.trifecta.split("-")[0]) });
  }
  if (pending.length) applyDay(pending, pairs);

  const relationshipFlags = ["公式出典付き師弟pair", "1号艇4号艇_過去同走5回以上", "1号艇4号艇_過去同走10回以上", "4号艇_直接対戦優勢", "1号艇_直接対戦優勢", "直近直接対戦_4号艇勝ち", "登録番号近接60以内_proxy", "メンバー過去同走合計30以上"];
  const scopes = [
    { id: "all", label: "exacta 1-4全体", filter: (_row: EvalRow) => true },
    { id: "southwest", label: "風2〜3m・南西風", filter: (row: EvalRow) => row.flags.includes("風2_3m南西") },
    { id: "target", label: "風2〜3m・南西風・4号艇最強", filter: (row: EvalRow) => row.flags.includes("風2_3m南西") && row.flags.includes("4号艇_最強ライバル") },
  ];
  const results = scopes.map(scope => ({ ...scope, base: byPeriod(evaluations.filter(scope.filter)), relationships: relationshipFlags.map(flag => {
    const inside = evaluations.filter(row => scope.filter(row) && row.flags.includes(flag)); const outside = evaluations.filter(row => scope.filter(row) && !row.flags.includes(flag));
    return { flag, inside: byPeriod(inside), outside: byPeriod(outside) };
  }) }));
  const report = { generatedAt: new Date().toISOString(), safety: { readOnly: true, pointInTimePriorDay: true, privateRelationshipInference: false, profitClaim: false },
    scope: { historyFrom: "2023-01-01", evaluation: "2024-01-01..2025-12-31", exactaRaces: evaluations.length },
    officialRelationshipRegistry: { relationshipCount: officialRegistry.relationships.length, pointInTimeRule: "sourcePublishedDate以後のみ" },
    unavailable: ["網羅的な公式師弟pair registry", "支部・登録期のhistorical snapshot", "企画タイトルのhistorical保存"],
    caveats: ["登録番号近接は同期の近似であり公式登録期ではない", "同走・対戦は関係性の証拠ではない", "個人単位の不正判定には使わない"],
    results: results.map(({ filter: _filter, ...result }) => result) };
  mkdirSync("reports", { recursive: true }); writeFileSync("reports/racer-relationship-market-screen.json", `${JSON.stringify(report, null, 2)}\n`);
  const lines = ["# 選手関係性と市場残差screen", "", "> 公開レース履歴だけをprior-dayで再構成。師弟・私的関係・不正を推測しない。", "", `評価exactaレース: ${evaluations.length}`, "",
    ...results.flatMap(result => [
      `## ${result.label}`, "", `base: 2024 ${cell(result.base.discovery)} / 2025 ${cell(result.base.forward)}`, "",
      "| 関係proxy | 2024 該当 n / edge / ROI / max2 | 2025 該当 n / edge / ROI / max2 | 条件外との差 |", "|---|---:|---:|---:|",
      ...result.relationships.map(row => `| ${row.flag} | ${cell(row.inside.discovery)} | ${cell(row.inside.forward)} | ${deltaCell(row)} |`), "",
    ]),
    "## 解釈規則", "", `- 公式出典付き師弟registryは${officialRegistry.relationships.length}組だけの非網羅的な台帳。記事公開日以後だけをpoint-in-time利用する。`, "- 同支部は現在DBにないため推測しない。『事務所』に相当する公式構造も確認できていない。", "- 過去同走や直接対戦は『慣れ』のproxyであり、協調・忖度・不正の証拠ではない。", "- 個人名を異常ランキングに出さず、集団レベルの市場残差だけを扱う。", "- 企画番組・支部・師弟を追加しても、独立期間と価格時点同等性を通るまでproductionへ接続しない。"];
  writeFileSync("reports/racer-relationship-market-screen.md", `${lines.join("\n")}\n`);
  console.log(`relationship market screen: exacta=${evaluations.length}`);
} finally { db.close(); }

function byPeriod(rows: EvalRow[]) { return { discovery: metric(rows.filter(row => row.period === "discovery")), forward: metric(rows.filter(row => row.period === "forward")) }; }
function metric(rows: EvalRow[]): Metric { const payouts = rows.filter(row => row.hit).map(row => row.payout_yen ?? 0).sort((a, b) => b - a); const n = rows.length; const hits = payouts.length; const expected = rows.reduce((sum, row) => sum + row.implied, 0); const variance = rows.reduce((sum, row) => sum + row.implied * (1-row.implied), 0); const total = payouts.reduce((a,b)=>a+b,0); return { n, hits, edgePp: n ? (hits/n-expected/n)*100 : 0, roi: n ? total/(n*100) : 0, max2HitExclRoi: n>2 ? (total-(payouts[0]??0)-(payouts[1]??0))/((n-2)*100) : 0, zScore: variance>0 ? (hits-expected)/Math.sqrt(variance) : 0 }; }
function applyDay(rows: Array<{ program: UnconventionalProgram; winnerCourse: number }>, pairs: Map<string, PairState>) { for (const row of rows) { const boats=[...row.program.boats]; const winner=boats.find(boat=>boat.course===row.winnerCourse)?.registrationNo??null; for(let i=0;i<boats.length;i++) for(let j=i+1;j<boats.length;j++){const a=boats[i].registrationNo,b=boats[j].registrationNo;if(!a||!b)continue;const key=pairKey(a,b);const state=pairs.get(key)??{meetings:0,wins:new Map<string,number>(),lastWinner:null};state.meetings+=1;if(winner===a||winner===b){state.wins.set(winner,(state.wins.get(winner)??0)+1);state.lastWinner=winner;}pairs.set(key,state);}} }
function pairKey(a:string,b:string){return a<b?`${a}/${b}`:`${b}/${a}`;}
function fieldFamiliarity(regs:string[],pairs:Map<string,PairState>){let total=0;for(let i=0;i<regs.length;i++)for(let j=i+1;j<regs.length;j++)total+=pairs.get(pairKey(regs[i],regs[j]))?.meetings??0;return total;}
function isTopRival(program:UnconventionalProgram,course:number){const boats=[...program.boats];const own=boats.find(b=>b.course===course)?.nationalWinRate;if(own==null)return false;return boats.filter(b=>b.course!==1&&b.course!==course).every(b=>own>=(b.nationalWinRate??Number.POSITIVE_INFINITY));}
function pct(v:number){return `${(v*100).toFixed(1)}%`;}
function cell(m:Metric){return `${m.n} / ${m.edgePp>=0?"+":""}${m.edgePp.toFixed(2)}pt / ${pct(m.roi)} / ${pct(m.max2HitExclRoi)}`;}
function deltaCell(row:{inside:ReturnType<typeof byPeriod>;outside:ReturnType<typeof byPeriod>}) {
  const value = (period: "discovery" | "forward", label: string) => {
    if (row.inside[period].n === 0 || row.outside[period].n === 0) return `${label} n/a`;
    const delta = row.inside[period].edgePp - row.outside[period].edgePp;
    return `${label} ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}pt`;
  };
  return `${value("discovery", "2024")} / ${value("forward", "2025")}`;
}
