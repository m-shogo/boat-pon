/**
 * 直前情報の取りこぼしを、締切の後に公式の直前情報のページから埋める（2026-11-20〜。用途: 精度・監査）。
 * 新しい種類の取得ではない（auto-exhibition と同じページ）。締切を過ぎたレースだけ・新しい日から順に・1.5 秒以上あけて・1 回 --limit ページまで。
 *
 * 締切前に取れた記録は上書きしない（「行動できた記録」と取得率の数え方を壊さないため）:
 * - 展示タイムが 6 艇そろっていないレースだけ exhibition_data を書く（source_type = official_backfill、fetched_at は今。締切後の取得として数えられる）
 * - 水面気象・整備は、行が無いときだけ書く
 * - スタート展示の並び・風向きは、行が無いときだけ書く（first_fetched_at は今。締切前に分かっていたかは first_fetched_at と締切で分かる）
 * 使い方: npx tsx scripts/backfill-beforeinfo.ts [--from 2026-07-01] [--to YYYY-MM-DD] [--limit 300] [--dry-run]
 */
import { DatabaseSync } from "node:sqlite";
import { openDb, upsertExhibitionData, upsertRaceEquipment, upsertRaceWeather, upsertRaceWindDirection, upsertStartExhibitionOrder } from "../server/db";
import { parseBeforeInfoHtml } from "../src/domain/beforeInfoParser";
import { venueCodes } from "./fetch-official-odds";
import { todayJst } from "./lib/marketCaptures";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const FROM = arg("--from", "2026-07-01"), TO = arg("--to", todayJst()), LIMIT = Number(arg("--limit", "300"));
const DRY = args.includes("--dry-run");
const INTERVAL_MS = 1_500;
const log = (m: string) => console.log(`[${new Date().toISOString()}] backfill-beforeinfo: ${m}`);

type Need = { raceId: string; date: string; venue: string; raceNo: number; exhibition: boolean; weather: boolean; equipment: boolean; start: boolean; wind: boolean };
function findNeeds(db: DatabaseSync): Need[] {
  const rows = db.prepare(`
SELECT p.race_id, p.date, p.venue, p.race_no,
  (SELECT COUNT(*) FROM exhibition_data e WHERE e.race_id = p.race_id AND e.exhibition_time > 0) ex,
  EXISTS (SELECT 1 FROM race_weather w WHERE w.race_id = p.race_id) has_weather,
  EXISTS (SELECT 1 FROM race_equipment q WHERE q.race_id = p.race_id) has_equipment,
  EXISTS (SELECT 1 FROM start_exhibition_order s WHERE s.race_id = p.race_id) has_start,
  EXISTS (SELECT 1 FROM race_wind_direction d WHERE d.race_id = p.race_id) has_wind
FROM official_programs p
WHERE p.date >= ? AND p.date <= ? AND julianday(p.date || ' ' || p.close_at, '-9 hours') < julianday('now', '-10 minutes')
ORDER BY p.date DESC, p.close_at DESC`).all(FROM, TO) as Array<{ race_id: string; date: string; venue: string; race_no: number; ex: number; has_weather: number; has_equipment: number; has_start: number; has_wind: number }>;
  return rows
    .map((r) => ({ raceId: r.race_id, date: r.date, venue: r.venue, raceNo: Number(r.race_no), exhibition: r.ex < 6, weather: !r.has_weather, equipment: !r.has_equipment, start: !r.has_start, wind: !r.has_wind }))
    .filter((n) => n.exhibition || n.weather || n.equipment || n.start || n.wind);
}

const db = openDb();
const needs = findNeeds(db);
log(`${FROM}〜${TO}: 埋める必要があるレース ${needs.length}（展示 ${needs.filter((n) => n.exhibition).length}・並び ${needs.filter((n) => n.start).length}・風向き ${needs.filter((n) => n.wind).length}）。今回は最大 ${LIMIT}${DRY ? "（試し・書かない）" : ""}`);
const counts = { fetched: 0, empty: 0, failed: 0, exhibition: 0, weather: 0, equipment: 0, start: 0, wind: 0 };
for (const need of needs.slice(0, DRY ? 0 : LIMIT)) {
  const jcd = venueCodes[need.venue];
  if (!jcd) { counts.failed += 1; continue; }
  const url = `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${need.raceNo}&jcd=${jcd}&hd=${need.date.replaceAll("-", "")}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "BoatPon/0.1 personal low-frequency fetch" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseBeforeInfoHtml(await res.text());
    counts.fetched += 1;
    const at = new Date().toISOString();
    let wrote = false;
    if (need.exhibition && parsed.exhibition.filter((e) => e.exhibitionTime != null && e.exhibitionTime > 0).length === 6) { upsertExhibitionData(db, need.raceId, parsed.exhibition, at, "official_backfill"); counts.exhibition += 1; wrote = true; }
    if (need.weather && parsed.weather) { upsertRaceWeather(db, need.raceId, parsed.weather, at, "official_backfill"); counts.weather += 1; wrote = true; }
    if (need.equipment && parsed.equipment.length === 6) { upsertRaceEquipment(db, need.raceId, parsed.equipment, at, "official_backfill"); counts.equipment += 1; wrote = true; }
    if (need.start && parsed.startExhibition.length > 0) { upsertStartExhibitionOrder(db, need.raceId, parsed.startExhibition, at); counts.start += 1; wrote = true; }
    if (need.wind && parsed.windDirection?.windCode != null) { upsertRaceWindDirection(db, need.raceId, parsed.windDirection, at); counts.wind += 1; wrote = true; }
    if (!wrote) counts.empty += 1;
  } catch (error) {
    counts.failed += 1;
    log(`取れない ${need.raceId}: ${(error as Error).message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
log(`done: ページ ${counts.fetched}・何も書けない ${counts.empty}・失敗 ${counts.failed}／書いた 展示 ${counts.exhibition}・水面気象 ${counts.weather}・整備 ${counts.equipment}・並び ${counts.start}・風向き ${counts.wind}／残り ${Math.max(0, needs.length - (DRY ? 0 : Math.min(LIMIT, needs.length)))}`);
