/**
 * 週次の改善処理（read-only の DB 読み取り + data/reports/scorecard への記録だけ）。
 * 市場補正のパラメータ（temperature・late money β、必要ならオッズ帯の重み）を、評価期間より前の 8 週で学習し直した「挑戦者」と、
 * 現在の「王者」を、学習に使っていない直近 4 週で比べる。事前登録した条件（src/domain/accuracyScorecard.ts の
 * PROMOTION_RULE）を満たしたときだけ王者を入れ替える。入れ替えで変わるのは、スコアカードと BUY 通知に出す
 * 「市場補正の確率」だけで、BUY の判定・app_settings・DB は変えない。
 *
 * 使い方: npx tsx scripts/run-accuracy-growth.ts [--to YYYY-MM-DD] [--state-dir dir] [--force]
 *   既定では前回の評価から 6 日たっていなければ何もしない（毎晩呼んでも週1回だけ動く）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PROMOTION_RULE, describeCalibration, evaluateChallenger, fitChallengers, type MarketCalibration, type MarketRace } from "../src/domain/accuracyScorecard";
import { DEFAULT_SCORECARD_STATE_DIR, addDays, loadChampionCalibration, loadMarketRaces, todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TO = arg("--to") ?? addDays(todayJst(), -1);
const STATE_DIR = arg("--state-dir") ?? DEFAULT_SCORECARD_STATE_DIR;
const FORCE = args.includes("--force");
if (!/^\d{4}-\d{2}-\d{2}$/.test(TO)) throw new Error(`invalid --to: ${TO}`);
mkdirSync(STATE_DIR, { recursive: true });
const ledgerPath = `${STATE_DIR}/growth-ledger.jsonl`;

const previous = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).at(-1) : undefined;
if (previous && !FORCE) {
  const last = JSON.parse(previous) as { evaluatedAt: string };
  if (Date.now() - Date.parse(last.evaluatedAt) < 6 * 24 * 3600_000) {
    console.log(`[accuracy-growth] skip: last evaluation ${last.evaluatedAt}`);
    process.exit(0);
  }
}

// 評価: 直近 28 日（4 週）。学習: その前の 56 日。期間は重ならない。
const evalFrom = addDays(TO, -27);
const fitTo = addDays(evalFrom, -1);
const fitFrom = addDays(fitTo, -55);
const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON;");
const races = loadMarketRaces(db, fitFrom, TO);
db.close();

const fitRaces = races.filter((r) => r.date >= fitFrom && r.date <= fitTo);
const evalRaces = races.filter((r) => r.date >= evalFrom && r.date <= TO);
const weeklyBlocks: MarketRace[][] = [0, 1, 2, 3].map((w) => {
  const from = addDays(evalFrom, w * 7), to = addDays(evalFrom, w * 7 + 6);
  return evalRaces.filter((r) => r.date >= from && r.date <= to);
});
const champion = loadChampionCalibration(STATE_DIR);
const { best, candidates } = fitChallengers(fitRaces);
const challenger: MarketCalibration = best.params;
const fitted = { logLoss: best.trainLogLoss };
const result = evaluateChallenger(champion, challenger, weeklyBlocks);
const evaluatedAt = new Date().toISOString();
const entry = {
  evaluatedAt,
  fitWindow: { from: fitFrom, to: fitTo, races: fitRaces.length, logLoss: fitted.logLoss },
  evalWindow: { from: evalFrom, to: TO, weeklyRaces: weeklyBlocks.map((b) => b.length) },
  champion: { temperature: champion.temperature, lateMoneyBeta: champion.lateMoneyBeta, oddsBandWeights: champion.oddsBandWeights ?? null, source: champion.source },
  challenger,
  challengerFamily: best.family,
  candidates: candidates.map((c) => ({ family: c.family, trainLogLoss: c.trainLogLoss, params: c.params })),
  rule: PROMOTION_RULE,
  ...result,
};
appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);

const sameAsChampion = describeCalibration(challenger) === describeCalibration(champion);
if (result.promote && !sameAsChampion) {
  const tmp = `${STATE_DIR}/champion.json.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...challenger, promotedAt: evaluatedAt, evidence: { improvement: result.improvement, weeklyWins: result.weeklyWins, evalWindow: entry.evalWindow } }, null, 2)}\n`);
  renameSync(tmp, `${STATE_DIR}/champion.json`);
  appendFileSync(`${STATE_DIR}/events.jsonl`, `${JSON.stringify({ at: evaluatedAt, type: "champion-promoted", text: `市場補正を ${describeCalibration(champion)} から ${describeCalibration(challenger)} へ（logloss 改善 ${result.improvement?.toFixed(4)}、週の勝ち ${result.weeklyWins}/${result.eligibleWeeks}）` })}\n`);
}
const fmt = (v: number | null, d = 5) => (v == null ? "-" : v.toFixed(d));
console.log([
  `[accuracy-growth] ${evaluatedAt}`,
  `学習 ${fitFrom}〜${fitTo}: ${fitRaces.length} レース → 挑戦者 ${describeCalibration(challenger)}（${best.family}、学習 logloss ${fmt(fitted.logLoss)}）`,
  `評価 ${evalFrom}〜${TO}: ${result.races} レース / 週ごと ${weeklyBlocks.map((b) => b.length).join(",")}`,
  `王者 ${fmt(result.championLogLoss)} vs 挑戦者 ${fmt(result.challengerLogLoss)} / 改善 ${fmt(result.improvement, 4)} / 週の勝ち ${result.weeklyWins}/${result.eligibleWeeks}`,
  `判定: ${result.promote && !sameAsChampion ? "入れ替え" : "据え置き"}`,
].join("\n"));
