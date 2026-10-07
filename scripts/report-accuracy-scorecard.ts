/**
 * 精度スコアカード（read-only）。
 * - 当たり外れ: paper-live BUY を公式払戻で精算した台帳
 * - 確率の精度: 同じ精算済みレースで v3 推定的中率 / T-5 市場 / 市場補正（temperature + late money）を比較
 * - 収集の健全性: 直近7日の T-5 完全市場カバー率、最終取得時刻、private capture 認可の期限
 * - 成長: 週次の改善処理（scripts/run-accuracy-growth.ts）が入れ替えた市場補正パラメータと、その判定履歴
 *
 * 使い方: npx tsx scripts/report-accuracy-scorecard.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--accuracy-days N]
 *          [--format md|json] [--public] [--output path] [--json-output path] [--state-dir dir]
 * 当たり外れの台帳は --from からの全期間。確率の精度はオッズ時系列の走査が重いので直近 --accuracy-days 日（既定 60、0 で全期間）に絞る。
 * --public はレース ID・買い目・オッズを出さない（公開境界: scripts/verify-product-boundaries.mjs と同じ方針）。
 * --state-dir を付けると、履歴（history.jsonl）に1行足し、前回は無かった注意をイベント（events.jsonl）に記録する。
 * DB は読み取り専用で開く。BOAT_PON_DB_URI で接続先を変えられる。DB にもリポジトリの追跡ファイルにも書かない。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  binaryMetrics, calibratedMarketProbabilities, normalizedMarketProbabilities, summarizeBuyLedger,
  type BinaryMetrics, type BinaryPrediction,
} from "../src/domain/accuracyScorecard";
import { addDays, loadChampionCalibration, loadCompleteCaptures, todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const FROM = arg("--from") ?? "2026-06-01";
const TO = arg("--to") ?? todayJst();
const FORMAT = arg("--format") ?? "md";
const PUBLIC = args.includes("--public");
const ACCURACY_DAYS = Number(arg("--accuracy-days") ?? "60");
const OUTPUT = arg("--output");
const JSON_OUTPUT = arg("--json-output");
const STATE_DIR = arg("--state-dir");
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO) || FROM > TO) throw new Error(`invalid window: ${FROM}..${TO}`);
if (FORMAT !== "md" && FORMAT !== "json") throw new Error(`invalid --format: ${FORMAT}`);
if (!Number.isInteger(ACCURACY_DAYS) || ACCURACY_DAYS < 0) throw new Error(`invalid --accuracy-days: ${ACCURACY_DAYS}`);
const AUTH_PATH = "data/private/trifecta-capture/authorization.json";
const champion = loadChampionCalibration(STATE_DIR);

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON;");
const ACCURACY_FROM = ACCURACY_DAYS === 0 ? FROM : [FROM, addDays(TO, -(ACCURACY_DAYS - 1))].sort()[1];
const healthFrom = addDays(TO, -6);

type Decision = { race_id: string; date: string; venue: string; race_no: number; selection: string; decision: string; est: number; cur: number | null; trifecta: string | null; payout: number | null; returned: number | null };
const decisions = db.prepare(`SELECT d.race_id, d.date, d.venue, d.race_no, d.selection, d.decision, d.estimated_hit_rate est, d.current_odds cur,
    r.trifecta, r.payout_yen payout, r.returned
  FROM decision_history d LEFT JOIN race_results r ON r.race_id = d.race_id
  WHERE d.run_kind = 'paper-live' AND d.date >= ? AND d.date <= ?`).all(FROM, TO) as Decision[];
const { t5, t10, t20 } = loadCompleteCaptures(db, [ACCURACY_FROM, healthFrom].sort()[0], TO);
const lastCapture = (db.prepare(`SELECT MAX(captured_at) at FROM odds_timeseries_snapshots WHERE id > (SELECT MAX(id) - 200000 FROM odds_timeseries_snapshots)`).get() as { at: string | null }).at;
const programsByDate = new Map((db.prepare(`SELECT date, COUNT(*) n FROM official_programs WHERE date >= ? AND date <= ? GROUP BY date`).all(healthFrom, TO) as Array<{ date: string; n: number }>).map((r) => [r.date, r.n]));
db.close();

// ─── 当たり外れ ───
const buys = decisions.filter((d) => d.decision === "BUY").sort((a, b) => a.race_id.localeCompare(b.race_id));
const isSettled = (d: Decision) => d.trifecta != null && d.trifecta !== "" && !d.returned && d.payout != null;
const ledger = summarizeBuyLedger(buys.map((d) => ({ date: d.date, hit: isSettled(d) ? d.trifecta === d.selection : null, payoutYen: d.payout })));
const recentBuys = buys.slice(-10).reverse().map((d) => ({
  date: d.date, venue: d.venue, raceNo: d.race_no, selection: d.selection, quoteOdds: d.cur,
  result: isSettled(d) ? (d.trifecta === d.selection ? "的中" : "外れ") : "結果待ち", resultSelection: d.trifecta, payoutYen: isSettled(d) ? (d.trifecta === d.selection ? d.payout : 0) : null,
}));

// ─── 確率の精度（同じレースだけで比較） ───
type Scored = { decision: string; hit: 0 | 1; v3: number; market: number; calibrated: number; t5Odds: number; quoteOdds: number | null };
const scored: Scored[] = [];
for (const d of decisions) {
  if (d.date < ACCURACY_FROM || !isSettled(d)) continue;
  const odds = t5.get(d.race_id);
  if (!odds) continue;
  const market = normalizedMarketProbabilities(odds);
  const calibrated = calibratedMarketProbabilities(odds, t10.get(d.race_id) ?? t20.get(d.race_id) ?? null, champion);
  if (!market || !calibrated || !market.has(d.selection)) continue;
  scored.push({ decision: d.decision, hit: d.trifecta === d.selection ? 1 : 0, v3: d.est, market: market.get(d.selection)!, calibrated: calibrated.get(d.selection)!, t5Odds: odds.get(d.selection)!, quoteOdds: d.cur });
}
const predictors = [
  { key: "v3", label: "v3 推定的中率" },
  { key: "market", label: "T-5 市場" },
  { key: "calibrated", label: `市場補正（T=${champion.temperature}・late money β=${champion.lateMoneyBeta}）` },
] as const;
const accuracyFor = (rows: Scored[]) => predictors.map((p) => ({ ...p, metrics: binaryMetrics(rows.map((r): BinaryPrediction => ({ p: r[p.key], hit: r.hit }))) }));
const accuracyAll = accuracyFor(scored);
const scoredBuys = scored.filter((r) => r.decision === "BUY");
const accuracyBuy = accuracyFor(scoredBuys);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const buyEv = {
  n: scoredBuys.length,
  v3PredictedEvAtQuote: mean(scoredBuys.filter((r) => r.quoteOdds != null).map((r) => r.v3 * (r.quoteOdds as number))),
  calibratedEvAtT5: mean(scoredBuys.map((r) => r.calibrated * r.t5Odds)),
};

// ─── 収集の健全性 ───
const t5ByDate = new Map<string, number>();
for (const raceId of t5.keys()) {
  const date = `${raceId.slice(0, 4)}-${raceId.slice(4, 6)}-${raceId.slice(6, 8)}`;
  if (date >= healthFrom && date <= TO) t5ByDate.set(date, (t5ByDate.get(date) ?? 0) + 1);
}
// 今日の分は、レースがほぼ終わる 21時（JST）より前なら数えない（未開催の日を 0% として警告しないため）。
const jstHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const countable = ([date]: [string, number]) => date < todayJst() || (date === todayJst() && jstHour >= 21);
const coverage = [...programsByDate].filter(countable).sort(([a], [b]) => a.localeCompare(b)).map(([date, programs]) => ({ date, programs, t5Complete: t5ByDate.get(date) ?? 0, pct: programs ? (t5ByDate.get(date) ?? 0) / programs : null }));
const totalPrograms = coverage.reduce((a, c) => a + c.programs, 0);
const coverage7d = totalPrograms ? coverage.reduce((a, c) => a + c.t5Complete, 0) / totalPrograms : null;
let captureExpiresAt: string | null = null;
if (existsSync(AUTH_PATH)) {
  try { captureExpiresAt = (JSON.parse(readFileSync(AUTH_PATH, "utf8")) as { expiresAt?: string }).expiresAt ?? null; } catch { captureExpiresAt = null; }
}

// ─── 成長（週次の改善処理の結果） ───
type GrowthEntry = { evaluatedAt: string; champion: { temperature: number; lateMoneyBeta: number }; challenger: { temperature: number; lateMoneyBeta: number }; improvement: number | null; weeklyWins: number; eligibleWeeks: number; promote: boolean; races: number };
const readJsonl = <T,>(path: string): T[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } }) : []);
const growthLedger = STATE_DIR ? readJsonl<GrowthEntry>(`${STATE_DIR}/growth-ledger.jsonl`) : [];
const lastGrowth = growthLedger.at(-1) ?? null;

// ─── 注意 ───
const now = new Date();
const alerts: string[] = [];
if (coverage7d != null && coverage7d < 0.7) alerts.push(`T-5 完全市場の7日カバー率が ${pct(coverage7d)}（目安 70% 未満）`);
if (lastCapture && now.getTime() - Date.parse(lastCapture) > 24 * 3600_000) alerts.push(`最後のオッズ取得から24時間以上経過（${lastCapture}）`);
if (captureExpiresAt && Date.parse(captureExpiresAt) < now.getTime()) alerts.push(`private capture の認可が期限切れ（${captureExpiresAt}）`);
const v3All = accuracyAll[0].metrics, calAll = accuracyAll[2].metrics;
if (v3All.logLoss != null && calAll.logLoss != null && v3All.logLoss > calAll.logLoss) alerts.push(`v3 の確率は市場補正より不正確（logloss ${num(v3All.logLoss, 5)} > ${num(calAll.logLoss, 5)}）`);
const v3Buy = accuracyBuy[0].metrics;
if (v3Buy.actualToPredicted != null && v3Buy.n >= 30 && v3Buy.actualToPredicted < 0.5) alerts.push(`BUY での v3 の的中予測が過大（実績/予測 = ${num(v3Buy.actualToPredicted, 2)}）`);
const pendingOld = buys.filter((d) => !isSettled(d) && d.date <= addDays(todayJst(), -3)).length;
if (pendingOld > 0) alerts.push(`3日以上前の BUY のうち ${pendingOld} 件の結果が未取り込み（結果の取り込みが止まっていないか確認）`);
if (STATE_DIR && (!lastGrowth || now.getTime() - Date.parse(lastGrowth.evaluatedAt) > 9 * 24 * 3600_000)) alerts.push("週次の改善処理（run-accuracy-growth）が9日以上動いていない");

const report = {
  generatedAt: now.toISOString(),
  window: { from: FROM, to: TO, accuracyFrom: ACCURACY_FROM },
  safety: { readOnly: true, public: PUBLIC },
  ledger,
  recentBuys: PUBLIC ? undefined : recentBuys,
  accuracy: { comparedRaces: scored.length, calibration: champion, all: accuracyAll, buyOnly: accuracyBuy, buyEv },
  health: { coverage7d, coverage, lastOddsCapturedAt: lastCapture, privateCaptureExpiresAt: captureExpiresAt },
  growth: { champion, lastEvaluation: lastGrowth, evaluations: growthLedger.length, promotions: growthLedger.filter((g) => g.promote).length },
  alerts,
};

// ─── 蓄積: 履歴に1行、前回は無かった注意をイベントに ───
let newAlerts: string[] = [];
if (STATE_DIR) {
  mkdirSync(STATE_DIR, { recursive: true });
  type HistoryEntry = { generatedAt: string; alerts: string[] };
  const previous = readJsonl<HistoryEntry>(`${STATE_DIR}/history.jsonl`).at(-1);
  const alertKey = (a: string) => a.replace(/[0-9.%:TZ-]+/g, "#");
  const previousKeys = new Set((previous?.alerts ?? []).map(alertKey));
  newAlerts = alerts.filter((a) => !previousKeys.has(alertKey(a)));
  appendFileSync(`${STATE_DIR}/history.jsonl`, `${JSON.stringify({
    generatedAt: report.generatedAt, to: TO, ledger: { buys: ledger.buys, settled: ledger.settled, hits: ledger.hits, officialRoi: ledger.officialRoi },
    accuracy: { comparedRaces: scored.length, v3LogLoss: v3All.logLoss, calibratedLogLoss: calAll.logLoss, v3BuyActualToPredicted: v3Buy.actualToPredicted },
    coverage7d, calibration: { temperature: champion.temperature, lateMoneyBeta: champion.lateMoneyBeta }, alerts,
  })}\n`);
  for (const alert of newAlerts) appendFileSync(`${STATE_DIR}/events.jsonl`, `${JSON.stringify({ at: report.generatedAt, type: "new-alert", text: alert })}\n`);
}
const events = STATE_DIR ? readJsonl<{ at: string; type: string; text: string }>(`${STATE_DIR}/events.jsonl`).slice(-10).reverse() : [];

const out = FORMAT === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown();
if (OUTPUT) { writeFileSync(OUTPUT, out, "utf8"); console.error(`[accuracy-scorecard] wrote ${OUTPUT}`); } else process.stdout.write(out);
if (JSON_OUTPUT) { writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.error(`[accuracy-scorecard] wrote ${JSON_OUTPUT}`); }

function renderMarkdown() {
  const metricRow = (label: string, m: BinaryMetrics) => `| ${label} | ${m.n} | ${m.hits} | ${num(m.expectedHits, 1)} | ${num(m.actualToPredicted, 2)} | ${num(m.brier, 5)} | ${num(m.logLoss, 5)} |`;
  const head = "| 確率 | n | 的中 | 期待的中数 | 実績/予測 | Brier | logloss |\n|---|---:|---:|---:|---:|---:|---:|";
  const lines = [
    "# 精度スコアカード",
    "",
    `生成: ${report.generatedAt} / 期間: ${FROM}〜${TO} / DB は読み取り専用${PUBLIC ? " / 公開版（レース単位の情報は省略）" : ""}`,
    "",
    "## 注意",
    "",
    alerts.length ? alerts.map((a) => `- ⚠️ ${newAlerts.includes(a) ? "【新規】" : ""}${a}`).join("\n") : "- なし",
    "",
    "## 当たり外れ（paper-live BUY・公式払戻で精算）",
    "",
    `- 累計: BUY ${ledger.buys} / 精算 ${ledger.settled} / 的中 ${ledger.hits} / 外れ ${ledger.misses} / 結果待ち ${ledger.buys - ledger.settled} / ROI ${pct(ledger.officialRoi)}`,
    "",
    "| 月 | BUY | 精算 | 的中 | ROI |",
    "|---|---:|---:|---:|---:|",
    ...ledger.byMonth.map((m) => `| ${m.month} | ${m.buys} | ${m.settled} | ${m.hits} | ${pct(m.officialRoi)} |`),
  ];
  if (!PUBLIC) {
    lines.push("", "### 直近10件", "", "| 日付 | 会場 | R | 買い目 | 判定時オッズ | 結果 | 確定 | 払戻 |", "|---|---|---:|---|---:|---|---|---:|",
      ...recentBuys.map((b) => `| ${b.date} | ${b.venue} | ${b.raceNo} | ${b.selection} | ${b.quoteOdds ?? "-"} | ${b.result} | ${b.resultSelection ?? "-"} | ${b.payoutYen ?? "-"} |`));
  }
  lines.push(
    "",
    `## 確率の精度（${ACCURACY_FROM}〜${TO} の同じ精算済みレース ${scored.length} 件で比較。logloss・Brier は小さいほど正確）`,
    "",
    "### 全判定",
    "",
    head,
    ...accuracyAll.map((a) => metricRow(a.label, a.metrics)),
    "",
    "### BUY のみ",
    "",
    head,
    ...accuracyBuy.map((a) => metricRow(a.label, a.metrics)),
    "",
    `- BUY の期待値: v3 の予測（判定時オッズ） ${num(buyEv.v3PredictedEvAtQuote, 2)} / 市場補正（T-5 オッズ） ${num(buyEv.calibratedEvAtT5, 2)} / 実績 ROI は上の累計を参照`,
    "",
    "## 成長（市場補正パラメータの自動改善）",
    "",
    `- 現在の王者: temperature ${champion.temperature} / late money β ${champion.lateMoneyBeta}（${champion.source}）`,
    lastGrowth
      ? `- 直近の評価（${lastGrowth.evaluatedAt}）: 挑戦者 T=${lastGrowth.challenger.temperature}・β=${lastGrowth.challenger.lateMoneyBeta} / 改善 ${num(lastGrowth.improvement, 4)} / 週の勝ち ${lastGrowth.weeklyWins}/${lastGrowth.eligibleWeeks} / ${lastGrowth.promote ? "入れ替え" : "据え置き"} / 評価 ${growthLedger.length} 回・入れ替え ${report.growth.promotions} 回`
      : "- 評価の記録なし（`npx tsx scripts/run-accuracy-growth.ts` が週1回動く）",
    "",
    "## 収集の健全性（直近7日）",
    "",
    `- T-5 完全市場カバー率: ${pct(coverage7d)} / 最終オッズ取得: ${lastCapture ?? "-"} / private capture 認可の期限: ${captureExpiresAt ?? "-"}`,
    "",
    "| 日付 | 番組 | T-5 完全 | カバー率 |",
    "|---|---:|---:|---:|",
    ...coverage.map((c) => `| ${c.date} | ${c.programs} | ${c.t5Complete} | ${pct(c.pct)} |`),
  );
  if (events.length) lines.push("", "## 最近のイベント", "", ...events.map((e) => `- ${e.at.slice(0, 10)} ${e.type}: ${e.text}`));
  return `${lines.join("\n")}\n`;
}

function pct(value: number | null) { return value == null ? "-" : `${(value * 100).toFixed(1)}%`; }
function num(value: number | null, digits: number) { return value == null ? "-" : value.toFixed(digits); }
