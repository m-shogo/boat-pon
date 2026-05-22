/**
 * 未取得日リストから並列で公式LZHを取得・解凍・SQLite取り込み。
 *
 * usage:
 *   tsx scripts/fetch-pending-parallel.ts k   # race_results 未取得日
 *   tsx scripts/fetch-pending-parallel.ts b   # official_programs 未取得日
 *   tsx scripts/fetch-pending-parallel.ts all # 両方順次
 *
 * 並列上限 3、各リクエスト後に sleep 800ms。公式サーバーに優しい。
 * 404は永続失敗扱いでログ、ネットワークエラーはリトライ対象としてログのみ。
 * busy_timeout 30秒で SQLite ロック競合を吸収。
 */
import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseOfficialResultsText } from "../src/domain/officialResultParser";
import { parseOfficialProgramsText } from "../src/domain/officialProgramParser";
import { insertOfficialProgram, insertResult, openDb } from "../server/db";

const execFile = promisify(execFileCb);

const CONCURRENCY = Number(process.env.BOAT_PON_PARALLEL ?? 3);
const REQUEST_GAP_MS = Number(process.env.BOAT_PON_GAP_MS ?? 800);

type Kind = "k" | "b";

const CONFIG: Record<Kind, {
  rawDir: string;
  tmpDir: string;
  pendingFile: string;
  urlPrefix: string;
  txtPrefix: string;
  lzhPrefix: string;
}> = {
  k: {
    rawDir: path.join("data", "raw", "official", "results"),
    tmpDir: path.join("data", "tmp"),
    pendingFile: path.join("data", "fetch-pending-k.txt"),
    urlPrefix: "https://www1.mbrace.or.jp/od2/K/",
    txtPrefix: "K",
    lzhPrefix: "k",
  },
  b: {
    rawDir: path.join("data", "raw", "official", "programs"),
    tmpDir: path.join("data", "tmp", "programs"),
    pendingFile: path.join("data", "fetch-pending-b.txt"),
    urlPrefix: "https://www1.mbrace.or.jp/od2/B/",
    txtPrefix: "B",
    lzhPrefix: "b",
  },
};

async function main() {
  const target = (process.argv[2] ?? "all").toLowerCase();
  if (target === "all") {
    await runKind("k");
    await runKind("b");
  } else if (target === "k" || target === "b") {
    await runKind(target);
  } else {
    console.error("usage: tsx scripts/fetch-pending-parallel.ts <k|b|all>");
    process.exit(1);
  }
}

async function runKind(kind: Kind) {
  const config = CONFIG[kind];
  if (!existsSync(config.pendingFile)) {
    console.error(`pending file not found: ${config.pendingFile} (先に list-pending-dates を実行してください)`);
    return;
  }
  const raw = await readFile(config.pendingFile, "utf8");
  const dates = raw.split("\n").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  if (dates.length === 0) {
    console.log(`[${kind}] 未取得日なし。完了。`);
    return;
  }

  await mkdir(config.rawDir, { recursive: true });
  await mkdir(config.tmpDir, { recursive: true });

  const db = openDb();
  const fetchedAt = new Date().toISOString();

  console.log(`[${kind}] ${dates.length}日を並列${CONCURRENCY}で処理開始`);
  const counters = { ok: 0, cached: 0, notFound: 0, error: 0, parseFail: 0 };

  let cursor = 0;
  async function worker(workerId: number) {
    while (true) {
      const myIndex = cursor;
      cursor += 1;
      if (myIndex >= dates.length) return;
      const date = dates[myIndex];
      await processOne(kind, date, db, fetchedAt, counters);
      await sleep(REQUEST_GAP_MS);
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  db.close();

  console.log(`[${kind}] 完了: ok=${counters.ok} cached=${counters.cached} notFound=${counters.notFound} parseFail=${counters.parseFail} error=${counters.error}`);
}

type Counters = { ok: number; cached: number; notFound: number; error: number; parseFail: number };

async function processOne(kind: Kind, date: string, db: ReturnType<typeof openDb>, fetchedAt: string, counters: Counters) {
  const config = CONFIG[kind];
  const yymmdd = toYymmdd(date);
  const yymm = toYymm(date);
  const lzhPath = path.join(config.rawDir, `${config.lzhPrefix}${yymmdd}.lzh`);
  const url = `${config.urlPrefix}${yymm}/${config.lzhPrefix}${yymmdd}.lzh`;

  // 1. LZH 取得 (キャッシュ済はスキップ)
  if (!existsSync(lzhPath)) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "BoatPon/0.1 personal low-frequency cache fetch" },
      });
      if (res.status === 404) {
        counters.notFound += 1;
        return;
      }
      if (!res.ok) {
        counters.error += 1;
        console.warn(`[${kind}] ${date} HTTP ${res.status}`);
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(lzhPath, buf);
      counters.ok += 1;
    } catch (err) {
      counters.error += 1;
      console.warn(`[${kind}] ${date} fetch error: ${err instanceof Error ? err.message : err}`);
      return;
    }
  } else {
    counters.cached += 1;
  }

  // 2. 解凍 & パース & SQLite取り込み
  try {
    const expectedTxt = path.join(config.tmpDir, `${config.txtPrefix}${yymmdd.toUpperCase()}.TXT`);
    if (existsSync(expectedTxt)) await rm(expectedTxt);
    await execFile("unar", ["-q", "-o", config.tmpDir, "-f", lzhPath]);
    const buf = await readFile(expectedTxt);
    const text = new TextDecoder("shift_jis").decode(buf);

    if (kind === "k") {
      const results = parseOfficialResultsText(text, { date, fetchedAt });
      for (const row of results) insertResult(db, row);
    } else {
      const rows = parseOfficialProgramsText(text, { date });
      for (const row of rows) {
        const raceId = `${row.date.replaceAll("-", "")}-${row.venue}-${String(row.raceNo).padStart(2, "0")}`;
        insertOfficialProgram(db, {
          raceId,
          date: row.date,
          venue: row.venue,
          raceNo: row.raceNo,
          closeAt: row.closeAt,
          sourceFile: `${config.lzhPrefix}${yymmdd}.lzh`,
          raw: row,
        });
      }
    }
  } catch (err) {
    counters.parseFail += 1;
    console.warn(`[${kind}] ${date} parse error: ${err instanceof Error ? err.message : err}`);
  }
}

function toYymm(ymd: string): string {
  return ymd.slice(0, 7).replace("-", "");
}

function toYymmdd(ymd: string): string {
  return ymd.slice(2).replaceAll("-", "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
