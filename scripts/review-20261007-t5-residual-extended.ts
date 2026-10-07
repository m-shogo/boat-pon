/**
 * Read-only re-run of the pre-registered T-5 residual experiment (reports/t5-residual-forward.md, 2026-07-21)
 * with the forward window extended to all data collected since. Writes nothing to the repo or DB.
 * Same data-selection SQL and result filters as scripts/analyze-t5-residual-forward.ts.
 */
import { DatabaseSync } from "node:sqlite";
import {
  evaluateProbabilityModel, fitSelectionResidual, fitTemperature, marketModel,
  selectionResidualModel, temperatureModel, type ResidualRace, type ProbabilityModel,
} from "../src/domain/t5ResidualModel";
import { n2CanonicalT5CompleteCaptureSelectionHavingSql } from "../src/research-replay/n2T5CompleteCaptureSelectionSql";
import { n2CanonicalT5ForwardCaptureTimingHavingSql } from "../src/research-replay/n2T5ForwardCaptureTimingSql";
import { isCanonicalT5TrifectaResult } from "../src/research-replay/t5MarketBaselineResult";
import { validateT5MarketBaselineResultIdentityRows } from "../src/research-replay/t5MarketBaselineResultIdentity";
import { isCanonicalT5CompleteMarketSelections } from "../src/research-replay/t5ResidualForwardMarket";

const DB_URI = process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite";
const FROM = "2026-06-01", TO = process.env.TO ?? "2026-10-07", BOUNDARY = "2026-07-01";

const db = new DatabaseSync(DB_URI, { readOnly: true });
db.exec("PRAGMA query_only=ON;");
type O = { id: number; race_id: string; selection: string; odds: number };
type R = { race_id: string; date: string; venue: string; race_no: number; trifecta: string | null; payout_yen: number | null; returned: number };
const fromId = FROM.replaceAll("-", ""); const toId = addDays(TO, 1).replaceAll("-", "");
const sel = n2CanonicalT5CompleteCaptureSelectionHavingSql("selection");
const timing = n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close");
const t0 = Date.now();
const odds = db.prepare(`WITH complete_capture AS(SELECT race_id,captured_at,MAX(id)max_id FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<? AND checkpoint_label='T-5' GROUP BY race_id,captured_at HAVING ${sel} AND ${timing}),latest_capture AS(SELECT race_id,MAX(max_id)max_id FROM complete_capture GROUP BY race_id),chosen AS(SELECT c.race_id,c.captured_at FROM complete_capture c JOIN latest_capture l ON l.race_id=c.race_id AND l.max_id=c.max_id) SELECT id,race_id,selection,odds FROM odds_timeseries_snapshots WHERE id IN(SELECT MAX(o.id) FROM odds_timeseries_snapshots o JOIN chosen c ON c.race_id=o.race_id AND c.captured_at=o.captured_at WHERE o.checkpoint_label='T-5' GROUP BY o.race_id,o.selection)`).all(fromId, toId) as O[];
const results = validateT5MarketBaselineResultIdentityRows(db.prepare(`SELECT race_id,date,venue,race_no,trifecta,payout_yen,returned FROM race_results WHERE date>=? AND date<=?`).all(FROM, TO) as R[]);
const nPrograms = (db.prepare(`SELECT COUNT(*) n FROM official_programs WHERE date>=? AND date<=?`).get(FROM, TO) as { n: number }).n;
db.close();
console.error(`loaded odds rows=${odds.length} results=${results.length} in ${(Date.now() - t0) / 1000}s`);

const byRace = new Map<string, O[]>(); for (const o of odds) { const a = byRace.get(o.race_id); if (a) a.push(o); else byRace.set(o.race_id, [o]); }
const resultMap = new Map(results.map((r) => [r.race_id, r]));
const races: ResidualRace[] = []; let dropped = { noResult: 0, returned: 0, badOdds: 0, winnerMissing: 0 };
for (const [raceId, source] of byRace) {
  const unique = new Map(source.map((x) => [x.selection, x])); const result = resultMap.get(raceId);
  if (!isCanonicalT5CompleteMarketSelections(unique.keys())) continue;
  if (!result?.trifecta || !isCanonicalT5TrifectaResult(result.trifecta)) { dropped.noResult++; continue; }
  if (result.returned || result.payout_yen == null) { dropped.returned++; continue; }
  const rows = [...unique.values()];
  if (rows.some((x) => x.odds <= 1 || !Number.isFinite(x.odds))) { dropped.badOdds++; continue; }
  const overround = rows.reduce((s, x) => s + 1 / x.odds, 0);
  if (!(overround > 0) || !unique.has(result.trifecta)) { dropped.winnerMissing++; continue; }
  races.push({ raceId, date: result.date, venue: result.venue, raceNo: result.race_no, winner: result.trifecta, payoutYen: result.payout_yen,
    outcomes: rows.map((x) => ({ selection: x.selection, odds: x.odds, marketProbability: (1 / x.odds) / overround })) });
}
races.sort((a, b) => a.date.localeCompare(b.date) || a.raceId.localeCompare(b.raceId));
const train = races.filter((r) => r.date < BOUNDARY), forward = races.filter((r) => r.date >= BOUNDARY);

const out: Record<string, unknown> = { window: { FROM, TO, BOUNDARY }, nPrograms, completeRaces: races.length, train: train.length, forward: forward.length, dropped };

// 1) Pre-registered: fit on June only, frozen.
const fT = fitTemperature(train); const fR = fitSelectionResidual(train);
const models: Record<string, ProbabilityModel> = {
  market: marketModel, temperature: temperatureModel(fT.temperature), residual: selectionResidualModel(fR.factors, fR.temperature),
};
out.fit = { temperature: fT.temperature, residualT: fR.temperature, prior: fR.priorStrength };
out.preregistered = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { train: evaluateProbabilityModel(train, m), forward: evaluateProbabilityModel(forward, m) }]));

// 2) Monthly breakdown of forward (frozen June fit).
const months = [...new Set(forward.map((r) => r.date.slice(0, 7)))].sort();
out.monthly = months.map((m) => { const rs = forward.filter((r) => r.date.startsWith(m)); const mk = evaluateProbabilityModel(rs, marketModel); const rz = evaluateProbabilityModel(rs, models.residual);
  return { month: m, n: rs.length, marketLogLoss: mk.logLoss, residualLogLoss: rz.logLoss, dLogLoss: (rz.logLoss ?? 0) - (mk.logLoss ?? 0), marketTop1Roi: mk.payoutRoi, residualTop1Roi: rz.payoutRoi }; });

// 3) Expanding-window walk-forward: refit each month on all prior months.
const allMonths = [...new Set(races.map((r) => r.date.slice(0, 7)))].sort();
const wf: ResidualRace[] = []; const wfModelByRace = new Map<string, ProbabilityModel>();
for (const m of allMonths.slice(1)) {
  const past = races.filter((r) => r.date.slice(0, 7) < m); const cur = races.filter((r) => r.date.startsWith(m));
  const fit = fitSelectionResidual(past); const model = selectionResidualModel(fit.factors, fit.temperature);
  for (const r of cur) { wf.push(r); wfModelByRace.set(r.raceId, model); }
}
const wfModel: ProbabilityModel = (r) => wfModelByRace.get(r.raceId)!(r);
out.walkForward = { n: wf.length, market: evaluateProbabilityModel(wf, marketModel), residual: evaluateProbabilityModel(wf, wfModel) };

// 4) EV-threshold betting on forward: bet every ticket with p*oddsT5 >= th, settle at official payout.
function evBets(rs: ResidualRace[], model: ProbabilityModel, th: number, maxOdds = Infinity) {
  let bets = 0, ret = 0; const hits: number[] = []; const byMonth = new Map<string, { b: number; r: number }>();
  for (const r of rs) { const p = model(r); for (const o of r.outcomes) { const pr = p.get(o.selection) ?? 0; if (pr * o.odds >= th && o.odds <= maxOdds) {
    bets++; const win = o.selection === r.winner ? r.payoutYen : 0; ret += win; if (win) hits.push(win);
    const k = r.date.slice(0, 7); const mm = byMonth.get(k) ?? { b: 0, r: 0 }; mm.b++; mm.r += win; byMonth.set(k, mm); } } }
  hits.sort((a, b) => b - a); const ex2 = ret - (hits[0] ?? 0) - (hits[1] ?? 0);
  return { th, maxOdds: Number.isFinite(maxOdds) ? maxOdds : null, bets, hits: hits.length, roi: bets ? ret / (bets * 100) : null, roiExTop2: bets > 2 ? ex2 / ((bets - Math.min(2, hits.length)) * 100) : null,
    monthly: Object.fromEntries([...byMonth].map(([k, v]) => [k, { bets: v.b, roi: +(v.r / (v.b * 100)).toFixed(3) }])) };
}
out.evBetting = {
  residualFrozen: [1.0, 1.1, 1.2, 1.5].map((th) => evBets(forward, models.residual, th)),
  residualFrozenOdds100: [1.0, 1.2].map((th) => evBets(forward, models.residual, th, 100)),
  residualWalkForward: [1.0, 1.2].map((th) => evBets(wf, wfModel, th)),
  marketAll: evBets(forward, marketModel, 0), // every ticket: pure takeout benchmark
};

// 5) T-5 odds vs final official payout for the winning ticket (late-money drift).
const ratios = forward.map((r) => { const o = r.outcomes.find((x) => x.selection === r.winner)!; return r.payoutYen / (o.odds * 100); }).sort((a, b) => a - b);
const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
out.t5ToFinalDrift = { n: ratios.length, meanFinalOverT5: mean, median: ratios[Math.floor(ratios.length / 2)], p10: ratios[Math.floor(ratios.length * 0.1)], p90: ratios[Math.floor(ratios.length * 0.9)] };

// 6) Favourite-longshot: realised hit rate vs market prob by odds band (forward).
const bands = [[1, 10], [10, 20], [20, 50], [50, 100], [100, 300], [300, 1e9]];
out.flb = bands.map(([lo, hi]) => { let pSum = 0, hits = 0, n = 0, ret = 0; for (const r of forward) for (const o of r.outcomes) if (o.odds >= lo && o.odds < hi) { n++; pSum += o.marketProbability; if (o.selection === r.winner) { hits++; ret += r.payoutYen; } }
  return { band: `${lo}-${hi}`, tickets: n, expectedHits: +pSum.toFixed(1), actualHits: hits, ratio: +(hits / pSum).toFixed(3), roiFlatAll: +(ret / (n * 100)).toFixed(3) }; });

console.log(JSON.stringify(out, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v), 1));

function addDays(date: string, delta: number) { const d = new Date(`${date}T00:00:00+09:00`); d.setUTCDate(d.getUTCDate() + delta); return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }); }
