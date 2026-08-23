/**
 * 公式2連単ページを1レースだけ取得し、券種付き時系列rowを生成するdry-run。
 * DB INSERT、キャッシュ保存、自動投票、本番判定への接続はしない。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { buildBetTypeAwareOddsRows, assertMarketCoverage } from "../src/domain/betTypeAwareOdds";
import { parseAllExactaOdds } from "../src/domain/exactaOddsParser";
import { parseExactaTimeseriesDryRunOptions } from "../src/research-replay/exactaTimeseriesDryRunOptions";

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05", 浜名湖: "06", 蒲郡: "07",
  常滑: "08", 津: "09", 三国: "10", びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14",
  丸亀: "15", 児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20", 芦屋: "21",
  福岡: "22", 唐津: "23", 大村: "24",
};

const options = parseExactaTimeseriesDryRunOptions(
  process.argv.slice(2),
  new Set(Object.keys(venueCodes)),
);
const { date, venue, raceNo, checkpoint, minutesBeforeClose } = options;

const url = `https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=${raceNo}&jcd=${venueCodes[venue]}&hd=${date.replaceAll("-", "")}`;
const response = await fetch(url, { headers: { "user-agent": "BoatPon/0.1 exacta dry-run" } });
if (!response.ok) throw new Error(`official exacta fetch failed: ${response.status} ${response.statusText}`);
const html = await response.text();
const odds = parseAllExactaOdds(html);
const rows = buildBetTypeAwareOddsRows({
  raceId: `${date}-${venue}-${String(raceNo).padStart(2, "0")}`,
  betType: "exacta",
  oddsBySelection: odds,
  popularity: null,
  source: "official-dry-run",
  capturedAt: new Date().toISOString(),
  minutesBeforeClose,
  checkpointLabel: checkpoint,
});
const coverage = assertMarketCoverage(rows, { activeBoats: 6, requireComplete: false });
const report = {
  generatedAt: new Date().toISOString(),
  safety: { readOnlyDb: true, dbWrites: false, cacheWrites: false, productionConnected: false, autoBetting: false },
  request: { date, venue, raceNo, checkpoint, minutesBeforeClose, url },
  market: { betType: "exacta", rowCount: rows.length, coverage, minOdds: Math.min(...rows.map((row) => row.odds)), maxOdds: Math.max(...rows.map((row) => row.odds)) },
  sample: rows.slice(0, 5),
  migration: { applied: false, reason: "odds_timeseries_snapshotsへのbet_type追加は別途レビュー後に実行" },
};
await mkdir("reports", { recursive: true });
await writeFile("reports/exacta-timeseries-dry-run.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`exacta dry-run: ${venue}${raceNo}R rows=${rows.length} complete=${coverage.complete} report=reports/exacta-timeseries-dry-run.json`);
