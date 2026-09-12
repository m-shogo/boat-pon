/** ルーキー・若手開催のexacta 1-4残差を4号艇能力・機力・世代proxyへ分解するread-only研究。 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import type { UnconventionalBoat, UnconventionalProgram } from "../src/domain/unconventionalRaceFeatures";
import { eventContextFlags } from "../src/domain/eventContext";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

type Row = { race_id:string; date:string; raw_json:string; overround:number; odds14:number; winner:string|null; payout_yen:number|null; payout_rows:number; valid_rows:number };
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
const OUT_JSON="reports/rookie-event-edge-decomposition.json";
const OUT_MD="reports/rookie-event-edge-decomposition.md";

const dbPath=assertCanonicalSingleLinkRegularFile(process.env.BOAT_PON_DB_PATH??"data/boat.sqlite","RESEARCH_DB_IDENTITY_INVALID");
const db=new DatabaseSync(dbPath,{readOnly:true}); db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const rows=db.prepare(`SELECT h.race_id,h.race_date AS date,op.raw_json,SUM(1.0/h.odds) AS overround,MAX(CASE WHEN h.combination='1-4' THEN h.odds END) AS odds14,p.winner,p.payout_yen,COALESCE(p.payout_rows,0) AS payout_rows,COALESCE(p.valid_rows,0) AS valid_rows
    FROM historical_alternative_odds h JOIN official_programs op ON op.race_id=h.race_id LEFT JOIN (
      SELECT race_id,
        COUNT(*) AS payout_rows,
        SUM(CASE WHEN returned=0 AND payout_yen IS NOT NULL AND payout_yen>0 AND combination IS NOT NULL AND trim(combination)!='' THEN 1 ELSE 0 END) AS valid_rows,
        MAX(CASE WHEN returned=0 AND payout_yen IS NOT NULL AND payout_yen>0 AND combination IS NOT NULL AND trim(combination)!='' THEN combination END) AS winner,
        MAX(CASE WHEN returned=0 AND payout_yen IS NOT NULL AND payout_yen>0 AND combination IS NOT NULL AND trim(combination)!='' THEN payout_yen END) AS payout_yen
      FROM race_payouts WHERE bet_type='exacta' GROUP BY race_id
    ) p ON p.race_id=h.race_id
    WHERE h.bet_type='exacta' AND ${historicalExactaCanonicalSourcePredicate("h")} AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31' AND NOT EXISTS(SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
    GROUP BY h.race_id HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING} AND odds14 IS NOT NULL`).all() as Row[];
  const evaluations:EvalRow[]=[];
  for(const row of rows){const title=readTitle(row.race_id,row.date);if(!eventContextFlags(title,row.date).includes("rookie"))continue;const program=JSON.parse(row.raw_json) as UnconventionalProgram;const boats=[...program.boats].sort((a,b)=>a.course-b.course);const one=boats.find(b=>b.course===1),four=boats.find(b=>b.course===4);if(!one||!four)continue;const flags=mechanismFlags(boats,one,four);evaluations.push({...row,period:row.date<="2024-12-31"?"discovery":"forward",hit:row.winner==="1-4",implied:(1/row.odds14)/row.overround,flags});}
  assertPayoutCompleteness(evaluations);
  const result={base:byPeriod(evaluations),mechanisms:mechanisms.map(([id,label])=>{const inside=evaluations.filter(r=>r.flags.includes(id)),outside=evaluations.filter(r=>!r.flags.includes(id));return{id,label,inside:byPeriod(inside),outside:byPeriod(outside)};})};
  const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,postHocMechanismScreen:true,productionConnected:false},scope:{rookieRaces:evaluations.length},result,caveats:["登録番号は年齢ではなくデビュー時期のproxy","各機序は相関であり独立因果ではない","細分化後の小標本は採用判断に使わない"]};
  const lines=["# ルーキー開催1-4 edge分解","",`対象: ${evaluations.length}レース / base 2024 ${cell(result.base.discovery)} / 2025 ${cell(result.base.forward)}`,"","| 機序proxy | 2024 該当 n / edge / ROI / max2 | 2025 該当 n / edge / ROI / max2 | 条件外とのedge差 |","|---|---:|---:|---:|",...result.mechanisms.map(r=>`| ${r.label} | ${cell(r.inside.discovery)} | ${cell(r.inside.forward)} | ${delta(r)} |`),"","## 解釈規則","","- 両期で条件外より残差が高く、十分なnと最大2的中除外が残る機序だけを次の固定候補にする。","- 登録番号は同期・年齢・師弟関係を意味しない。デビュー時期が近い可能性の粗いproxyに限定する。","- ルーキー開催1-4自体が55セル探索後の候補なので、この分解は独立検証ではない。",""];
  mkdirSync("reports",{recursive:true});
  verifyExistingOutput(OUT_JSON,"ROOKIE_EVENT_PREEXISTING_JSON_IDENTITY_INVALID");
  verifyExistingOutput(OUT_MD,"ROOKIE_EVENT_PREEXISTING_MD_IDENTITY_INVALID");
  atomicPublish(OUT_JSON,`${JSON.stringify(report,null,2)}\n`,"ROOKIE_EVENT_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  atomicPublish(OUT_MD,lines.join("\n"),"ROOKIE_EVENT_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  console.log(`rookie event edge: races=${evaluations.length}`);
}finally{db.close();}

function assertPayoutCompleteness(rows:EvalRow[]):void{const byPeriod=Object.fromEntries((["discovery","forward"] as const).map(period=>{const periodRows=rows.filter(row=>row.period===period);const settled=periodRows.filter(row=>row.payout_rows===1&&row.valid_rows===1&&row.winner!=null&&row.payout_yen!=null&&row.payout_yen>0);const ambiguous=periodRows.filter(row=>row.payout_rows>1).length;return[period,{total:periodRows.length,settled:settled.length,missing:periodRows.length-settled.length,ambiguous}];}));const invalid=(byPeriod.discovery.total<=0||byPeriod.forward.total<=0||byPeriod.discovery.missing!==0||byPeriod.forward.missing!==0||byPeriod.discovery.ambiguous!==0||byPeriod.forward.ambiguous!==0);if(invalid)throw new Error(`ROOKIE_EVENT_EXACTA_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);}
function requiredPayout(row:EvalRow):number{if(row.payout_yen==null||row.payout_yen<=0)throw new Error(`ROOKIE_EVENT_EXACTA_PAYOUT_MISSING race=${row.race_id}`);return row.payout_yen;}
function mechanismFlags(boats:UnconventionalBoat[],one:UnconventionalBoat,four:UnconventionalBoat){const flags:string[]=[];const others=boats.filter(b=>b.course!==1&&b.course!==4);const own=four.nationalWinRate;if(own!=null&&others.every(b=>own>=(b.nationalWinRate??Infinity)))flags.push("boat4_top_rival");if(own!=null&&others.every(b=>own-(b.nationalWinRate??Infinity)>=0.5))flags.push("boat4_gap05");if((four.className??"").startsWith("A"))flags.push("boat4_a_class");const a=boats.filter(b=>(b.className??"").startsWith("A")).map(b=>b.course);if(a.length===2&&a.includes(1)&&a.includes(4))flags.push("head4_only_a");if(four.localWinRate!=null&&own!=null&&four.localWinRate-own>=1)flags.push("boat4_local_up");if((four.motorTop2Rate??-1)>=40)flags.push("boat4_good_motor");const oneReg=Number(one.registrationNo),fourReg=Number(four.registrationNo);if(Number.isFinite(oneReg)&&Number.isFinite(fourReg)&&fourReg-oneReg>=200)flags.push("boat4_newer_head200");const regs=boats.map(b=>Number(b.registrationNo));if(Number.isFinite(fourReg)&&regs.every(reg=>Number.isFinite(reg)&&fourReg>=reg))flags.push("boat4_newest_field");return flags;}
function readTitle(raceId:string,date:string){const path=`data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`;if(!existsSync(path))return"";const verifiedPath=assertCanonicalSingleLinkRegularFile(path,"ROOKIE_EVENT_EVENT_HTML_IDENTITY_INVALID");const $=load(readFileSync(verifiedPath,"utf8"));return $(".rname a").first().text().replace(/\s+/g," ").trim();}
function verifyExistingOutput(path:string,identityErrorCode:string){if(!existsSync(path))return;assertCanonicalSingleLinkRegularFile(path,identityErrorCode);}
function atomicPublish(path:string,content:string,identityErrorCode:string){const tempPath=`${path}.tmp-${process.pid}-${randomUUID()}`;let fd:number|null=null;try{fd=openSync(tempPath,"wx",0o600);writeFileSync(fd,content,"utf8");fsyncSync(fd);closeSync(fd);fd=null;const verifiedTempPath=assertCanonicalSingleLinkRegularFile(tempPath,identityErrorCode);renameSync(verifiedTempPath,path);}finally{if(fd!==null)closeSync(fd);rmSync(tempPath,{force:true});}}
function byPeriod(rows:EvalRow[]){return{discovery:metric(rows.filter(r=>r.period==="discovery")),forward:metric(rows.filter(r=>r.period==="forward"))};}
function metric(rows:EvalRow[]):Metric{const payouts=rows.filter(r=>r.hit).map(requiredPayout).sort((a,b)=>b-a),total=payouts.reduce((a,b)=>a+b,0),expected=rows.reduce((s,r)=>s+r.implied,0);return{n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0};}
function pct(v:number){return`${(v*100).toFixed(1)}%`;}function cell(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)} / ${pct(v.max2HitExclRoi)}`;}
function delta(r:{inside:ReturnType<typeof byPeriod>;outside:ReturnType<typeof byPeriod>}){const one=(p:"discovery"|"forward",l:string)=>{if(!r.inside[p].n||!r.outside[p].n)return`${l} n/a`;const d=r.inside[p].edgePp-r.outside[p].edgePp;return`${l} ${d>=0?"+":""}${d.toFixed(2)}pt`;};return`${one("discovery","2024")} / ${one("forward","2025")}`;}
