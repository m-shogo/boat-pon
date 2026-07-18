/** 開催何日目・準優日・最終日・レース種別とexacta買い目の市場残差を横断するread-only screen。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import { eventDayIndex, parseEventStartDate } from "../src/domain/eventStage";

type OddsRow={race_id:string;date:string;venue:string;race_type:string|null;combination:string;odds:number;winner:string|null;payout_yen:number|null};
type EvalRow=OddsRow&{period:"discovery"|"forward";implied:number;hit:boolean;flags:string[]};
type Metric={n:number;hits:number;edgePp:number;roi:number;max2HitExclRoi:number};
const selections=["1-2","1-3","1-4","1-5","1-6"];
const stages=[
  ["day1","開催初日"],["day2","開催2日目"],["day3_4","開催3〜4日目"],["day5_plus","開催5日目以降"],
  ["semifinal_day","準優勝戦がある日"],["final_day","優勝戦がある日"],["dream_race","ドリーム戦"],
  ["semifinal_race","準優勝戦"],["final_race","優勝戦"],["fixed_entry","進入固定レース"],
] as const;

const db=new DatabaseSync(process.env.BOAT_PON_DB_PATH??"data/boat.sqlite",{readOnly:true});db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try{
  const finalDays=new Set((db.prepare("SELECT DISTINCT venue||'/'||date AS key FROM race_conditions WHERE date BETWEEN '2024-01-01' AND '2025-12-31' AND race_type LIKE '%優勝戦%' AND race_type NOT LIKE '%準優勝戦%'").all() as Array<{key:string}>).map(r=>r.key));
  const semifinalDays=new Set((db.prepare("SELECT DISTINCT venue||'/'||date AS key FROM race_conditions WHERE date BETWEEN '2024-01-01' AND '2025-12-31' AND race_type LIKE '%準優勝戦%'").all() as Array<{key:string}>).map(r=>r.key));
  const odds=db.prepare(`SELECT h.race_id,h.race_date AS date,h.venue,c.race_type,h.combination,h.odds,p.combination AS winner,p.payout_yen
    FROM historical_alternative_odds h LEFT JOIN race_conditions c ON c.race_id=h.race_id LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31' AND h.combination IN('1-2','1-3','1-4','1-5','1-6')
      AND NOT EXISTS(SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      AND (SELECT COUNT(*) FROM historical_alternative_odds a WHERE a.race_id=h.race_id AND a.bet_type='exacta')=30`).all() as OddsRow[];
  const overround=new Map((db.prepare("SELECT race_id,SUM(1.0/odds) AS value FROM historical_alternative_odds WHERE bet_type='exacta' AND race_date BETWEEN '2024-01-01' AND '2025-12-31' GROUP BY race_id HAVING COUNT(*)=30").all() as Array<{race_id:string;value:number}>).map(r=>[r.race_id,r.value]));
  const flagsByRace=new Map<string,string[]>();let stageCoverage=0;
  for(const row of odds){if(flagsByRace.has(row.race_id))continue;const start=readStartDate(row.race_id,row.date),day=eventDayIndex(row.date,start),flags:string[]=[];if(day!=null)stageCoverage+=1;if(day===1)flags.push("day1");if(day===2)flags.push("day2");if(day!=null&&day>=3&&day<=4)flags.push("day3_4");if(day!=null&&day>=5)flags.push("day5_plus");const key=`${row.venue}/${row.date}`;if(semifinalDays.has(key))flags.push("semifinal_day");if(finalDays.has(key))flags.push("final_day");const type=row.race_type??"";if(/ドリーム/.test(type))flags.push("dream_race");if(/準優勝戦/.test(type))flags.push("semifinal_race");if(/優勝戦/.test(type)&&!/準優勝戦/.test(type))flags.push("final_race");if(/進入固定/.test(type))flags.push("fixed_entry");flagsByRace.set(row.race_id,flags);}
  const rows:EvalRow[]=odds.map(r=>({...r,period:r.date<="2024-12-31"?"discovery":"forward",implied:(1/r.odds)/(overround.get(r.race_id)??1),hit:r.winner===r.combination,flags:flagsByRace.get(r.race_id)??[]}));
  const cells=stages.flatMap(([id,label])=>selections.map(selection=>{const inside=rows.filter(r=>r.combination===selection&&r.flags.includes(id));const outside=rows.filter(r=>r.combination===selection&&!r.flags.includes(id));return{id,label,selection,inside:byPeriod(inside),outside:byPeriod(outside)};}));
  const eligible=cells.filter(c=>c.inside.discovery.n>=30&&c.inside.forward.n>=30);const stable=eligible.filter(c=>c.inside.discovery.edgePp>0&&c.inside.forward.edgePp>0).sort((a,b)=>Math.min(b.inside.discovery.edgePp,b.inside.forward.edgePp)-Math.min(a.inside.discovery.edgePp,a.inside.forward.edgePp));const robust=stable.filter(c=>c.inside.discovery.max2HitExclRoi>=1&&c.inside.forward.max2HitExclRoi>=1);
  const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,preRaceStage:true,productionConnected:false},coverage:{races:flagsByRace.size,eventStage:stageCoverage},family:{stages:stages.length,selections:selections.length,cells:cells.length,eligible:eligible.length},stable,robust,caveats:["開催初日は保存HTMLのリンクから復元","準優日・最終日は同日の公式race_typeから識別","50セル探索後の順位でfamily-wise補正前","historical closing oddsでT-5と非同等"]};
  mkdirSync("reports",{recursive:true});writeFileSync("reports/event-stage-market-screen.json",`${JSON.stringify(report,null,2)}\n`);
  const lines=["# 開催ステージ×exacta市場残差screen","",`開催日coverage: ${stageCoverage}/${flagsByRace.size} / 探索族: ${stages.length}ステージ×${selections.length}買い目=${cells.length}セル（両期n≥30: ${eligible.length}）`,"","## 両期で市場残差プラス","","| 順位 | ステージ | 買い目 | 2024 n / edge / ROI / max2 | 2025 n / edge / ROI / max2 |","|---:|---|---:|---:|---:|",...stable.map((c,i)=>`| ${i+1} | ${c.label} | ${c.selection} | ${cell(c.inside.discovery)} | ${cell(c.inside.forward)} |`),"","## 最大2的中除外まで両期100%以上","",robust.length?robust.map(c=>`- ${c.label} × ${c.selection}`).join("\n"):"該当なし。","","> 開催後半や優勝戦の物語ではなく、市場確率を超える残差が独立期間で残るかだけを見る。順位は仮説生成用。"];
  writeFileSync("reports/event-stage-market-screen.md",`${lines.join("\n")}\n`);console.log(`event stage market: races=${flagsByRace.size} stage=${stageCoverage} eligible=${eligible.length} stable=${stable.length} robust=${robust.length}`);
}finally{db.close();}

function readStartDate(raceId:string,date:string){const path=`data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`;if(!existsSync(path))return null;const $=load(readFileSync(path,"utf8"));return parseEventStartDate($(".rname a").first().attr("href")??"");}
function byPeriod(rows:EvalRow[]){return{discovery:metric(rows.filter(r=>r.period==="discovery")),forward:metric(rows.filter(r=>r.period==="forward"))};}
function metric(rows:EvalRow[]):Metric{const payouts=rows.filter(r=>r.hit).map(r=>r.payout_yen??0).sort((a,b)=>b-a),total=payouts.reduce((a,b)=>a+b,0),expected=rows.reduce((s,r)=>s+r.implied,0);return{n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0};}
function pct(v:number){return`${(v*100).toFixed(1)}%`;}function cell(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)} / ${pct(v.max2HitExclRoi)}`;}
