import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

const url = "https://kyotei24.jp/sp/kekka_all.php";
// ファイル名・インポート対象はJST日付を使う（UTCだとズレるため）
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const outDir = path.join("data", "raw", "kyotei24", "results");
const outPath = path.join(outDir, `${date}.html`);
const minCacheMinutes = 60;

async function isFresh(filePath: string) {
  try {
    const info = await stat(filePath);
    return Date.now() - info.mtimeMs < minCacheMinutes * 60_000;
  } catch {
    return false;
  }
}

if (await isFresh(outPath)) {
  console.log(`cache fresh: ${outPath}`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });

const res = await fetch(url, {
  headers: {
    "user-agent": "BoatPon/0.1 personal low-frequency cache fetch",
  },
});

if (!res.ok) {
  throw new Error(`kyotei24 fetch failed: ${res.status} ${res.statusText}`);
}

const html = await res.text();
await writeFile(outPath, html, "utf8");
console.log(`saved raw html: ${outPath}`);
