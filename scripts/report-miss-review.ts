import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";
import { parseRollingReportOptions } from "../src/research-replay/rollingReportOptions";
import { buildMissReview, type MissReviewRow } from "../src/presentation/missReview";
import { compactTable } from "../src/presentation/reviewReportText";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("pnpm report:miss-review -- --from YYYY-MM-DD --to YYYY-MM-DD [--json] [--detail]\n既定は日本時間の今日までの直近30日。読み取り専用・送信なし。");
  process.exit(0);
}
const options = parseRollingReportOptions(argv.filter((arg) => arg !== "--detail"), 30);
const to = options.to ?? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const from = options.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - (options.days - 1) * 86400000).toISOString().slice(0, 10);
if (from > to) throw new Error("MISS_REVIEW_INVALID_DATE_RANGE");
const dbPath = assertCanonicalSingleLinkRegularFile(process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite", "MISS_REVIEW_DB_IDENTITY_INVALID");
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000");
try {
  const rows = db.prepare(`
    WITH buys AS (
      SELECT dh.*, CASE dh.bet_type
        WHEN '3連単' THEN 'trifecta' WHEN '3連複' THEN 'trio'
        WHEN '2連単' THEN 'exacta' WHEN '2連複' THEN 'quinella' WHEN '拡連複' THEN 'wide'
        ELSE dh.bet_type END AS payout_type
      FROM decision_history dh WHERE dh.decision = 'BUY' AND dh.date >= ? AND dh.date <= ?
    )
    SELECT dh.race_id AS raceId, dh.venue, dh.race_no AS raceNo, dh.bet_type AS betType,
      dh.selection, rr.trifecta AS result, dh.returned, rr.returned AS officialReturned,
      dh.estimated_hit_rate AS estimatedHitRate, dh.current_odds AS currentOdds, dh.ev,
      dh.recommended_stake_yen AS recommendedStakeYen, dh.actually_bought AS actuallyBought,
      dh.stake_yen AS stakeYen, dh.model_version AS modelVersion, dh.run_kind AS runKind,
      (SELECT COUNT(*) FROM race_payouts rp WHERE rp.race_id = dh.race_id AND rp.bet_type = dh.payout_type AND rp.combination = dh.selection AND rp.returned = 0) AS payoutMatches,
      (SELECT MIN(rp.payout_yen) FROM race_payouts rp WHERE rp.race_id = dh.race_id AND rp.bet_type = dh.payout_type AND rp.combination = dh.selection AND rp.returned = 0) AS officialPayoutYen,
      (SELECT COUNT(*) FROM race_payouts rp WHERE rp.race_id = dh.race_id AND rp.bet_type = dh.payout_type AND rp.returned = 0 AND rp.payout_yen > 0) AS validPayoutRows
    FROM buys dh LEFT JOIN race_results rr ON rr.race_id = dh.race_id
    ORDER BY dh.date, dh.race_id, dh.id
  `).all(from, to) as MissReviewRow[];
  const report = buildMissReview(rows, from, to);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
} finally { db.close(); }

function printReport(report: ReturnType<typeof buildMissReview>) {
  const s = report.summary;
  const percent = (value: number | null) => value == null ? "未算出" : `${(value * 100).toFixed(2)}%`;
  const amount = (value: number | null) => value == null ? "未確定" : `${value.toLocaleString("ja-JP")}円`;
  console.log(`${report.from}〜${report.to} BUY確定 ${s.count}件 / 的中 ${s.hits}件（予想 ${s.expectedHits?.toFixed(2) ?? "算出不可"}件）。`);
  console.log(`この的中数以下の確率 ${percent(s.lowerTailProbability)} → ${s.judgement}（独立・同率の二項近似）。`);
  console.log(`仮想投入 ${amount(report.money.paper.investedYen)} / 実払戻換算 ${amount(report.money.paper.payoutYen)} / ROI ${percent(report.money.paper.roi)}。`);
  console.log(`\n${report.probabilityEvidence}\n${report.method}`);
  console.log(`対象は保存BUY判定行（同一レースの複数判定を含み得る）。確定レース ${report.uniqueRaces}件。`);
  console.log(`対象外：返還 ${report.excluded.returned}件 / 公式結果未確定 ${report.excluded.pending}件 / 券種未対応 ${report.excluded.unsupportedBetType}件 / 買い目不正 ${report.excluded.invalidSelection}件。予想率不正 ${s.invalidProbabilities}件。`);
  if (argv.includes("--detail")) { console.log(JSON.stringify(report, null, 2)); return; }
  compactTable("的中率の当たり具合", report.calibration, [
    ["予想率帯", (r) => r.label], ["件数", (r) => r.count], ["予想的中", (r) => r.expectedHits], ["実際の的中", (r) => r.hits], ["予想率", (r) => percent(r.predictedRate)], ["実際の率", (r) => percent(r.actualRate)],
  ]);
  compactTable("外れ方（着順の内訳は3連単のみ）", [
    { label: "1着から違う", count: report.missPatterns.first }, { label: "1着一致・2着違い", count: report.missPatterns.second },
    { label: "2着まで一致・3着違い", count: report.missPatterns.third }, { label: "他券種", count: report.missPatterns.other },
  ], [["外れ方", (r) => r.label], ["件数", (r) => r.count]]);
  for (const [title, rows] of [["会場別", report.conditions.venue], ["オッズ帯別", report.conditions.odds], ["EV帯別", report.conditions.ev], ["レース番号別", report.conditions.raceNo], ["モデル・実行種別", report.cohorts]] as const) {
    compactTable(title, rows, [["条件", (r) => r.label], ["件数", (r) => r.count], ["的中", (r) => r.hits], ["予想的中", (r) => r.expectedHits], ["扱い", (r) => r.smallSample ? "少数・参考（結論に使わない）" : "記述集計"]]);
  }
  console.log(`\n${report.money.basis}`);
  compactTable("お金（current_odds は参考のみ）", [{ label: "推奨額で仮想投入", ...report.money.paper }, { label: "記録された実購入", ...report.money.actual }], [
    ["対象", (r) => r.label], ["投入", (r) => amount(r.investedYen)], ["公式払戻", (r) => amount(r.payoutYen)], ["ROI", (r) => percent(r.roi)], ["参考オッズROI", (r) => percent(r.currentOddsRoi)], ["払戻欠損", (r) => r.missingPayouts],
  ]);
}
