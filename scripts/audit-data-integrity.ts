/**
 * 過去のデータが合っているかを確かめる監査（読み取り専用。DB にもリポジトリにも書かない）。
 *
 * 1. 日ごとの番組と結果の件数（結果の欠け・返還・3連単が空の行）
 * 2. K ファイル（公式の結果アーカイブ）の有無
 * 3. 全券種の払戻（race_payouts）と結果（race_results）の 3連単の払戻の一致
 * 4. 各艇の着順（race_entries）から作った 3連単と、結果の 3連単の一致（パーサーの検算）
 * 5. 判定（decision_history）の行が、締切より後に作られていないか（2026-10-10 以降は 0 のはず）
 *
 * 使い方: npx tsx scripts/audit-data-integrity.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LIVE_MONITOR_MODEL_VERSION } from "../src/domain/liveMonitor";
import { parseDbTimestamp } from "../src/domain/accuracyScorecard";
import { LIVE_RECORD_FIX_DATE } from "./lib/buyLedger";
import { addDays, todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TO = arg("--to") ?? addDays(todayJst(), -1);
const FROM = arg("--from") ?? addDays(TO, -59);

const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
db.exec("PRAGMA query_only=ON;");

type Day = { date: string; programs: number; results: number; returned: number; emptyTrifecta: number; payoutsTrifecta: number; payoutMismatch: number; entriesRaces: number; entryMismatch: number; kFile: boolean };
const byDate = new Map<string, Day>();
const day = (date: string) => {
  let d = byDate.get(date);
  if (!d) byDate.set(date, (d = { date, programs: 0, results: 0, returned: 0, emptyTrifecta: 0, payoutsTrifecta: 0, payoutMismatch: 0, entriesRaces: 0, entryMismatch: 0, kFile: false }));
  return d;
};
for (const r of db.prepare(`SELECT date, COUNT(*) n FROM official_programs WHERE date BETWEEN ? AND ? GROUP BY date`).all(FROM, TO) as Array<{ date: string; n: number }>) day(r.date).programs = r.n;
for (const r of db.prepare(`SELECT date, COUNT(*) n, SUM(returned != 0) ret, SUM((trifecta IS NULL OR trifecta = '') AND returned = 0) empty
  FROM race_results WHERE date BETWEEN ? AND ? GROUP BY date`).all(FROM, TO) as Array<{ date: string; n: number; ret: number; empty: number }>) {
  const d = day(r.date); d.results = r.n; d.returned = r.ret; d.emptyTrifecta = r.empty;
}
// 3. 全券種の払戻と結果の 3連単の一致
for (const r of db.prepare(`SELECT rr.date, COUNT(rp.race_id) n,
    SUM(CASE WHEN rp.race_id IS NOT NULL AND rr.returned = 0 AND rr.payout_yen IS NOT NULL AND rp.payout_yen != rr.payout_yen THEN 1 ELSE 0 END) mismatch
  FROM race_results rr LEFT JOIN race_payouts rp ON rp.race_id = rr.race_id AND rp.bet_type = 'trifecta' AND rp.combination = rr.trifecta
  WHERE rr.date BETWEEN ? AND ? GROUP BY rr.date`).all(FROM, TO) as Array<{ date: string; n: number; mismatch: number }>) {
  const d = day(r.date); d.payoutsTrifecta = r.n; d.payoutMismatch = r.mismatch;
}
// 4. 着順から作った 3連単と結果の一致
const firstThree = db.prepare(`SELECT re.race_id, re.date, rr.trifecta,
    MAX(CASE WHEN re.finish_pos = 1 THEN re.boat END) b1, MAX(CASE WHEN re.finish_pos = 2 THEN re.boat END) b2, MAX(CASE WHEN re.finish_pos = 3 THEN re.boat END) b3,
    SUM(re.finish_pos = 1) n1
  FROM race_entries re JOIN race_results rr ON rr.race_id = re.race_id
  WHERE re.date BETWEEN ? AND ? AND rr.returned = 0 AND rr.trifecta IS NOT NULL
  GROUP BY re.race_id`).all(FROM, TO) as Array<{ race_id: string; date: string; trifecta: string; b1: number | null; b2: number | null; b3: number | null; n1: number }>;
const entryMismatches: string[] = [];
for (const r of firstThree) {
  const d = day(r.date); d.entriesRaces += 1;
  if (r.n1 !== 1) continue; // 同着は比べない
  if (`${r.b1}-${r.b2}-${r.b3}` !== r.trifecta) { d.entryMismatch += 1; if (entryMismatches.length < 10) entryMismatches.push(`${r.race_id}: 着順 ${r.b1}-${r.b2}-${r.b3} / 結果 ${r.trifecta}`); }
}
// 2. K ファイル
for (const d of byDate.values()) d.kFile = existsSync(`data/raw/official/results/k${d.date.slice(2).replaceAll("-", "")}.lzh`);

// 5・6. 判定と通知の時刻
type Dec = { race_id: string; date: string; decision: string; close_at: string | null; created_at: string; sent_at: string | null };
const decisions = db.prepare(`SELECT d.race_id, d.date, d.decision, p.close_at, d.created_at,
    (SELECT n.sent_at FROM notification_log n WHERE n.race_id = d.race_id AND n.channel = 'line' AND n.status = 'SENT') sent_at
  FROM decision_history d LEFT JOIN official_programs p ON p.race_id = d.race_id
  WHERE d.run_kind = 'paper-live' AND d.model_version = ? AND d.date BETWEEN ? AND ?`).all(LIVE_MONITOR_MODEL_VERSION, FROM, TO) as Dec[];
db.close();
const closeMs = (d: Dec) => (d.close_at ? Date.parse(`${d.date}T${d.close_at}:00+09:00`) : null);
const createdAfterClose = decisions.filter((d) => { const c = closeMs(d); const t = parseDbTimestamp(d.created_at); return c != null && t != null && t > c; });
const fixedPeriod = createdAfterClose.filter((d) => d.date >= LIVE_RECORD_FIX_DATE);
const decisionsPerDay = new Map<string, number>();
for (const d of decisions) decisionsPerDay.set(d.date, (decisionsPerDay.get(d.date) ?? 0) + 1);

// 出力
const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
const issues: string[] = [];
const missingResults = days.filter((d) => d.programs > 0 && d.results < d.programs);
if (missingResults.length) issues.push(`結果が番組より少ない日: ${missingResults.length} 日（${missingResults.slice(0, 8).map((d) => `${d.date} ${d.results}/${d.programs}`).join(", ")}${missingResults.length > 8 ? " ほか" : ""}）`);
const noK = days.filter((d) => d.results > 0 && !d.kFile);
if (noK.length) issues.push(`結果はあるのに K ファイルが手元に無い日: ${noK.length} 日（${noK.slice(0, 6).map((d) => d.date).join(", ")}${noK.length > 6 ? " ほか" : ""}）。全券種の払戻の埋め戻しができない`);
const noPayouts = days.filter((d) => d.results > 0 && d.payoutsTrifecta === 0);
if (noPayouts.length) issues.push(`全券種の払戻が無い日: ${noPayouts.length} 日（${noPayouts[0].date}〜${noPayouts.at(-1)!.date}）`);
const payoutMismatch = days.reduce((a, d) => a + d.payoutMismatch, 0);
if (payoutMismatch) issues.push(`全券種の払戻と結果の 3連単の払戻が食い違う: ${payoutMismatch} 件`);
const entryMismatch = days.reduce((a, d) => a + d.entryMismatch, 0);
if (entryMismatch) issues.push(`着順と結果の 3連単が食い違う: ${entryMismatch} 件（例: ${entryMismatches.slice(0, 3).join(" / ")}）`);
const empty = days.reduce((a, d) => a + d.emptyTrifecta, 0);
if (empty) issues.push(`返還でないのに 3連単が空の結果: ${empty} 件`);
if (fixedPeriod.length) issues.push(`${LIVE_RECORD_FIX_DATE} 以降に、締切より後に作られた判定の行: ${fixedPeriod.length} 件（${fixedPeriod.slice(0, 5).map((d) => d.race_id).join(", ")}）`);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
console.log([
  "# データ監査",
  "",
  `期間: ${FROM}〜${TO} / 読み取り専用`,
  "",
  "## 見つかった問題",
  "",
  issues.length ? issues.map((i) => `- ${i}`).join("\n") : "- なし",
  "",
  "## 要約",
  "",
  `- 番組 ${days.reduce((a, d) => a + d.programs, 0)} / 結果 ${days.reduce((a, d) => a + d.results, 0)}（返還 ${days.reduce((a, d) => a + d.returned, 0)}）`,
  `- 全券種の払戻がある結果: ${days.reduce((a, d) => a + d.payoutsTrifecta, 0)}（食い違い ${payoutMismatch}）`,
  `- 着順と照合できた結果: ${firstThree.length}（食い違い ${entryMismatch}）`,
  `- 判定の行（paper-live）: ${decisions.length} / うち締切より後に作られた行 ${createdAfterClose.length}（${LIVE_RECORD_FIX_DATE} 以降 ${fixedPeriod.length}）`,
  "",
  "## 日ごと",
  "",
  "| 日付 | 番組 | 結果 | 返還 | 払戻(3連単) | 着順照合 | K | 判定行 | 判定/番組 |",
  "|---|---:|---:|---:|---:|---:|---|---:|---:|",
  ...days.map((d) => `| ${d.date} | ${d.programs} | ${d.results} | ${d.returned} | ${d.payoutsTrifecta} | ${d.entriesRaces} | ${d.kFile ? "○" : "×"} | ${decisionsPerDay.get(d.date) ?? 0} | ${pct(decisionsPerDay.get(d.date) ?? 0, d.programs)} |`),
  "",
].join("\n"));
