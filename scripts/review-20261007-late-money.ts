/**
 * Late-money momentum test (pre-registered 2026-10-07 before running; see docs/reviews/2026-10-07-strict-review.md).
 * - Signal: m = ln(p_T5) - ln(p_prev), p = overround-normalised market prob; prev = complete T-10 capture, else T-20.
 * - Model: p ∝ p_T5^(1/T) * exp(beta*m); grid chosen by TRAIN logloss only.
 * - Train 2026-07-01..08-31 / Forward 2026-09-01..10-07.
 * - PASS only if forward n>=1000, forward logloss < market, EV(p*odds>=1, odds<=100) official-payout ROI>=1 and exTop2>=1.
 * Read-only. Prints JSON to stdout; writes nothing to the repo or DB.
 */
import { DatabaseSync } from "node:sqlite";
import { n2CanonicalT5CompleteCaptureSelectionHavingSql } from "../src/research-replay/n2T5CompleteCaptureSelectionSql";
import { n2CanonicalT5ForwardCaptureTimingHavingSql } from "../src/research-replay/n2T5ForwardCaptureTimingSql";
import { isCanonicalT5TrifectaResult } from "../src/research-replay/t5MarketBaselineResult";
import { validateT5MarketBaselineResultIdentityRows } from "../src/research-replay/t5MarketBaselineResultIdentity";
import { isCanonicalT5CompleteMarketSelections } from "../src/research-replay/t5ResidualForwardMarket";

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON;");
const FROM = "2026-07-01", TO = "2026-10-07", BOUNDARY = "2026-09-01";
const fromId = "20260701", toId = "20261008";
const sel = n2CanonicalT5CompleteCaptureSelectionHavingSql("selection");
const timing = n2CanonicalT5ForwardCaptureTimingHavingSql("minutes_before_close");
type O = { race_id: string; selection: string; odds: number };
const t5 = db.prepare(`WITH cc AS(SELECT race_id,captured_at,MAX(id)max_id FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<? AND checkpoint_label='T-5' GROUP BY race_id,captured_at HAVING ${sel} AND ${timing}),lc AS(SELECT race_id,MAX(max_id)max_id FROM cc GROUP BY race_id),ch AS(SELECT c.race_id,c.captured_at FROM cc c JOIN lc l ON l.race_id=c.race_id AND l.max_id=c.max_id) SELECT o.race_id,o.selection,o.odds FROM odds_timeseries_snapshots o JOIN ch c ON c.race_id=o.race_id AND c.captured_at=o.captured_at WHERE o.checkpoint_label='T-5'`).all(fromId, toId) as O[];
// earlier complete capture per label (latest complete capture for that label)
function earlier(label: string) {
  return db.prepare(`WITH cc AS(SELECT race_id,captured_at,MAX(id)max_id FROM odds_timeseries_snapshots WHERE race_id>=? AND race_id<? AND checkpoint_label=? GROUP BY race_id,captured_at HAVING ${sel}),lc AS(SELECT race_id,MAX(max_id)max_id FROM cc GROUP BY race_id),ch AS(SELECT c.race_id,c.captured_at FROM cc c JOIN lc l ON l.race_id=c.race_id AND l.max_id=c.max_id) SELECT o.race_id,o.selection,o.odds FROM odds_timeseries_snapshots o JOIN ch c ON c.race_id=o.race_id AND c.captured_at=o.captured_at WHERE o.checkpoint_label=?`).all(fromId, toId, label, label) as O[];
}
const t10 = earlier("T-10"), t20 = earlier("T-20");
type R = { race_id: string; date: string; venue: string; race_no: number; trifecta: string | null; payout_yen: number | null; returned: number };
const results = validateT5MarketBaselineResultIdentityRows(db.prepare(`SELECT race_id,date,venue,race_no,trifecta,payout_yen,returned FROM race_results WHERE date>=? AND date<=?`).all(FROM, TO) as R[]);
db.close();

const group = (rows: O[]) => { const m = new Map<string, Map<string, number>>(); for (const r of rows) { let x = m.get(r.race_id); if (!x) m.set(r.race_id, (x = new Map())); x.set(r.selection, r.odds); } return m; };
const g5 = group(t5), g10 = group(t10), g20 = group(t20); const res = new Map(results.map((r) => [r.race_id, r]));
const norm = (o: Map<string, number>) => { let s = 0; for (const v of o.values()) s += 1 / v; return new Map([...o].map(([k, v]) => [k, 1 / v / s])); };
type T = { sel: string; odds: number; p: number; m: number };
type Race = { id: string; date: string; winner: string; payout: number; prev: string; t: T[] };
const races: Race[] = []; const prevUsed = { "T-10": 0, "T-20": 0 };
for (const [id, o5] of g5) {
  if (!isCanonicalT5CompleteMarketSelections(o5.keys())) continue;
  const r = res.get(id); if (!r?.trifecta || !isCanonicalT5TrifectaResult(r.trifecta) || r.returned || r.payout_yen == null || !o5.has(r.trifecta)) continue;
  if ([...o5.values()].some((v) => !(v > 1) || !Number.isFinite(v))) continue;
  const prevLabel = g10.has(id) ? "T-10" : g20.has(id) ? "T-20" : null; if (!prevLabel) continue;
  const op = (prevLabel === "T-10" ? g10 : g20).get(id)!; if (!isCanonicalT5CompleteMarketSelections(op.keys()) || [...op.values()].some((v) => !(v > 1))) continue;
  prevUsed[prevLabel]++;
  const p5 = norm(o5), pp = norm(op);
  races.push({ id, date: r.date, winner: r.trifecta, payout: r.payout_yen, prev: prevLabel, t: [...o5].map(([s, odds]) => ({ sel: s, odds, p: p5.get(s)!, m: Math.log(p5.get(s)!) - Math.log(pp.get(s)!) })) });
}
const train = races.filter((r) => r.date < BOUNDARY), fwd = races.filter((r) => r.date >= BOUNDARY);
const probs = (r: Race, T: number, b: number) => { const w = r.t.map((x) => Math.pow(x.p, 1 / T) * Math.exp(b * x.m)); const s = w.reduce((a, c) => a + c, 0); return w.map((v) => v / s); };
const ll = (rs: Race[], T: number, b: number) => rs.reduce((acc, r) => { const p = probs(r, T, b); const i = r.t.findIndex((x) => x.sel === r.winner); return acc - Math.log(Math.max(p[i], 1e-12)); }, 0) / rs.length;
const grid = [0.9, 1].flatMap((T) => [-1, -0.5, 0, 0.25, 0.5, 1, 1.5, 2].map((b) => ({ T, b, trainLL: ll(train, T, b) }))).sort((a, b) => a.trainLL - b.trainLL);
const best = grid[0];
function ev(rs: Race[], T: number, b: number, th = 1, maxOdds = 100) {
  let bets = 0, ret = 0; const hits: number[] = [];
  for (const r of rs) { const p = probs(r, T, b); r.t.forEach((x, i) => { if (p[i] * x.odds >= th && x.odds <= maxOdds) { bets++; if (x.sel === r.winner) { ret += r.payout; hits.push(r.payout); } } }); }
  hits.sort((a, b) => b - a); const ex2 = ret - (hits[0] ?? 0) - (hits[1] ?? 0);
  return { bets, hits: hits.length, roi: bets ? ret / (bets * 100) : null, roiExTop2: bets > 2 ? ex2 / ((bets - Math.min(2, hits.length)) * 100) : null };
}
// descriptive: realised/expected wins by momentum decile on forward (market p only)
const all = fwd.flatMap((r) => r.t.map((x) => ({ ...x, win: x.sel === r.winner ? 1 : 0, payout: x.sel === r.winner ? r.payout : 0 })));
all.sort((a, b) => a.m - b.m); const dec = Array.from({ length: 10 }, (_, k) => { const s = all.slice(Math.floor((k * all.length) / 10), Math.floor(((k + 1) * all.length) / 10));
  const e = s.reduce((a, c) => a + c.p, 0), w = s.reduce((a, c) => a + c.win, 0), pay = s.reduce((a, c) => a + c.payout, 0);
  return { decile: k + 1, mMean: +(s.reduce((a, c) => a + c.m, 0) / s.length).toFixed(3), tickets: s.length, expWins: +e.toFixed(1), wins: w, ratio: +(w / e).toFixed(3), flatRoi: +(pay / (s.length * 100)).toFixed(3) }; });
const fwdMarketLL = ll(fwd, 1, 0), fwdModelLL = ll(fwd, best.T, best.b);
const evModel = ev(fwd, best.T, best.b);
const verdict = fwd.length >= 1000 && fwdModelLL < fwdMarketLL && (evModel.roi ?? 0) >= 1 && (evModel.roiExTop2 ?? 0) >= 1 ? "PASS" : "REJECT";
console.log(JSON.stringify({ n: { all: races.length, train: train.length, forward: fwd.length, prevUsed }, chosen: best, top3grid: grid.slice(0, 3),
  forward: { marketLL: fwdMarketLL, modelLL: fwdModelLL, evModel }, momentumDecilesForward: dec, verdict }, null, 1));
