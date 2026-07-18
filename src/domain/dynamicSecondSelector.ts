export type RivalBoat={course:number;nationalWinRate?:number;localWinRate?:number;motorTop2Rate?:number};
export type RivalContext={boats:RivalBoat[];marketProbability:Map<number,number>;exhibitionTime:Map<number,number>};
export type RivalStrategy="national_best"|"local_best"|"motor_best"|"exhibition_best"|"consensus"|"ability_underbought"|"market_favorite"|"national_worst_placebo";

function rivals(c:RivalContext){return c.boats.filter(b=>b.course>=2&&b.course<=6);}function best(rows:RivalBoat[],value:(b:RivalBoat)=>number|undefined,descending=true){const valid=rows.map(b=>({b,v:value(b)})).filter((x):x is{b:RivalBoat;v:number}=>x.v!=null&&Number.isFinite(x.v));if(!valid.length)return null;valid.sort((a,b)=>(descending?b.v-a.v:a.v-b.v)||a.b.course-b.b.course);return valid[0]!.b.course;}
function rank(rows:RivalBoat[],value:(b:RivalBoat)=>number|undefined,descending=true){const valid=rows.map(b=>({b,v:value(b)})).filter((x):x is{b:RivalBoat;v:number}=>x.v!=null&&Number.isFinite(x.v)).sort((a,b)=>(descending?b.v-a.v:a.v-b.v)||a.b.course-b.b.course);return new Map(valid.map((x,i)=>[x.b.course,i+1]));}

/** 1着1号艇を固定し、公開済みレース前情報だけで2着候補を1艇選ぶ。 */
export function selectDynamicSecond(context:RivalContext,strategy:RivalStrategy):number|null{const rows=rivals(context);if(strategy==="national_best")return best(rows,b=>b.nationalWinRate);if(strategy==="local_best")return best(rows,b=>b.localWinRate);if(strategy==="motor_best")return best(rows,b=>b.motorTop2Rate);if(strategy==="exhibition_best")return best(rows,b=>context.exhibitionTime.get(b.course),false);if(strategy==="market_favorite")return best(rows,b=>context.marketProbability.get(b.course));if(strategy==="national_worst_placebo")return best(rows,b=>b.nationalWinRate,false);
  const ranks=[rank(rows,b=>b.nationalWinRate),rank(rows,b=>b.localWinRate),rank(rows,b=>b.motorTop2Rate),rank(rows,b=>context.exhibitionTime.get(b.course),false)];
  if(strategy==="consensus")return best(rows,b=>{const values=ranks.map(r=>r.get(b.course)).filter((v):v is number=>v!=null);return values.length>=3?-values.reduce((a,v)=>a+v,0)/values.length:undefined;});
  const ability=ranks[0],market=rank(rows,b=>context.marketProbability.get(b.course));return best(rows,b=>{const a=ability.get(b.course),m=market.get(b.course);return a!=null&&m!=null?m-a:undefined;});
}
