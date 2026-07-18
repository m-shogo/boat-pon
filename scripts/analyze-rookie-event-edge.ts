/** ルーキー・若手開催のexacta 1-4残差を4号艇能力・機力・世代proxyへ分解するread-only研究。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import type { UnconventionalBoat, UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";
import { eventContextFlags } from "../src/domain/eventContext";

type Row = { race_id:string; date:string; raw_json:string; overround:number; odds14:number; winner:string|null; payout_yen:number|null };
type EvalRow = Row & { period:"discovery"|"forward"; hit:boolean; implied:number; flags:string[] };
type Metric = { n:number; hits:number; edgePp:number; roi:number; max2HitExclRoi:number };
const mechanisms = [
  ["boat4_top_rival", "4号艇が1号艇以外で全国勝率最上位"],
  ["boat4_gap05", "4号艇が他の外敵より全国勝率0.5以上上"],
  ["boat4_a_class", "4号艇がA級"],
  ["head4_only_a", "1・4号艇だけA級"],
  ["boat4_local_up", "4号艇の当地勝率が全国より1以上高い"],
  ["boat4_good_motor", "4号艇モーター2連率40%以上"],
  ["boat4_newer_head200", "4号艇登録番号が1号艇より200以上新しいproxy"],
  ["boat4_newest_field", "4号艇が6艇中もっとも登録番号が新しいproxy"],
] as const;

const db=new DatabaseSync(process.env.BOAT_PON_DB_PATH??"data/boat.sqlite",{readOnly:true}); db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const rows=db.prepare(`SELECT h.race_id,h.race_date AS date,op.raw_json,SUM(1.0/h.odds) AS overround,MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,p.combination AS winner,p.payout_yen
    FROM historical_alternative_odds h JOIN official_programs op ON op.race_id=h.race_id LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31' AND NOT EXISTS(SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
    GROUP BY h.race_id HAVING COUNT(*)=30 AND odds14 IS NOT NULL`).all() as Row[];
  const evaluations:EvalRow[]=[];
  for(const row of rows){const title=readTitle(row.race_id,row.date);if(!eventContextFlags(title,row.date).includes("rookie"))continue;const program=JSON.parse(row.raw_json) as UnconventionalProgram;const boats=[...program.boats].sort((a,b)=>a.course-b.course);const one=boats.find(b=>b.course===1),four=boats.find(b=>b.course===4);if(!one||!four)continue;const flags=mechanismFlags(boats,one,four);evaluations.push({...row,period:row.date<="2024-12-31"?"discovery":"forward",hit:row.winner==="1-4",implied:(1/row.odds14)/row.overround,flags});}
  const result={base:byPeriod(evaluations),mechanisms:mechanisms.map(([id,label])=>{const inside=evaluations.filter(r=>r.flags.includes(id)),outside=evaluations.filter(r=>!r.flags.includes(id));return{id,label,inside:byPeriod(inside),outside:byPeriod(outside)};})};
  const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,postHocMechanismScreen:true,productionConnected:false},scope:{rookieRaces:evaluations.length},result,caveats:["登録番号は年齢ではなくデビュー時期のproxy","各機序は相関であり独立因果ではない","細分化後の小標本は採用判断に使わない"]};
  mkdirSync("reports",{recursive:true});writeFileSync("reports/rookie-event-edge-decomposition.json",`${JSON.stringify(report,null,2)}\n`);
  const lines=["# ルーキー開催1-4 edge分解","",`対象: ${evaluations.length}レース / base 2024 ${cell(result.base.discovery)} / 2025 ${cell(result.base.forward)}`,"","| 機序proxy | 2024 該当 n / edge / ROI / max2 | 2025 該当 n / edge / ROI / max2 | 条件外とのedge差 |","|---|---:|---:|---:|",...result.mechanisms.map(r=>`| ${r.label} | ${cell(r.inside.discovery)} | ${cell(r.inside.forward)} | ${delta(r)} |`),"","## 解釈規則","","- 両期で条件外より残差が高く、十分なnと最大2的中除外が残る機序だけを次の固定候補にする。","- 登録番号は同期・年齢・師弟関係を意味しない。デビュー時期が近い可能性の粗いproxyに限定する。","- ルーキー開催1-4自体が55セル探索後の候補なので、この分解は独立検証ではない。",""];
  writeFileSync("reports/rookie-event-edge-decomposition.md",lines.join("\n"));console.log(`rookie event edge: races=${evaluations.length}`);
}finally{db.close();}

function mechanismFlags(boats:UnconventionalBoat[],one:UnconventionalBoat,four:UnconventionalBoat){const flags:string[]=[];const others=boats.filter(b=>b.course!==1&&b.course!==4);const own=four.nationalWinRate;if(own!=null&&others.every(b=>own>=(b.nationalWinRate??Infinity)))flags.push("boat4_top_rival");if(own!=null&&others.every(b=>own-(b.nationalWinRate??Infinity)>=0.5))flags.push("boat4_gap05");if((four.className??"").startsWith("A"))flags.push("boat4_a_class");const a=boats.filter(b=>(b.className??"").startsWith("A")).map(b=>b.course);if(a.length===2&&a.includes(1)&&a.includes(4))flags.push("head4_only_a");if(four.localWinRate!=null&&own!=null&&four.localWinRate-own>=1)flags.push("boat4_local_up");if((four.motorTop2Rate??-1)>=40)flags.push("boat4_good_motor");const oneReg=Number(one.registrationNo),fourReg=Number(four.registrationNo);if(Number.isFinite(oneReg)&&Number.isFinite(fourReg)&&fourReg-oneReg>=200)flags.push("boat4_newer_head200");const regs=boats.map(b=>Number(b.registrationNo));if(Number.isFinite(fourReg)&&regs.every(reg=>Number.isFinite(reg)&&fourReg>=reg))flags.push("boat4_newest_field");return flags;}
function readTitle(raceId:string,date:string){const path=`data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`;if(!existsSync(path))return"";const $=load(readFileSync(path,"utf8"));return $(".rname a").first().text().replace(/\s+/g," ").trim();}
function byPeriod(rows:EvalRow[]){return{discovery:metric(rows.filter(r=>r.period==="discovery")),forward:metric(rows.filter(r=>r.period==="forward"))};}
function metric(rows:EvalRow[]):Metric{const payouts=rows.filter(r=>r.hit).map(r=>r.payout_yen??0).sort((a,b)=>b-a),total=payouts.reduce((a,b)=>a+b,0),expected=rows.reduce((s,r)=>s+r.implied,0);return{n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0};}
function pct(v:number){return`${(v*100).toFixed(1)}%`;}function cell(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)} / ${pct(v.max2HitExclRoi)}`;}
function delta(r:{inside:ReturnType<typeof byPeriod>;outside:ReturnType<typeof byPeriod>}){const one=(p:"discovery"|"forward",l:string)=>{if(!r.inside[p].n||!r.outside[p].n)return`${l} n/a`;const d=r.inside[p].edgePp-r.outside[p].edgePp;return`${l} ${d>=0?"+":""}${d.toFixed(2)}pt`;};return`${one("discovery","2024")} / ${one("forward","2025")}`;}
