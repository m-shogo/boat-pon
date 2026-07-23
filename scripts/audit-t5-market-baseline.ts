/**
 * T-5全120通りの純粋な市場ベースライン監査。
 * モデル候補を経由せず、odds_timeseries_snapshotsから直接評価する。
 * 読み取り専用。本番判定・DB・app_settingsは変更しない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const FROM = process.env.BOAT_PON_FROM ?? "2026-06-01";
const TO = process.env.BOAT_PON_TO ?? todayJst();
const BOUNDARY = process.env.BOAT_PON_BOUNDARY ?? "2026-07-01";
const OUT_MD = "reports/t5-market-baseline.md";
const OUT_JSON = "reports/t5-market-baseline.json";
if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);

type OddsRow = { id:number; race_id:string; selection:string; odds:number };
type ResultRow = { race_id:string; date:string; venue:string; race_no:number; trifecta:string|null; payout_yen:number|null; returned:number };
type RaceEval = ResultRow & { overround:number; favorite:string; favoriteOdds:number; favoriteProbability:number; hit:boolean; logLoss:number; brier:number };

const db = new DatabaseSync(DB_PATH,{readOnly:true});
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
const fromId=FROM.replaceAll("-",""); const toExclusive=addDays(TO,1).replaceAll("-","");
const odds=db.prepare(`
  WITH complete_capture AS (
    SELECT race_id, captured_at, MAX(id) AS max_id
    FROM odds_timeseries_snapshots
    WHERE race_id>=? AND race_id<? AND checkpoint_label='T-5'
    GROUP BY race_id, captured_at
    HAVING COUNT(DISTINCT selection)=120
  ), latest_capture AS (
    SELECT race_id, MAX(max_id) AS max_id
    FROM complete_capture
    GROUP BY race_id
  ), chosen AS (
    SELECT c.race_id, c.captured_at
    FROM complete_capture c
    JOIN latest_capture l ON l.race_id=c.race_id AND l.max_id=c.max_id
  )
  SELECT id,race_id,selection,odds
  FROM odds_timeseries_snapshots
  WHERE id IN (
    SELECT MAX(o.id)
    FROM odds_timeseries_snapshots o
    JOIN chosen c ON c.race_id=o.race_id AND c.captured_at=o.captured_at
    GROUP BY o.race_id,o.selection
  )
`).all(fromId,toExclusive) as OddsRow[];
const results=db.prepare(`SELECT race_id,date,venue,race_no,trifecta,payout_yen,returned FROM race_results WHERE date>=? AND date<=?`).all(FROM,TO) as ResultRow[];
const resultByRace=new Map(results.map(r=>[r.race_id,r]));
const byRace=new Map<string,OddsRow[]>(); for(const row of odds) byRace.set(row.race_id,[...(byRace.get(row.race_id)??[]),row]);

let rejectedIncomplete=0,rejectedInvalid=0,unsettled=0; const evaluated:RaceEval[]=[];
for(const [raceId,market] of byRace){
  const unique=new Map(market.map(r=>[r.selection,r]));
  if(unique.size!==120){rejectedIncomplete++;continue;}
  const values=[...unique.values()];
  if(values.some(r=>!validSelection(r.selection)||!Number.isFinite(r.odds)||r.odds<=1)){rejectedInvalid++;continue;}
  const result=resultByRace.get(raceId); if(!result?.trifecta||result.returned){unsettled++;continue;}
  const overround=values.reduce((s,r)=>s+1/r.odds,0); if(!(overround>0)){rejectedInvalid++;continue;}
  const probabilities=new Map(values.map(r=>[r.selection,(1/r.odds)/overround]));
  const favorite=values.reduce((a,b)=>b.odds<a.odds?b:a);
  const winnerProbability=probabilities.get(result.trifecta)??1e-12;
  const brier=values.reduce((s,r)=>{const p=probabilities.get(r.selection)??0; const y=r.selection===result.trifecta?1:0; return s+(p-y)**2;},0);
  evaluated.push({...result,overround,favorite:favorite.selection,favoriteOdds:favorite.odds,favoriteProbability:probabilities.get(favorite.selection)??0,hit:favorite.selection===result.trifecta,logLoss:-Math.log(Math.max(winnerProbability,1e-12)),brier});
}

function summary(rows:RaceEval[]){
  const hits=rows.filter(r=>r.hit); const payouts=hits.map(r=>r.payout_yen??0).sort((a,b)=>b-a); const total=payouts.reduce((a,b)=>a+b,0);
  return {n:rows.length,hits:hits.length,hitRate:rows.length?hits.length/rows.length:null,payoutRoi:rows.length?total/(rows.length*100):null,payoutRoiExTop2:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):null,avgOverround:avg(rows.map(r=>r.overround)),avgFavoriteProbability:avg(rows.map(r=>r.favoriteProbability)),logLoss:avg(rows.map(r=>r.logLoss)),brier:avg(rows.map(r=>r.brier))};
}
const discovery=evaluated.filter(r=>r.date<BOUNDARY),forward=evaluated.filter(r=>r.date>=BOUNDARY);
const monthly=[...new Set(evaluated.map(r=>r.date.slice(0,7)))].sort().map(month=>({month,...summary(evaluated.filter(r=>r.date.startsWith(month)))}));
const report={generatedAt:new Date().toISOString(),safety:{readOnly:true,dbWrites:false,productionChanged:false,modelIndependent:true},window:{from:FROM,to:TO,boundary:BOUNDARY},coverage:{snapshotRows:odds.length,racesWithT5:byRace.size,evaluated:evaluated.length,rejectedIncomplete,rejectedInvalid,unsettled},marketFavorite:{all:summary(evaluated),discovery:summary(discovery),forward:summary(forward),monthly},gate:{minimumSettled:1000,passed:evaluated.length>=1000,reasons:evaluated.length>=1000?[]:[`結果確定済み完全市場が${evaluated.length}/1000`]},caveats:["市場favoriteは利益戦略ではなく比較基準","current T-5 coverageは開催全体の一部","残差モデルは未実装。holdoutを探索へ戻さない"]};
const p=(v:number|null)=>v==null?"-":`${(v*100).toFixed(2)}%`; const n=(v:number|null)=>v==null?"-":v.toFixed(4);
const periodRows = [["全体",report.marketFavorite.all],["discovery",report.marketFavorite.discovery],["forward",report.marketFavorite.forward]] as const;
const lines=["# T-5 純市場ベースライン", "", `生成日時: ${report.generatedAt}`, "", "> モデル候補を経由せず、単一captured_atで揃ったT-5全120通りから直接計算。読み取り専用。", "", "## Coverage", "", `- T-5あり: ${byRace.size}レース / 完全市場・結果確定: ${evaluated.length}レース`, `- 不完全: ${rejectedIncomplete} / 不正値: ${rejectedInvalid} / 未確定・返還: ${unsettled}`, `- research gate: **${report.gate.passed?"PASS":"BLOCKED"}**（${report.gate.reasons.join(" / ")||"条件達成"}）`, "", "## 市場1番人気を1点選ぶベースライン", "", "| 期間 | n | 的中 | 的中率 | 実払戻ROI | 最大2的中除外ROI | 平均市場確率 | log loss | Brier |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|", ...periodRows.map(([label,s])=>`| ${label} | ${s.n} | ${s.hits} | ${p(s.hitRate)} | ${p(s.payoutRoi)} | ${p(s.payoutRoiExTop2)} | ${p(s.avgFavoriteProbability)} | ${n(s.logLoss)} | ${n(s.brier)} |`), "", "## 月別", "", "| 月 | n | 的中率 | ROI | 最大2件除外ROI |", "|---|---:|---:|---:|---:|", ...monthly.map(m=>`| ${m.month} | ${m.n} | ${p(m.hitRate)} | ${p(m.payoutRoi)} | ${p(m.payoutRoiExTop2)} |`), "", "## 判定", "", "- これを今後の最低比較基準に固定する。モデル候補を経由した旧market-only集計は基準に使わない。", "- 残差モデルは同じ完全市場race_id集合でのみ比較する。", "- 1,000 settled到達までは予測改善を確定しない。"];
mkdirSync("reports",{recursive:true});writeFileSync(OUT_JSON,`${JSON.stringify(report,null,2)}\n`);writeFileSync(OUT_MD,`${lines.join("\n")}\n`);db.close();console.log(`[t5-market-baseline] wrote ${OUT_MD} / ${OUT_JSON}`);

function avg(v:number[]){return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;}
function validSelection(value:string){const p=value.split("-").map(Number);return p.length===3&&new Set(p).size===3&&p.every(x=>Number.isInteger(x)&&x>=1&&x<=6);}
function addDays(date:string,delta:number){const d=new Date(`${date}T00:00:00+09:00`);d.setUTCDate(d.getUTCDate()+delta);return d.toLocaleDateString("en-CA",{timeZone:"Asia/Tokyo"});}
function todayJst(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo"}).format(new Date());}
