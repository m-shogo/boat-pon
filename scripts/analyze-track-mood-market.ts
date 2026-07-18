/** 同会場・同日の直前までの結果から「今日の水面傾向」を再構成し、exacta買い目残差を調べるread-only研究。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type OddsRow={race_id:string;date:string;venue:string;combination:string;odds:number;winner:string|null;payout_yen:number|null};
type ProgramRow={race_id:string;date:string;venue:string;race_no:number;trifecta:string|null;trifecta_payout:number|null};
type EntryRow={race_id:string;boat:number;finish_pos:number|null;entry_course:number|null;st:number|null;st_flying:number};
type TrackState={races:number;oneWins:number;outerWins:number;course4Top2:number;course4FinishSum:number;course4FinishN:number;course1StSum:number;course1StN:number;course4StSum:number;course4StN:number;lastWinners:number[];highPayouts:number;flyingRaces:number};
type EvalRow=OddsRow&{period:"discovery"|"forward";selection:string;implied:number;hit:boolean;flags:string[]};
type Metric={n:number;hits:number;edgePp:number;roi:number;max2HitExclRoi:number};
const selections=["1-2","1-3","1-4","1-5","1-6"];
const moods=[
  ["prior3","同会場で当日3レース以上消化"],["inner_cold","当日3R以上で1コース勝率33%以下"],["outer_hot","当日すでに外コース2勝以上"],
  ["last_outer","直前レースが4〜6コース勝ち"],["last_course4","直前レースが4コース勝ち"],["two_outer_streak","直前2レースがともに外コース勝ち"],
  ["course4_top2_twice","4コースが当日すでに2回以上2着以内"],["course4_finish_hot","当日3R以上で4コース平均着順3.0以内"],
  ["course4_st_edge","当日3R以上で4コース平均STが1コースより0.03以上速い"],["rough_payout","当日すでに3連単5000円以上が2回以上"],
  ["after_flying","当日すでにF発生レースあり"],
] as const;

const db=new DatabaseSync(process.env.BOAT_PON_DB_PATH??"data/boat.sqlite",{readOnly:true});db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try{
  const odds=db.prepare(`SELECT h.race_id,h.race_date AS date,h.venue,h.combination,h.odds,p.combination AS winner,p.payout_yen FROM historical_alternative_odds h
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31' AND h.combination IN('1-2','1-3','1-4','1-5','1-6')
      AND NOT EXISTS(SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      AND (SELECT COUNT(*) FROM historical_alternative_odds a WHERE a.race_id=h.race_id AND a.bet_type='exacta')=30`).all() as OddsRow[];
  const oddsByRace=new Map<string,OddsRow[]>();for(const row of odds)oddsByRace.set(row.race_id,[...(oddsByRace.get(row.race_id)??[]),row]);
  const overround=new Map((db.prepare("SELECT race_id,SUM(1.0/odds) AS value FROM historical_alternative_odds WHERE bet_type='exacta' AND race_date BETWEEN '2024-01-01' AND '2025-12-31' GROUP BY race_id HAVING COUNT(*)=30").all() as Array<{race_id:string;value:number}>).map(r=>[r.race_id,r.value]));
  const programs=db.prepare(`SELECT op.race_id,op.date,op.venue,op.race_no,rr.trifecta,rr.payout_yen AS trifecta_payout FROM official_programs op LEFT JOIN race_results rr ON rr.race_id=op.race_id
    WHERE op.date BETWEEN '2024-01-01' AND '2025-12-31' AND EXISTS(SELECT 1 FROM historical_alternative_odds h WHERE h.race_date=op.date AND h.bet_type='exacta') ORDER BY op.date,op.venue,op.race_no`).all() as ProgramRow[];
  const entries=db.prepare(`SELECT re.race_id,re.boat,re.finish_pos,re.entry_course,re.st,re.st_flying FROM race_entries re WHERE re.date BETWEEN '2024-01-01' AND '2025-12-31'
    AND EXISTS(SELECT 1 FROM historical_alternative_odds h WHERE h.race_date=re.date AND h.bet_type='exacta')`).all() as EntryRow[];
  const entriesByRace=new Map<string,EntryRow[]>();for(const e of entries)entriesByRace.set(e.race_id,[...(entriesByRace.get(e.race_id)??[]),e]);
  const states=new Map<string,TrackState>();const evaluations:EvalRow[]=[];
  for(const program of programs){const key=`${program.date}/${program.venue}`,state=states.get(key)??emptyState(),flags=trackFlags(state);const market=oddsByRace.get(program.race_id)??[];const total=overround.get(program.race_id)??1;
    for(const row of market)evaluations.push({...row,period:row.date<="2024-12-31"?"discovery":"forward",selection:row.combination,implied:(1/row.odds)/total,hit:row.winner===row.combination,flags});
    applyRace(state,entriesByRace.get(program.race_id)??[],program.trifecta_payout);states.set(key,state);
  }
  const cells=moods.flatMap(([id,label])=>selections.map(selection=>{const inside=evaluations.filter(r=>r.selection===selection&&r.flags.includes(id)),outside=evaluations.filter(r=>r.selection===selection&&!r.flags.includes(id));return{id,label,selection,inside:byPeriod(inside),outside:byPeriod(outside)};}));
  const eligible=cells.filter(c=>c.inside.discovery.n>=30&&c.inside.forward.n>=30);const stable=eligible.filter(c=>c.inside.discovery.edgePp>0&&c.inside.forward.edgePp>0).sort((a,b)=>Math.min(b.inside.discovery.edgePp,b.inside.forward.edgePp)-Math.min(a.inside.discovery.edgePp,a.inside.forward.edgePp));const robust=stable.filter(c=>c.inside.discovery.max2HitExclRoi>=1&&c.inside.forward.max2HitExclRoi>=1);
  const negative=eligible.filter(c=>c.inside.discovery.edgePp<0&&c.inside.forward.edgePp<0).sort((a,b)=>Math.max(a.inside.discovery.edgePp,a.inside.forward.edgePp)-Math.max(b.inside.discovery.edgePp,b.inside.forward.edgePp));
  const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,priorVenueDayOnly:true,productionConnected:false},coverage:{races:new Set(evaluations.map(r=>r.race_id)).size},family:{moods:moods.length,selections:selections.length,cells:cells.length,eligible:eligible.length},stable,robust,negative,caveats:["現在レースより前の同会場当日結果だけを反映","水面傾向は選手構成・番組構成・天候変化も含むproxy","3連単5000円は荒れ度の便宜的閾値","55セル探索後の順位で独立検証ではない"]};
  mkdirSync("reports",{recursive:true});writeFileSync("reports/track-mood-market-screen.json",`${JSON.stringify(report,null,2)}\n`);
  const lines=["# 当日の水面ムード×exacta市場残差","","> 直前までのコース成績・ST・荒配当・Fだけを使用。『今日は荒れる』を結果後に決めない。","",`探索族: ${moods.length}水面proxy×${selections.length}買い目=${cells.length}セル（両期n≥30: ${eligible.length}）`,"","## 両期で市場残差プラス","","| 順位 | 水面proxy | 買い目 | 2024 n / edge / ROI / max2 | 2025 n / edge / ROI / max2 |","|---:|---|---:|---:|---:|",...stable.map((c,i)=>`| ${i+1} | ${c.label} | ${c.selection} | ${cell(c.inside.discovery)} | ${cell(c.inside.forward)} |`),"","最大2的中除外まで両期100%以上:","",robust.length?robust.map(c=>`- ${c.label} × ${c.selection}`).join("\n"):"該当なし。","","## 両期で市場残差マイナス","","| 水面proxy | 買い目 | 2024 n / edge / ROI | 2025 n / edge / ROI |","|---|---:|---:|---:|",...negative.map(c=>`| ${c.label} | ${c.selection} | ${short(c.inside.discovery)} | ${short(c.inside.forward)} |`),"","## 判定規則","","- 直前の外枠勝ちを見て次も外枠と短絡しない。正規化市場確率が既に織り込んだ後の残差を見る。","- 頑健セルがあっても、天候・会場・レース番号を揃えたfuture-only T-5検証まで採用しない。"];
  writeFileSync("reports/track-mood-market-screen.md",`${lines.join("\n")}\n`);console.log(`track mood market: races=${report.coverage.races} eligible=${eligible.length} stable=${stable.length} robust=${robust.length}`);
}finally{db.close();}

function emptyState():TrackState{return{races:0,oneWins:0,outerWins:0,course4Top2:0,course4FinishSum:0,course4FinishN:0,course1StSum:0,course1StN:0,course4StSum:0,course4StN:0,lastWinners:[],highPayouts:0,flyingRaces:0};}
function trackFlags(s:TrackState){const f:string[]=[];if(s.races>=3)f.push("prior3");if(s.races>=3&&s.oneWins/s.races<=1/3)f.push("inner_cold");if(s.outerWins>=2)f.push("outer_hot");const last=s.lastWinners.at(-1);if(last!=null&&last>=4)f.push("last_outer");if(last===4)f.push("last_course4");if(s.lastWinners.length>=2&&s.lastWinners.slice(-2).every(v=>v>=4))f.push("two_outer_streak");if(s.course4Top2>=2)f.push("course4_top2_twice");if(s.races>=3&&s.course4FinishN>=3&&s.course4FinishSum/s.course4FinishN<=3)f.push("course4_finish_hot");if(s.races>=3&&s.course1StN>=3&&s.course4StN>=3&&s.course1StSum/s.course1StN-s.course4StSum/s.course4StN>=0.03)f.push("course4_st_edge");if(s.highPayouts>=2)f.push("rough_payout");if(s.flyingRaces>=1)f.push("after_flying");return f;}
function applyRace(s:TrackState,entries:EntryRow[],payout:number|null){if(!entries.length)return;s.races+=1;const winner=entries.find(e=>e.finish_pos===1),course=winner?.entry_course??winner?.boat;if(course===1)s.oneWins+=1;if(course!=null&&course>=4)s.outerWins+=1;if(course!=null)s.lastWinners.push(course);if(s.lastWinners.length>2)s.lastWinners.shift();const four=entries.find(e=>(e.entry_course??e.boat)===4);if(four?.finish_pos!=null){s.course4FinishSum+=four.finish_pos;s.course4FinishN+=1;if(four.finish_pos<=2)s.course4Top2+=1;}const one=entries.find(e=>(e.entry_course??e.boat)===1);if(one?.st!=null&&!one.st_flying){s.course1StSum+=one.st;s.course1StN+=1;}if(four?.st!=null&&!four.st_flying){s.course4StSum+=four.st;s.course4StN+=1;}if((payout??0)>=5000)s.highPayouts+=1;if(entries.some(e=>e.st_flying))s.flyingRaces+=1;}
function byPeriod(rows:EvalRow[]){return{discovery:metric(rows.filter(r=>r.period==="discovery")),forward:metric(rows.filter(r=>r.period==="forward"))};}function metric(rows:EvalRow[]):Metric{const payouts=rows.filter(r=>r.hit).map(r=>r.payout_yen??0).sort((a,b)=>b-a),total=payouts.reduce((a,b)=>a+b,0),expected=rows.reduce((s,r)=>s+r.implied,0);return{n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0};}
function pct(v:number){return`${(v*100).toFixed(1)}%`;}function cell(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)} / ${pct(v.max2HitExclRoi)}`;}function short(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)}`;}
