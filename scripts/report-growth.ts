/**
 * 成長レポート（読み取り専用）: 1週間前・1か月前・半年前と比べて、良くなっているか。
 *
 * 期間: 直近7日とその前の7日、直近30日とその前の30日、月別（--months-from から）。
 * 指標:
 *   1. 当たり外れ（paper-live BUY を公式払戻で精算）と、締切前に通知できた割合
 *   2. 判定の記録の量（判定の行 ÷ 番組）
 *   3. T-5 完全市場の収集カバー率
 *   4. 確率の精度（同じレースで v3 と市場補正の logloss の差。2026-07-01 から）
 *   5. 知識の量（lessons-learned の項目・レビュー文書の数を月別に）
 *   6. 作業の性質（コミットの種類を月別に）
 *
 * 使い方: npx tsx scripts/report-growth.ts [--to YYYY-MM-DD] [--months-from YYYY-MM] [--no-months] [--output path] [--json-output path]
 *   --no-months: 月別を省いて直近60日だけを読む（月曜の週次 LINE 用。速い）
 * DB は読み取り専用。BOAT_PON_DB_URI で接続先を変えられる。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  binaryMetrics, calibratedMarketProbabilities, classifyBuyTiming, normalizedMarketProbabilities, summarizeBuyLedger,
  type BinaryPrediction, type BuyLedgerSummary,
} from "../src/domain/accuracyScorecard";
import { formatTally } from "../src/domain/buyResultNotification";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { addDays, loadChampionCalibration, loadCompleteCaptures, todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TO = arg("--to") ?? addDays(todayJst(), -1);
const MONTHS_FROM = arg("--months-from") ?? "2026-04";
const OUTPUT = arg("--output");
const JSON_OUTPUT = arg("--json-output");
const NO_MONTHS = args.includes("--no-months");
const STATE_DIR = "data/reports/scorecard";

type Window = { key: string; label: string; from: string; to: string };
const monthWindows: Window[] = [];
for (let m = MONTHS_FROM; !NO_MONTHS && m <= TO.slice(0, 7); ) {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  monthWindows.push({ key: m, label: `${y}年${mo}月`, from: `${m}-01`, to: [`${m}-${String(last).padStart(2, "0")}`, TO].sort()[0] });
  m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}
const recentWindows: Window[] = [
  { key: "w0", label: "直近7日", from: addDays(TO, -6), to: TO },
  { key: "w1", label: "その前の7日", from: addDays(TO, -13), to: addDays(TO, -7) },
  { key: "m0", label: "直近30日", from: addDays(TO, -29), to: TO },
  { key: "m1", label: "その前の30日", from: addDays(TO, -59), to: addDays(TO, -30) },
];
const allWindows = [...recentWindows, ...monthWindows];
const FROM = allWindows.map((w) => w.from).sort()[0];

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON;");
type Dec = { race_id: string; date: string; selection: string; decision: string; est: number; close_at: string | null; trifecta: string | null; payout: number | null; returned: number | null; sent_at: string | null; info_at: string | null };
const decisions = db.prepare(`WITH d AS (
    SELECT dh.*, ROW_NUMBER() OVER (PARTITION BY dh.race_id, dh.bet_type, dh.selection ORDER BY dh.created_at DESC, dh.id DESC) AS row_num
    FROM decision_history dh WHERE dh.run_kind = 'paper-live' AND dh.model_version = ? AND dh.date BETWEEN ? AND ?)
  SELECT d.race_id, d.date, d.selection, d.decision, d.estimated_hit_rate est, p.close_at, rr.trifecta, rr.payout_yen payout, rr.returned,
    (SELECT n.sent_at FROM notification_log n WHERE n.race_id = d.race_id AND n.channel = 'line' AND n.status = 'SENT') AS sent_at,
    (SELECT MIN(e.fetched_at) FROM exhibition_data e WHERE e.race_id = d.race_id) AS info_at
  FROM d LEFT JOIN official_programs p ON p.race_id = d.race_id LEFT JOIN race_results rr ON rr.race_id = d.race_id
  WHERE d.row_num = 1`).all(LIVE_MONITOR_MODEL_VERSION, FROM, TO) as Dec[];
const programsByDate = new Map((db.prepare(`SELECT date, COUNT(*) n FROM official_programs WHERE date BETWEEN ? AND ? GROUP BY date`).all(FROM, TO) as Array<{ date: string; n: number }>).map((r) => [r.date, r.n]));
// 確率の精度と T-5 カバー率は 2026-07-01 から数える。6月は T-5 の収集が 5% で比べられず、
// しかも 6〜7月の時系列オッズは量が多く、6月分を読むだけで約7分かかる（2026-10-14 の実測。8月の同じ長さは約3秒）。
const accuracyFrom = [FROM, "2026-07-01"].sort()[1];
const { t5, t10, t20 } = loadCompleteCaptures(db, accuracyFrom, TO);
db.close();
const champion = loadChampionCalibration(STATE_DIR);

const isSettled = (d: Dec) => d.trifecta != null && d.trifecta !== "" && !d.returned && d.payout != null;
const outcome = (d: Dec) => ({ date: d.date, hit: isSettled(d) ? d.trifecta === d.selection : null, payoutYen: d.payout });

type Row = {
  key: string; label: string; from: string; to: string;
  buys: BuyLedgerSummary; notified: number; decisionCoverage: number | null; t5Coverage: number | null;
  v3LogLoss: number | null; calibratedLogLoss: number | null; v3BuyRatio: number | null; comparedRaces: number;
};
function measure(w: Window): Row {
  const inWindow = decisions.filter((d) => d.date >= w.from && d.date <= w.to);
  const buys = inWindow.filter((d) => d.decision === "BUY");
  const notified = buys.filter((d) => classifyBuyTiming({ date: d.date, closeAt: d.close_at, sentAt: d.sent_at, infoAt: d.info_at }) === "notified").length;
  let programs = 0, t5Races = 0;
  for (const [date, n] of programsByDate) if (date >= w.from && date <= w.to) programs += n;
  for (const raceId of t5.keys()) { const date = `${raceId.slice(0, 4)}-${raceId.slice(4, 6)}-${raceId.slice(6, 8)}`; if (date >= w.from && date <= w.to) t5Races += 1; }
  const scored: Array<{ hit: 0 | 1; v3: number; cal: number; buy: boolean }> = [];
  for (const d of inWindow) {
    if (!isSettled(d)) continue;
    const odds = t5.get(d.race_id);
    if (!odds) continue;
    const cal = calibratedMarketProbabilities(odds, t10.get(d.race_id) ?? t20.get(d.race_id) ?? null, champion);
    if (!cal || !normalizedMarketProbabilities(odds)?.has(d.selection)) continue;
    scored.push({ hit: d.trifecta === d.selection ? 1 : 0, v3: d.est, cal: cal.get(d.selection)!, buy: d.decision === "BUY" });
  }
  const m = (rows: typeof scored, k: "v3" | "cal") => binaryMetrics(rows.map((r): BinaryPrediction => ({ p: r[k], hit: r.hit })));
  const buyRows = scored.filter((r) => r.buy);
  return {
    key: w.key, label: w.label, from: w.from, to: w.to,
    buys: summarizeBuyLedger(buys.map(outcome)), notified,
    decisionCoverage: programs ? inWindow.length / programs : null,
    t5Coverage: programs && w.to >= accuracyFrom ? t5Races / programs : null,
    v3LogLoss: m(scored, "v3").logLoss, calibratedLogLoss: m(scored, "cal").logLoss,
    v3BuyRatio: buyRows.length >= 10 ? m(buyRows, "v3").actualToPredicted : null, comparedRaces: scored.length,
  };
}
const rows = allWindows.map(measure);
const byKey = new Map(rows.map((r) => [r.key, r]));

// 5. 知識の量（月別）: lessons-learned の項目（見出しの日付）とレビュー文書
const knowledgeByMonth = new Map<string, number>();
const knowledgeDates: string[] = [];
if (existsSync("docs/lessons-learned.md")) {
  for (const line of readFileSync("docs/lessons-learned.md", "utf8").split("\n")) {
    if (!line.startsWith("## ")) continue;
    const date = line.match(/(20\d\d)-(\d\d)-\d\d/);
    if (!date) continue;
    knowledgeByMonth.set(`${date[1]}-${date[2]}`, (knowledgeByMonth.get(`${date[1]}-${date[2]}`) ?? 0) + 1);
    knowledgeDates.push(date[0]);
  }
}
const reviewDocs = existsSync("docs/reviews") ? readdirSync("docs/reviews").filter((f) => f.endsWith(".md")) : [];
for (const f of reviewDocs) { const d = f.match(/^20\d\d-\d\d-\d\d/); if (d) knowledgeDates.push(d[0]); }
// 直近の期間ごとに増えた知識（教訓の項目＋レビュー文書）
const knowledgeAdded = Object.fromEntries(recentWindows.map((w) => [w.key, knowledgeDates.filter((d) => d >= w.from && d <= w.to).length]));
// 6. 作業の性質（月別のコミットの種類）
const workByMonth = new Map<string, Record<string, number>>();
try {
  const log = execFileSync("git", ["log", `--since=${MONTHS_FROM}-01`, "--format=%cs|%s"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const line of log.split("\n").filter(Boolean)) {
    const [date, subject] = [line.slice(0, 10), line.slice(11)];
    const kind = /^fix\(research\)|^research[:(]|^test\(research\)|^feat\(research\)|^docs\(research\)/.test(subject) ? "研究基盤"
      : /^(feat|fix|perf)\((line|live|notify|ingest|growth|scorecard|audit|readiness|test)\)|^feat:|^fix:/.test(subject) ? "通知・収集・精度"
      : /^docs/.test(subject) ? "記録" : "その他";
    const month = date.slice(0, 7);
    const bucket = workByMonth.get(month) ?? {};
    bucket[kind] = (bucket[kind] ?? 0) + 1;
    workByMonth.set(month, bucket);
  }
} catch {
  // git が使えない環境では作業の性質を省く
}

// 判定（前の期間と比べて良くなったか）
const arrow = (now: number | null, before: number | null, higherIsBetter: boolean, eps: number) => {
  if (now == null || before == null) return "（比べられない）";
  const diff = now - before;
  if (Math.abs(diff) < eps) return "→ 横ばい";
  return (diff > 0) === higherIsBetter ? "↑ 良くなった" : "↓ 悪くなった";
};
const share = (r: Row) => (r.buys.buys ? r.notified / r.buys.buys : null);
// T-5 の収集が薄い期間（2026年6月は 5%）は、比べたレースの顔ぶれが違うので比べない。
const gap = (r: Row) => (r.v3LogLoss != null && r.calibratedLogLoss != null && r.comparedRaces >= 200 && (r.t5Coverage ?? 0) >= 0.2 ? r.v3LogLoss - r.calibratedLogLoss : null);
const w0 = byKey.get("w0")!, w1 = byKey.get("w1")!, m0 = byKey.get("m0")!, m1 = byKey.get("m1")!;
const verdicts = [
  { metric: "締切前に通知できた BUY の割合", week: arrow(share(w0), share(w1), true, 0.05), month: arrow(share(m0), share(m1), true, 0.05) },
  { metric: "判定の記録の量（判定 ÷ 番組）", week: arrow(w0.decisionCoverage, w1.decisionCoverage, true, 0.05), month: arrow(m0.decisionCoverage, m1.decisionCoverage, true, 0.05) },
  { metric: "T-5 の収集カバー率", week: arrow(w0.t5Coverage, w1.t5Coverage, true, 0.05), month: arrow(m0.t5Coverage, m1.t5Coverage, true, 0.05) },
  // logloss の値そのものは、期間に含まれるレースで上下する。同じレースでの市場補正との差（小さいほど v3 が市場に近い）で比べる。
  { metric: "v3 の確率の精度（市場補正との logloss の差）", week: arrow(gap(w0), gap(w1), false, 0.002), month: arrow(gap(m0), gap(m1), false, 0.002) },
];

const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(0)}%`);
const num = (v: number | null, d = 4) => (v == null ? "-" : v.toFixed(d));
const tableRow = (r: Row) => `| ${r.label}（${r.from.slice(5)}〜${r.to.slice(5)}） | ${r.buys.buys} | ${formatTally(r.buys)} | ${r.buys.buys ? `${r.notified}/${r.buys.buys}` : "-"} | ${pct(r.decisionCoverage)} | ${pct(r.t5Coverage)} | ${r.comparedRaces} | ${num(gap(r))} | ${num(r.v3BuyRatio, 2)} |`;
const head = "| 期間 | BUY | 成績（100円ずつ） | 締切前に通知 | 判定/番組 | T-5 カバー率 | 精度の比較レース | logloss の差（v3 − 市場補正） | BUY の実績/予測 |\n|---|---:|---|---:|---:|---:|---:|---:|---:|";
const months = [...new Set([...monthWindows.map((w) => w.key), ...knowledgeByMonth.keys(), ...workByMonth.keys()])].filter((m) => m >= MONTHS_FROM && m <= TO.slice(0, 7)).sort();
const md = [
  "# 成長レポート",
  "",
  `生成: ${new Date().toISOString()} / 基準日: ${TO} / DB は読み取り専用`,
  "",
  "## 良くなっているか（前の期間と比べて）",
  "",
  "| 指標 | 1週間前と比べて | 1か月前と比べて |",
  "|---|---|---|",
  ...verdicts.map((v) => `| ${v.metric} | ${v.week} | ${v.month} |`),
  "",
  "## 直近と、その前",
  "",
  head,
  ...recentWindows.map((w) => tableRow(byKey.get(w.key)!)),
  "",
  ...(monthWindows.length ? ["## 月別（半年の推移）", "", head, ...monthWindows.map((w) => tableRow(byKey.get(w.key)!)), ""] : []),
  "## 知識と作業（月別）",
  "",
  "| 月 | 教訓（lessons-learned） | 研究基盤のコミット | 通知・収集・精度のコミット | 記録のコミット | その他 |",
  "|---|---:|---:|---:|---:|---:|",
  ...months.map((m) => { const w = workByMonth.get(m) ?? {}; return `| ${m} | ${knowledgeByMonth.get(m) ?? 0} | ${w["研究基盤"] ?? 0} | ${w["通知・収集・精度"] ?? 0} | ${w["記録"] ?? 0} | ${w["その他"] ?? 0} |`; }),
  "",
  `- レビュー・監査の文書: ${reviewDocs.length} 件（docs/reviews/）`,
  "- 確率の精度と T-5 カバー率は 2026-07-01 以降（T-5 のオッズがそろう期間）の同じレースで、v3 と市場補正の logloss の差を見る（小さいほど v3 が市場に近い。比較レースが 200 未満の期間は「-」）。BUY の実績/予測は 1 に近いほど正確（BUY が 10件未満の期間は「-」）。",
  "",
].join("\n");
const report = { generatedAt: new Date().toISOString(), to: TO, rows: rows.map((r) => ({ ...r, logLossGap: gap(r) })), verdicts, knowledgeByMonth: Object.fromEntries(knowledgeByMonth), workByMonth: Object.fromEntries(workByMonth), reviewDocs: reviewDocs.length, knowledgeAdded };
if (OUTPUT) writeFileSync(OUTPUT, md, "utf8"); else process.stdout.write(md);
if (JSON_OUTPUT) writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
