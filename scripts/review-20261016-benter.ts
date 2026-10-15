/**
 * ベンター式の検証（事前登録: docs/reviews/2026-10-16-benter-test.md。読み取りだけ・stdout のみ）。
 *
 * 1段目: 番組表と展示から、6艇の中で誰が1着かの多項ロジット（基礎モデル）を 2023-01〜2025-10 で学習する。
 * 2段目: c_i ∝ exp(α·log f_i + β·log π_i)。π は締切5分前の3連単の市場補正の確率を1着ごとに足したもの。
 *        α・β は 2026-07〜08 で決め、2026-09-01〜10-15（未使用）で「市場だけ」と比べる（ΔR²）。
 *
 * 実行（夜に。本番の作業コピーで）:
 *   BOAT_PON_DB_URI='file:data/boat.sqlite?mode=ro&immutable=1' npx tsx scripts/review-20261016-benter.ts
 */
import { DatabaseSync } from "node:sqlite";
import { calibratedMarketProbabilities } from "../src/domain/accuracyScorecard";
import { loadChampionCalibration, loadCompleteCaptures } from "./lib/marketCaptures";

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "file:data/boat.sqlite?mode=ro", { readOnly: true });
const PERIODS = {
  fundamental: ["2023-01-01", "2025-10-31"],
  combine: ["2026-07-01", "2026-08-31"],
  evaluate: ["2026-09-01", "2026-10-15"],
} as const;
const t0 = Date.now();
const log = (message: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${message}`);

// ─── 1段目の材料（番組表の値はレースの中で平均を引く。枠と級別は別々の効き目） ───
type ProgramBoat = { course: number; className?: string; nationalWinRate?: number; nationalTop2Rate?: number; localWinRate?: number; localTop2Rate?: number; motorTop2Rate?: number; boatTop2Rate?: number };
const FEATURES = ["枠2", "枠3", "枠4", "枠5", "枠6", "A1", "A2", "B1", "全国勝率", "全国2連率", "当地勝率", "当地2連率", "当地なし", "モーター2連率", "ボート2連率", "展示タイム"] as const;
const K = FEATURES.length;

/** 6艇の特徴（枠の順）。番組が6艇でなければ null。展示タイムは6艇そろわなければ全艇 0。 */
function raceFeatures(boats: ProgramBoat[], exhibition: Map<number, number>): number[][] | null {
  if (boats.length !== 6 || new Set(boats.map((b) => b.course)).size !== 6) return null;
  const sorted = [...boats].sort((a, b) => a.course - b.course);
  const raw = sorted.map((b) => {
    const noLocal = !(b.localWinRate! > 0);
    return [
      ...[2, 3, 4, 5, 6].map((lane) => (b.course === lane ? 1 : 0)),
      b.className === "A1" ? 1 : 0, b.className === "A2" ? 1 : 0, b.className === "B1" ? 1 : 0,
      b.nationalWinRate ?? 0, (b.nationalTop2Rate ?? 0) / 10,
      noLocal ? NaN : b.localWinRate!, noLocal ? NaN : (b.localTop2Rate ?? 0) / 10, noLocal ? 1 : 0,
      (b.motorTop2Rate ?? 0) / 10, (b.boatTop2Rate ?? 0) / 10,
      exhibition.size === 6 ? exhibition.get(b.course) ?? NaN : NaN,
    ];
  });
  // 当地の成績が無い艇・展示が欠けたレースは、その値をレースの平均（=0）にする
  for (let k = 0; k < K; k += 1) {
    const values = raw.map((row) => row[k]).filter((v) => Number.isFinite(v));
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    for (const row of raw) row[k] = Number.isFinite(row[k]) ? row[k] - mean : 0;
  }
  // 展示タイムは速い（小さい）ほど良いので符号を反転する（係数の向きを読みやすくするだけ）
  for (const row of raw) row[K - 1] = -row[K - 1] * 10;
  return raw;
}

type Race = { raceId: string; date: string; x: number[][]; winner: number /* 0..5 */ };

function loadPrograms(from: string, to: string): Map<string, { date: string; closeAt: string; boats: ProgramBoat[] }> {
  const map = new Map<string, { date: string; closeAt: string; boats: ProgramBoat[] }>();
  for (const r of db.prepare(`SELECT race_id, date, close_at, raw_json FROM official_programs WHERE date >= ? AND date <= ?`).iterate(from, to) as Iterable<{ race_id: string; date: string; close_at: string; raw_json: string }>) {
    try { map.set(r.race_id, { date: r.date, closeAt: r.close_at, boats: (JSON.parse(r.raw_json) as { boats?: ProgramBoat[] }).boats ?? [] }); } catch { /* 壊れた行は使わない */ }
  }
  return map;
}

// ─── 学習用（2023-01〜2025-10）: 着順と展示は K ファイル（race_entries） ───
function loadTrainingRaces(): Race[] {
  const [from, to] = PERIODS.fundamental;
  const programs = loadPrograms(from, to);
  log(`番組（学習）${programs.size} レース`);
  const entries = new Map<string, Array<{ boat: number; finish: number | null; ex: number | null }>>();
  for (const r of db.prepare(`SELECT race_id, boat, finish_pos, exhibition_time FROM race_entries WHERE date >= ? AND date <= ?`).iterate(from, to) as Iterable<{ race_id: string; boat: number; finish_pos: number | null; exhibition_time: number | null }>) {
    const list = entries.get(r.race_id) ?? [];
    list.push({ boat: r.boat, finish: r.finish_pos, ex: r.exhibition_time });
    entries.set(r.race_id, list);
  }
  const races: Race[] = [];
  for (const [raceId, program] of programs) {
    const list = entries.get(raceId);
    if (!list) continue;
    const winners = list.filter((e) => e.finish === 1);
    if (winners.length !== 1) continue;
    const exhibition = new Map(list.filter((e) => e.ex != null && e.ex > 0).map((e) => [e.boat, e.ex!]));
    const x = raceFeatures(program.boats, exhibition);
    if (!x) continue;
    races.push({ raceId, date: program.date, x, winner: winners[0].boat - 1 });
  }
  return races;
}

// ─── 2段目・評価用（2026-07〜10）: 締切5分前の市場・番組・直前情報の展示・確定した1着 ───
type MarketRace = Race & { marketWin: number[]; trifecta: Map<string, number>; winnerCombo: string; xPointInTime: number[][]; exhibitionKnownAtT5: boolean };
function loadMarketRaces(from: string, to: string): MarketRace[] {
  const programs = loadPrograms(from, to);
  const { t5, t10, t20 } = loadCompleteCaptures(db, from, to);
  const params = loadChampionCalibration();
  const exhibitions = new Map<string, Map<number, number>>();
  const exhibitionFetchedAt = new Map<string, number>();
  for (const r of db.prepare(`SELECT race_id, course, exhibition_time, fetched_at FROM exhibition_data WHERE race_id >= ? AND race_id < ? AND exhibition_time > 0`)
    .iterate(from.replaceAll("-", ""), `${to.replaceAll("-", "")}~`) as Iterable<{ race_id: string; course: number; exhibition_time: number; fetched_at: string }>) {
    const m = exhibitions.get(r.race_id) ?? new Map<number, number>();
    m.set(r.course, r.exhibition_time);
    exhibitions.set(r.race_id, m);
    const at = Date.parse(r.fetched_at.includes("T") ? r.fetched_at : `${r.fetched_at.replace(" ", "T")}Z`);
    if (Number.isFinite(at)) exhibitionFetchedAt.set(r.race_id, Math.max(exhibitionFetchedAt.get(r.race_id) ?? 0, at));
  }
  const results = db.prepare(`SELECT race_id, date, trifecta FROM race_results WHERE date >= ? AND date <= ? AND trifecta IS NOT NULL AND COALESCE(returned, 0) = 0`)
    .all(from, to) as Array<{ race_id: string; date: string; trifecta: string }>;
  const races: MarketRace[] = [];
  for (const r of results) {
    const odds = t5.get(r.race_id);
    const program = programs.get(r.race_id);
    if (!odds || !program || !/^[1-6]-[1-6]-[1-6]$/.test(r.trifecta)) continue;
    const p = calibratedMarketProbabilities(odds, t10.get(r.race_id) ?? t20.get(r.race_id) ?? null, params);
    if (!p) continue;
    const marketWin = [0, 0, 0, 0, 0, 0];
    for (const [selection, prob] of p) marketWin[Number(selection[0]) - 1] += prob;
    if (marketWin.some((v) => !(v > 0))) continue;
    const x = raceFeatures(program.boats, exhibitions.get(r.race_id) ?? new Map());
    if (!x) continue;
    if (!p.has(r.trifecta)) continue;
    // 締切5分前までに手元で取れていた展示だけを使う版（取れた時刻 = その行の fetched_at。6艇とも取れた時刻で見る）
    const close = Date.parse(`${r.date}T${program.closeAt}:00+09:00`);
    const fetchedAt = exhibitionFetchedAt.get(r.race_id);
    const exhibitionKnownAtT5 = fetchedAt != null && Number.isFinite(close) && fetchedAt <= close - 5 * 60_000;
    const xPointInTime = exhibitionKnownAtT5 ? x : raceFeatures(program.boats, new Map())!;
    races.push({ raceId: r.race_id, date: r.date, x, winner: Number(r.trifecta[0]) - 1, marketWin, trifecta: p, winnerCombo: r.trifecta, xPointInTime, exhibitionKnownAtT5 });
  }
  return races.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── 1段目の学習（多項ロジット・全件の勾配・Adam・弱い L2） ───
const softmax = (scores: number[]) => {
  const max = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - max));
  const sum = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / sum);
};
const fundamentalProbs = (w: number[], x: number[][]) => softmax(x.map((row) => row.reduce((s, v, k) => s + v * w[k], 0)));

function fitFundamental(races: Race[], drop: ReadonlySet<number> = new Set()): number[] {
  const w = new Array(K).fill(0), m = new Array(K).fill(0), v = new Array(K).fill(0);
  const lr = 0.05, l2 = 1e-4;
  for (let iter = 1; iter <= 400; iter += 1) {
    const grad = new Array(K).fill(0);
    for (const race of races) {
      const p = fundamentalProbs(w, race.x);
      for (let i = 0; i < 6; i += 1) {
        const g = p[i] - (i === race.winner ? 1 : 0);
        for (let k = 0; k < K; k += 1) grad[k] += g * race.x[i][k];
      }
    }
    for (let k = 0; k < K; k += 1) {
      if (drop.has(k)) continue;
      const g = grad[k] / races.length + l2 * w[k];
      m[k] = 0.9 * m[k] + 0.1 * g;
      v[k] = 0.999 * v[k] + 0.001 * g * g;
      w[k] -= (lr * (m[k] / (1 - 0.9 ** iter))) / (Math.sqrt(v[k] / (1 - 0.999 ** iter)) + 1e-8);
    }
  }
  return w;
}

// ─── 2段目: c_i ∝ exp(α·log f_i + β·log π_i)（Newton 法。市場だけは α=0） ───
type Stage2 = { alpha: number; beta: number };
const combined = (s: Stage2, f: number[], pi: number[]) => softmax(f.map((fi, i) => s.alpha * Math.log(fi) + s.beta * Math.log(pi[i])));

function fitStage2(races: Array<{ f: number[]; pi: number[]; winner: number }>, useModel: boolean): Stage2 {
  let a = useModel ? 0.1 : 0, b = 1;
  for (let iter = 0; iter < 50; iter += 1) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const r of races) {
      const lf = r.f.map(Math.log), lp = r.pi.map(Math.log);
      const c = combined({ alpha: a, beta: b }, r.f, r.pi);
      const ef = c.reduce((s, ci, i) => s + ci * lf[i], 0), ep = c.reduce((s, ci, i) => s + ci * lp[i], 0);
      ga += lf[r.winner] - ef; gb += lp[r.winner] - ep;
      haa -= c.reduce((s, ci, i) => s + ci * (lf[i] - ef) ** 2, 0);
      hbb -= c.reduce((s, ci, i) => s + ci * (lp[i] - ep) ** 2, 0);
      hab -= c.reduce((s, ci, i) => s + ci * (lf[i] - ef) * (lp[i] - ep), 0);
    }
    if (useModel) {
      const det = haa * hbb - hab * hab;
      a -= (hbb * ga - hab * gb) / det;
      b -= (haa * gb - hab * ga) / det;
    } else {
      b -= gb / hbb;
    }
  }
  return { alpha: a, beta: b };
}

const meanLogLoss = (probs: number[][], winners: number[]) => probs.reduce((s, p, i) => s - Math.log(Math.max(p[winners[i]], 1e-12)), 0) / probs.length;
const r2 = (logLoss: number) => 1 - logLoss / Math.log(6);

// ─── 実行 ───
const training = loadTrainingRaces();
log(`学習 ${training.length} レース（${PERIODS.fundamental.join("〜")}）`);
const w = fitFundamental(training);
log(`基礎モデルの係数: ${FEATURES.map((name, k) => `${name} ${w[k].toFixed(3)}`).join(" / ")}`);
log(`基礎モデル（学習期間の中）: R² ${r2(meanLogLoss(training.map((r) => fundamentalProbs(w, r.x)), training.map((r) => r.winner))).toFixed(4)}`);

const market = loadMarketRaces(PERIODS.combine[0], PERIODS.evaluate[1]);
const withF = market.map((r) => ({ ...r, f: fundamentalProbs(w, r.x), pi: r.marketWin }));
const combineSet = withF.filter((r) => r.date <= PERIODS.combine[1]);
const evalSet = withF.filter((r) => r.date >= PERIODS.evaluate[0]);
log(`2段目の学習 ${combineSet.length} レース・評価 ${evalSet.length} レース（展示が6艇そろうのは評価の ${evalSet.filter((r) => r.x.some((row) => row[K - 1] !== 0)).length} レース）`);

const sCombined = fitStage2(combineSet, true);
const sMarket = fitStage2(combineSet, false);
log(`2段目: 市場＋基礎 α=${sCombined.alpha.toFixed(3)} β=${sCombined.beta.toFixed(3)} / 市場だけ β=${sMarket.beta.toFixed(3)}`);

const report = (label: string, races: typeof evalSet) => {
  if (!races.length) return;
  const winners = races.map((r) => r.winner);
  const llMarket = meanLogLoss(races.map((r) => combined(sMarket, r.f, r.pi)), winners);
  const llCombined = meanLogLoss(races.map((r) => combined(sCombined, r.f, r.pi)), winners);
  const llFundamental = meanLogLoss(races.map((r) => r.f), winners);
  const llRawMarket = meanLogLoss(races.map((r) => r.pi), winners);
  console.log(`${label} | ${races.length} レース | R² 市場(補正のまま) ${r2(llRawMarket).toFixed(4)} | 市場だけ ${r2(llMarket).toFixed(4)} | 基礎だけ ${r2(llFundamental).toFixed(4)} | 市場＋基礎 ${r2(llCombined).toFixed(4)} | ΔR² ${(r2(llCombined) - r2(llMarket)).toFixed(4)} | logloss の差 ${(llMarket - llCombined).toFixed(4)}`);
};
console.log("\n期間 | レース | R²（1着）");
report("2段目の学習（7〜8月・参考）", combineSet);
report("評価（9/1〜10/15）", evalSet);
report("評価・9月", evalSet.filter((r) => r.date.startsWith("2026-09")));
report("評価・10月", evalSet.filter((r) => r.date.startsWith("2026-10")));
console.log("\n合否（事前登録）: ΔR² 0.009 以上かつ 9月・10月とも正 → 次へ / 0.003〜0.009 → 保留 / 0.003 未満 → 閉じる");

// ─── ここから下は参考（事前登録の合否には使わない） ───
// (1) 偶然の幅: レースごとの logloss の差の平均と標準誤差
{
  const d = evalSet.map((r) => -Math.log(combined(sMarket, r.f, r.pi)[r.winner]) + Math.log(combined(sCombined, r.f, r.pi)[r.winner]));
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (d.length - 1));
  console.log(`\n[参考] 評価の logloss の差（市場だけ − 市場＋基礎）: 平均 ${mean.toFixed(4)}・標準誤差 ${(sd / Math.sqrt(d.length)).toFixed(4)}（${(mean / (sd / Math.sqrt(d.length))).toFixed(1)} 標準誤差）`);
}

// (2) 3連単（120通り）でも効くか: q(i-j-k) ∝ p(i-j-k)^b · f_i^a。a・b は 7〜8月で決め、9/1〜10/15 で p^b だけと比べる
{
  const fitTri = (races: typeof evalSet, useModel: boolean): Stage2 => {
    let a = 0, b = 1;
    for (let iter = 0; iter < 40; iter += 1) {
      let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
      for (const r of races) {
        const combos = [...r.trifecta];
        const lf = combos.map(([c]) => Math.log(r.f[Number(c[0]) - 1])), lp = combos.map(([, p]) => Math.log(p));
        const q = softmax(combos.map((_, i) => a * lf[i] + b * lp[i]));
        const wi = combos.findIndex(([c]) => c === r.winnerCombo);
        const ef = q.reduce((s, qi, i) => s + qi * lf[i], 0), ep = q.reduce((s, qi, i) => s + qi * lp[i], 0);
        ga += lf[wi] - ef; gb += lp[wi] - ep;
        haa -= q.reduce((s, qi, i) => s + qi * (lf[i] - ef) ** 2, 0);
        hbb -= q.reduce((s, qi, i) => s + qi * (lp[i] - ep) ** 2, 0);
        hab -= q.reduce((s, qi, i) => s + qi * (lf[i] - ef) * (lp[i] - ep), 0);
      }
      if (useModel) { const det = haa * hbb - hab * hab; a -= (hbb * ga - hab * gb) / det; b -= (haa * gb - hab * ga) / det; }
      else b -= gb / hbb;
    }
    return { alpha: a, beta: b };
  };
  const triLoss = (s: Stage2, races: typeof evalSet) => races.reduce((sum, r) => {
    const combos = [...r.trifecta];
    const q = softmax(combos.map(([c, p]) => s.alpha * Math.log(r.f[Number(c[0]) - 1]) + s.beta * Math.log(p)));
    return sum - Math.log(q[combos.findIndex(([c]) => c === r.winnerCombo)]);
  }, 0) / races.length;
  const tc = fitTri(combineSet, true), tm = fitTri(combineSet, false);
  const lm = triLoss(tm, evalSet), lc = triLoss(tc, evalSet);
  console.log(`[参考] 3連単の logloss（評価 ${evalSet.length} レース）: 市場だけ ${lm.toFixed(4)}（b=${tm.beta.toFixed(3)}）/ 市場＋基礎 ${lc.toFixed(4)}（a=${tc.alpha.toFixed(3)} b=${tc.beta.toFixed(3)}）/ 差 ${(lm - lc).toFixed(4)}（でたらめは ${Math.log(120).toFixed(3)}）`);
}

// (4) その時点で知り得た値だけ: 締切5分前までに取れていた展示だけを使う（取れていなければ展示なし）。
//     あわせて、締切5分前までに展示が取れていたレースだけでの比べ。
{
  const pit = (r: MarketRace) => ({ ...r, f: fundamentalProbs(w, r.xPointInTime), pi: r.marketWin });
  const cs = combineSet.map(pit), es = evalSet.map(pit);
  const sc = fitStage2(cs, true), sm = fitStage2(cs, false);
  const delta = (races: typeof es) => {
    const winners = races.map((r) => r.winner);
    return r2(meanLogLoss(races.map((r) => combined(sc, r.f, r.pi)), winners)) - r2(meanLogLoss(races.map((r) => combined(sm, r.f, r.pi)), winners));
  };
  const known = es.filter((r) => r.exhibitionKnownAtT5);
  console.log(`[参考] その時点の値だけ（展示は締切5分前までに取れたレースだけ使う）: 評価の ΔR² ${delta(es).toFixed(4)}（α=${sc.alpha.toFixed(3)}・評価 ${es.length} レースのうち展示が間に合ったのは ${known.length}）`);
  console.log(`[参考] 展示が締切5分前までに取れていたレースだけ: ΔR² ${delta(known).toFixed(4)}（${known.length} レース）/ 取れていなかったレースだけ: ΔR² ${delta(es.filter((r) => !r.exhibitionKnownAtT5)).toFixed(4)}`);
}

// (3) どの材料が効いているか: 材料のまとまりを外して学習し直し、評価の ΔR² を比べる
{
  const groups: Record<string, string[]> = {
    展示: ["展示タイム"],
    選手: ["A1", "A2", "B1", "全国勝率", "全国2連率", "当地勝率", "当地2連率", "当地なし"],
    機材: ["モーター2連率", "ボート2連率"],
  };
  for (const [name, features] of Object.entries(groups)) {
    const drop = new Set(features.map((f) => FEATURES.indexOf(f as (typeof FEATURES)[number])));
    const wd = fitFundamental(training, drop);
    const fd = (r: MarketRace) => fundamentalProbs(wd, r.x);
    const cs = combineSet.map((r) => ({ ...r, f: fd(r) })), es = evalSet.map((r) => ({ ...r, f: fd(r) }));
    const sc = fitStage2(cs, true), sm = fitStage2(cs, false);
    const winners = es.map((r) => r.winner);
    const delta = r2(meanLogLoss(es.map((r) => combined(sc, r.f, r.pi)), winners)) - r2(meanLogLoss(es.map((r) => combined(sm, r.f, r.pi)), winners));
    console.log(`[参考] ${name}を外すと: 評価の ΔR² ${delta.toFixed(4)}（α=${sc.alpha.toFixed(3)}）`);
  }
}
db.close();
