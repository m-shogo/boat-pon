/** exacta全30通り内の相対価格・集中度を2024→2025で検証するread-only screen。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { adjacentSecondRatio, buildExactaMarketShape } from "../src/domain/exactaMarketShape";

type DbRow={race_id:string;date:string;combination:string;odds:number;winner:string|null;payout_yen:number|null};
type Metric={n:number;hits:number;edgePp:number;roi:number;max2HitExclRoi:number};
type EvalRow={period:"discovery"|"forward";selection:string;implied:number;hit:boolean;payout:number;flags:string[]};
const selections=["1-2","1-3","1-4","1-5","1-6"];
const factors=[
  ["top3_popular","全30通りで人気3位以内","rank"],
  ["rank4_10","全30通りで人気4〜10位","rank"],
  ["rank11_plus","全30通りで人気11位以下","rank"],
  ["one_mass_55","1着1号艇への市場確率mass 55%以上","concentration"],
  ["one_mass_under40","1着1号艇への市場確率mass 40%未満","concentration"],
  ["effective_under12","市場の有効選択肢数12未満","concentration"],
  ["effective_over18","市場の有効選択肢数18超","concentration"],
  ["local_overbought125","隣接2着艇より25%以上売れ過ぎ","local_shape"],
  ["local_underbought80","隣接2着艇より20%以上売れ残り","local_shape"],
  ["integer_odds_placebo","オッズが整数_placebo","placebo"],
  ["decimal7_placebo","オッズ小数第1位が7_placebo","placebo"],
] as const;

const db=new DatabaseSync(process.env.BOAT_PON_DB_PATH??"data/boat.sqlite",{readOnly:true});
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  const rows=db.prepare(`SELECT h.race_id,h.race_date AS date,h.combination,h.odds,p.combination AS winner,p.payout_yen
    FROM historical_alternative_odds h LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta'
    WHERE h.bet_type='exacta' AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND NOT EXISTS(SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      AND (SELECT COUNT(*) FROM historical_alternative_odds a WHERE a.race_id=h.race_id AND a.bet_type='exacta')=30
    ORDER BY h.race_id,h.combination`).all() as DbRow[];
  const byRace=new Map<string,DbRow[]>();for(const row of rows){const race=byRace.get(row.race_id)??[];race.push(row);byRace.set(row.race_id,race);}
  const evalRows:EvalRow[]=[];const distributions:{oneMass:number;effective:number}[]=[];let evaluatedRaces=0;
  for(const race of byRace.values()){
    const shape=buildExactaMarketShape(race);if(!shape)continue;evaluatedRaces+=1;
    distributions.push({oneMass:shape.firstCourseMass.get("1")??0,effective:shape.effectiveSelections});
    for(const selection of selections){const source=race.find(r=>r.combination===selection)!;const rank=shape.ranks.get(selection)!;const ratio=adjacentSecondRatio(shape,selection);const flags:string[]=[];
      if(rank<=3)flags.push("top3_popular");if(rank>=4&&rank<=10)flags.push("rank4_10");if(rank>=11)flags.push("rank11_plus");
      const oneMass=shape.firstCourseMass.get("1")??0;if(oneMass>=.55)flags.push("one_mass_55");if(oneMass<.40)flags.push("one_mass_under40");
      if(shape.effectiveSelections<12)flags.push("effective_under12");if(shape.effectiveSelections>18)flags.push("effective_over18");
      if(ratio!=null&&ratio>=1.25)flags.push("local_overbought125");if(ratio!=null&&ratio<=.80)flags.push("local_underbought80");
      if(Math.abs(source.odds-Math.round(source.odds))<1e-9)flags.push("integer_odds_placebo");if(Math.round(source.odds*10)%10===7)flags.push("decimal7_placebo");
      evalRows.push({period:source.date<="2024-12-31"?"discovery":"forward",selection,implied:shape.probabilities.get(selection)!,hit:source.winner===selection,payout:source.payout_yen??0,flags});
    }
  }
  const cells=factors.flatMap(([id,label,group])=>selections.map(selection=>({id,label,group,selection,discovery:metric(evalRows.filter(r=>r.period==="discovery"&&r.selection===selection&&r.flags.includes(id))),forward:metric(evalRows.filter(r=>r.period==="forward"&&r.selection===selection&&r.flags.includes(id)))})));
  const eligible=cells.filter(c=>c.discovery.n>=30&&c.forward.n>=30);const stable=eligible.filter(c=>c.discovery.edgePp>0&&c.forward.edgePp>0).sort((a,b)=>Math.min(b.discovery.edgePp,b.forward.edgePp)-Math.min(a.discovery.edgePp,a.forward.edgePp));const robust=stable.filter(c=>c.discovery.max2HitExclRoi>=1&&c.forward.max2HitExclRoi>=1);const placebo=eligible.filter(c=>c.group==="placebo");
  const quantiles={oneMass:q(distributions.map(d=>d.oneMass)),effectiveSelections:q(distributions.map(d=>d.effective))};
  const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,closingOddsOnly:true,productionConnected:false},coverage:{candidateRaces:byRace.size,evaluatedRaces,rejectedMarkets:byRace.size-evaluatedRaces,evaluatedRows:evalRows.length},quantiles,family:{factors:factors.length,selections:selections.length,cells:cells.length,eligible:eligible.length},stable,robust,placebo,caveats:["historical closing oddsでT-5ではない","30行でも組番重複・欠損があるmarketは除外","閾値は探索用で事前登録されていない","整数・小数末尾7は偽陽性対照","同一市場から条件とimpliedを作るため因果解釈しない"]};
  mkdirSync("reports",{recursive:true});writeFileSync("reports/market-microstructure-screen.json",`${JSON.stringify(report,null,2)}\n`);
  const lines=["# exacta市場マイクロ構造screen","","> 全30通り内の相対価格・票の集中を調べるread-only探索。closing oddsでありT-5ではない。","",`coverage: 候補${byRace.size} / 厳密評価${evaluatedRaces} / 不完全market除外${byRace.size-evaluatedRaces}レース / ${evalRows.length}評価行`,`探索族: ${factors.length}因子×${selections.length}買い目=${cells.length}セル（両期n≥30: ${eligible.length}）`,"",`分布: 1号艇mass p10/p50/p90=${fmtQ(quantiles.oneMass,true)}、有効選択肢数=${fmtQ(quantiles.effectiveSelections,false)}`,"","## 2024・2025とも市場残差プラス","","| 順位 | 市場構造 | 買い目 | 2024 n / edge / ROI / max2 | 2025 n / edge / ROI / max2 |","|---:|---|---:|---:|---:|",...stable.map((c,i)=>`| ${i+1} | ${c.label} | ${c.selection} | ${cell(c.discovery)} | ${cell(c.forward)} |`),"","最大2的中除外まで両期100%以上:","",robust.length?robust.map(c=>`- ${c.label} × ${c.selection}`).join("\n"):"該当なし。","","## 偽陽性対照","","| placebo | 買い目 | 2024 n / edge / ROI | 2025 n / edge / ROI |","|---|---:|---:|---:|",...placebo.map(c=>`| ${c.label} | ${c.selection} | ${short(c.discovery)} | ${short(c.forward)} |`),"","## 判定","","- 相対価格の歪みがplaceboを明確に上回り、両期の外れ値除外ROIも100%以上の場合だけ次段階へ進める。","- closing oddsで見つけた条件を、そのまま通知・BUY・本番判定へ接続しない。"];
  writeFileSync("reports/market-microstructure-screen.md",`${lines.join("\n")}\n`);console.log(`market microstructure: candidates=${byRace.size} evaluated=${evaluatedRaces} eligible=${eligible.length} stable=${stable.length} robust=${robust.length}`);
} finally {db.close();}

function metric(rows:EvalRow[]):Metric{const payouts=rows.filter(r=>r.hit).map(r=>r.payout).sort((a,b)=>b-a),total=payouts.reduce((a,b)=>a+b,0),expected=rows.reduce((s,r)=>s+r.implied,0);return{n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0};}
function q(values:number[]){const sorted=[...values].sort((a,b)=>a-b);const at=(p:number)=>sorted[Math.floor((sorted.length-1)*p)]??0;return{p10:at(.1),p50:at(.5),p90:at(.9)};}function fmtQ(v:{p10:number;p50:number;p90:number},pct:boolean){const f=(x:number)=>pct?`${(x*100).toFixed(1)}%`:x.toFixed(1);return`${f(v.p10)} / ${f(v.p50)} / ${f(v.p90)}`;}function pct(v:number){return`${(v*100).toFixed(1)}%`;}function cell(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)} / ${pct(v.max2HitExclRoi)}`;}function short(v:Metric){return`${v.n} / ${v.edgePp>=0?"+":""}${v.edgePp.toFixed(2)}pt / ${pct(v.roi)}`;}
