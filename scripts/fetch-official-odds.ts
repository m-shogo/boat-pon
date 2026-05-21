import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const venueCodes: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

const MIN_CACHE_MINUTES = 5;

export type FetchOfficialOddsArgs = {
  date: string;
  venue: string;
  raceNo: number;
  forceRefresh?: boolean;
};

export type FetchOfficialOddsResult = {
  cached: boolean;
  html: string;
  url: string;
  path: string;
};

export async function fetchOfficialOdds(args: FetchOfficialOddsArgs): Promise<FetchOfficialOddsResult> {
  const jcd = venueCodes[args.venue];
  if (!jcd) throw new Error(`unknown venue: ${args.venue}`);

  const hd = args.date.replaceAll("-", "");
  const outDir = path.join("data", "raw", "official", "odds", args.date);
  const outPath = path.join(outDir, `${jcd}-${String(args.raceNo).padStart(2, "0")}.html`);
  const url = `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${args.raceNo}&jcd=${jcd}&hd=${hd}`;

  if (!args.forceRefresh && (await isFresh(outPath))) {
    return { cached: true, html: await readFile(outPath, "utf8"), url, path: outPath };
  }

  const res = await fetch(url, {
    headers: { "user-agent": "BoatPon/0.1 personal low-frequency cache fetch" },
  });
  if (!res.ok) throw new Error(`official odds fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, html, "utf8");
  return { cached: false, html, url, path: outPath };
}

async function isFresh(filePath: string) {
  try {
    const info = await stat(filePath);
    return Date.now() - info.mtimeMs < MIN_CACHE_MINUTES * 60_000;
  } catch {
    return false;
  }
}

if (process.argv[1]?.endsWith("fetch-official-odds.ts")) {
  const [date, venue, raceNoStr] = process.argv.slice(2);
  if (!date || !venue || !raceNoStr) {
    console.error("usage: tsx scripts/fetch-official-odds.ts <YYYY-MM-DD> <venue> <raceNo>");
    process.exit(1);
  }
  const result = await fetchOfficialOdds({ date, venue, raceNo: Number(raceNoStr) });
  console.log(`${result.cached ? "cache" : "fetched"}: ${result.path}`);
}
