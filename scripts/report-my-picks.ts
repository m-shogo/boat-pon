/**
 * あなたの予想の採点（読み取りだけ。2026-11-19〜）。締切5分前の市場補正の確率と同じ物差しで比べる。
 * 実際の的中 ÷ 市場の見込みの的中 が 1 を超え続けるなら、市場が見落としていることを感覚で拾えている。
 * 使い方: npx tsx scripts/report-my-picks.ts [--from YYYY-MM-DD]
 */
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { calibratedMarketProbabilities } from "../src/domain/accuracyScorecard";
import { NO_TRIFECTA_FACTS, settleTrifectaBuy } from "../src/domain/buySettlement";
import { recordedBeforeClose, summarizeMyPicks, type MyPick, type ScoredPick } from "../src/domain/myPicks";
import { loadChampionCalibration, loadCompleteCaptures, todayJst } from "./lib/marketCaptures";
import { loadTrifectaFacts } from "./lib/trifectaFacts";

const args = process.argv.slice(2);
const from = (() => { const i = args.indexOf("--from"); return i >= 0 ? args[i + 1] : "2026-11-19"; })();
const path = "data/my-picks/picks.jsonl";
const raw = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as MyPick]; } catch { return []; } }) : [];
const dateOf = (raceId: string) => `${raceId.slice(0, 4)}-${raceId.slice(4, 6)}-${raceId.slice(6, 8)}`;
const picks = raw.filter((p) => dateOf(p.raceId) >= from && recordedBeforeClose(p.recordedAt, dateOf(p.raceId), p.closeAt));
if (picks.length === 0) { console.log(`あなたの予想: まだ記録が無い（${path}）`); process.exit(0); }
const db = new DatabaseSync(process.env.BOAT_PON_DB_URI ?? "data/boat.sqlite", { readOnly: true });
const facts = loadTrifectaFacts(db, picks.map((p) => p.raceId));
const { t5, t10, t20 } = loadCompleteCaptures(db, from, todayJst());
db.close();
const champion = loadChampionCalibration();
const market = new Map<string, Map<string, number> | null>();
const scored: Array<ScoredPick & { pick: MyPick }> = picks.map((pick) => {
  if (!market.has(pick.raceId)) { const odds = t5.get(pick.raceId); market.set(pick.raceId, odds ? calibratedMarketProbabilities(odds, t10.get(pick.raceId) ?? t20.get(pick.raceId) ?? null, champion) : null); }
  const settlement = settleTrifectaBuy(pick.selection, facts.get(pick.raceId) ?? NO_TRIFECTA_FACTS);
  return { pick, status: settlement.status, payoutYen: settlement.status === "hit" ? settlement.payoutYen : null, marketProbability: market.get(pick.raceId)?.get(pick.selection) ?? null };
});
const s = summarizeMyPicks(scored);
const pct = (v: number | null) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
console.log(`あなたの予想（${from}〜）: ${s.picks} 点・精算 ${s.settled}・的中 ${s.hits}・返還 ${s.returned}・結果待ち ${s.pending}`);
console.log(`市場の見込みの的中 ${s.marketExpectedHits?.toFixed(2) ?? "-"} に対して 実際 ÷ 見込み ${s.actualToMarket?.toFixed(2) ?? "-"}（z ${s.z?.toFixed(1) ?? "-"}）・100 円ずつの回収率 ${pct(s.officialRoi)}（公式の払戻）`);
for (const r of scored.slice(-10).reverse()) console.log(`- ${r.pick.raceId} ${r.pick.selection}: ${{ hit: "的中", miss: "はずれ", returned: "返還", pending: "結果待ち" }[r.status]}${r.payoutYen ? ` ${r.payoutYen}円` : ""}・市場の確率 ${pct(r.marketProbability)}${r.pick.note ? `・${r.pick.note}` : ""}`);
