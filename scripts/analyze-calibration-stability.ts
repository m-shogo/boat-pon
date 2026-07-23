/**
 * canonical calibrationの安定性監査。
 * 月別、最大払戻1件除外、会場LOOを同じBUY母集団で確認する。
 * 読み取り専用。本番判定やDBは変更しない。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/calibration-stability.md";
const OUT_JSON = "reports/calibration-stability.json";
const MODEL = "boatpon-v3-alpha15";
const BOUNDARY = "2025-01-01";
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");

type Row = { id:number; date:string; venue:string; selection:string; estimated_hit_rate:number; current_odds:number|null; result:string|null; payout_yen:number|null };
type Summary = { n:number; hits:number; hitRate:number|null; estimated:number|null; factor:number|null; roi:number|null; roiExMax:number|null };

if (!existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
const rows = db.prepare(`SELECT id,date,venue,selection,estimated_hit_rate,current_odds,result,payout_yen
  FROM decision_history WHERE decision='BUY' AND run_kind='historical-backfill' AND model_version=? AND bet_type='3連単'
  AND result IS NOT NULL AND result!='' AND returned=0 AND current_odds IS NOT NULL ORDER BY date,id`).all(MODEL) as Row[];

function summary(input: Row[], excludeMax = false): Summary {
  const usable = excludeMax ? removeMaxHit(input) : input;
  const hits = usable.filter(r => r.result === r.selection);
  const actual = usable.length ? hits.length / usable.length : null;
  const estimated = usable.length ? mean(usable.map(r => r.estimated_hit_rate)) : null;
  const payouts = hits.map(r => r.payout_yen ?? 0);
  const total = payouts.reduce((a,b) => a+b, 0);
  const max = payouts.length ? Math.max(...payouts) : 0;
  const roi = usable.length ? total / (usable.length * 100) : null;
  const roiExMax = usable.length > 1 && max > 0 ? (total - max) / ((usable.length - 1) * 100) : roi;
  return { n:usable.length, hits:hits.length, hitRate:actual, estimated, factor:actual != null && estimated ? actual / estimated : null, roi, roiExMax };
}
function removeMaxHit(input: Row[]) {
  const hitIndexes = input.map((r,i) => ({ r,i })).filter(x => x.r.result === x.r.selection);
  if (!hitIndexes.length) return input;
  const max = hitIndexes.reduce((a,b) => (b.r.payout_yen ?? 0) > (a.r.payout_yen ?? 0) ? b : a);
  return input.filter((_,i) => i !== max.i);
}
function mean(v:number[]) { return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function pct(v:number|null) { return v == null ? "-" : `${(v*100).toFixed(2)}%`; }
function f(v:number|null) { return v == null ? "-" : v.toFixed(3); }

const train = rows.filter(r => r.date < BOUNDARY);
const forward = rows.filter(r => r.date >= BOUNDARY);
const trainAll = summary(train);
const trainExMax = summary(train, true);
const forwardAll = summary(forward);
const forwardExMax = summary(forward, true);

const months = [...new Set(forward.map(r => r.date.slice(0,7)))].sort().map(month => {
  const s = summary(forward.filter(r => r.date.startsWith(month)));
  return { month, ...s };
});

const venues = [...new Set(forward.map(r => r.venue))].sort().map(venue => {
  const trainLoo = summary(train.filter(r => r.venue !== venue));
  const current = forward.filter(r => r.venue === venue);
  const currentSummary = summary(current);
  const factor = trainLoo.factor ?? 1;
  const selected = current.filter(r => r.current_odds != null && r.current_odds <= 80 && r.estimated_hit_rate * factor * r.current_odds >= 1.25);
  const selectedSummary = summary(selected);
  return { venue, trainLooN:trainLoo.n, trainLooFactor:factor, forwardN:currentSummary.n, forwardFactor:currentSummary.factor, forwardRoi:currentSummary.roi, replayN:selectedSummary.n, replayRoi:selectedSummary.roi };
});

const report = { generatedAt:new Date().toISOString(), safety:{readOnly:true,dbWrites:false,productionChanged:false}, contract:{model:MODEL,betType:"3連単",boundary:BOUNDARY,payoutBasis:"payout_yen"}, train:{all:trainAll,exMax:trainExMax}, forward:{all:forwardAll,exMax:forwardExMax}, months, venues, verdict:{trainFactor:trainAll.factor,trainExMaxFactor:trainExMax.factor,stableMonths:months.filter(m=>m.n>=30&&m.factor!=null&&m.factor>0).length,venueReplayWithSamples:venues.filter(v=>v.replayN>=30).length}};

const lines = ["# 較正安定性監査", "", `生成日時: ${report.generatedAt}`, "", "> 読み取り専用。再較正係数を本番へ自動適用していない。", "", "## 全体・最大払戻除外", "", "| 期間 | n | 的中率 | 平均推定 | 較正係数 | ROI | 最大払戻1件除外ROI |", "|---|---:|---:|---:|---:|---:|---:|", `| train | ${trainAll.n} | ${pct(trainAll.hitRate)} | ${pct(trainAll.estimated)} | ${f(trainAll.factor)} | ${pct(trainAll.roi)} | ${pct(trainExMax.roiExMax)} |`, `| forward | ${forwardAll.n} | ${pct(forwardAll.hitRate)} | ${pct(forwardAll.estimated)} | ${f(forwardAll.factor)} | ${pct(forwardAll.roi)} | ${pct(forwardExMax.roiExMax)} |`, "", "## forward月別", "", "| 月 | n | 的中率 | 平均推定 | 較正係数 | ROI |", "|---|---:|---:|---:|---:|---:|", ...months.map(m=>`| ${m.month} | ${m.n} | ${pct(m.hitRate)} | ${pct(m.estimated)} | ${f(m.factor)} | ${pct(m.roi)} |`), "", "## 会場LOO（会場を学習から外して係数算出）", "", "| 会場 | train LOO n | LOO係数 | forward n | forward係数 | forward ROI | 再生n | 再生ROI |", "|---|---:|---:|---:|---:|---:|---:|", ...venues.map(v=>`| ${v.venue} | ${v.trainLooN} | ${f(v.trainLooFactor)} | ${v.forwardN} | ${f(v.forwardFactor)} | ${pct(v.forwardRoi)} | ${v.replayN} | ${pct(v.replayRoi)} |`), "", "## 判定", "", `- train全体の係数: **${f(trainAll.factor)}** / 最大払戻1件除外: **${f(trainExMax.factor)}**`, `- forwardでn>=30の月: ${months.filter(m=>m.n>=30).length}件。係数が月をまたいで安定するかを確認する。`, `- 会場LOO再生でn>=30の候補が残る会場: ${venues.filter(v=>v.replayN>=30).length}件。`, "- 月・会場で係数やROIが揺れる場合、単一係数の本番適用は行わず、BUYを増やさない。", "- 本監査は既存BUYの再生であり、再較正後に新規候補を生成したforward検証ではない。"];

mkdirSync("reports",{recursive:true}); writeFileSync(OUT_JSON,`${JSON.stringify(report,null,2)}\n`); writeFileSync(OUT_MD,`${lines.join("\n")}\n`); db.close(); console.log(`[calibration-stability] wrote ${OUT_MD} / ${OUT_JSON}`);
