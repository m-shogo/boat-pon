/**
 * backfill-exacta-closing-odds.ts
 *
 * 禁止: 既存DBテーブルへの不正INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision 変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * historical closing odds は live/T-5/timeseries odds ではない。
 *
 * 目的: H011 検証「市場価格が4号艇2着の頻度の傾きを織り込んでいるか」の直接比較に必要な
 *   2連単 (exacta) closing odds を公式アーカイブ (odds2tf) から取得し
 *   historical_alternative_odds テーブル (bet_type='exacta') に保存する。
 *
 * 保存組番: デフォルト全30通り (overround正規化に必要)。--h011-only で 1-2/1-3/1-4 の3通りのみ。
 *
 * デフォルト: dry-run。--write 指定時のみ DB に INSERT する。
 *   historical_alternative_odds テーブルが存在しない場合はエラー停止。
 *
 * 使い方:
 *   pnpm backfill:exacta-closing-odds [options]
 *
 *   --dry-run               dry-run (デフォルト。fetch + parse のみ。INSERT しない)
 *   --write                 DB に INSERT する
 *   --limit 30              取得件数上限 (デフォルト 30)
 *   --from YYYY-MM-DD       対象期間開始
 *   --to   YYYY-MM-DD       対象期間終了
 *   --sleep-ms 1000         取得間隔ms (デフォルト 1000)
 *   --h011-only             1-2/1-3/1-4 の3通りのみ保存 (overround正規化不可。デフォルトは全30通り)
 *   --batch-size 30         1バッチ書き込み件数 (デフォルト 30)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH   = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD    = "reports/exacta-closing-odds-backfill.md";
const OUT_JSON  = "reports/exacta-closing-odds-backfill.json";
const CACHE_DIR = "data/raw/official/odds2tf";

const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES  = [10, 11, 12];

const SOURCE_TYPE    = "official_archive";
const SOURCE_QUALITY = "historical_closing_odds";
const PARSER_VERSION = "2.0";  // 行単位パース版 (欠場ページ対応)

const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

// ─── CLI オプション ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function getArg(flag: string, defaultVal: string): string {
  const idx = argv.indexOf(flag);
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : defaultVal;
}
function hasFlag(flag: string): boolean { return argv.includes(flag); }

const WRITE_MODE  = hasFlag("--write") && !hasFlag("--dry-run");
const LIMIT       = parseInt(getArg("--limit", "30"), 10);
const SLEEP_MS    = parseInt(getArg("--sleep-ms", "1000"), 10);
const FROM_DATE   = getArg("--from", "");
const TO_DATE     = getArg("--to", "");
const H011_ONLY   = hasFlag("--h011-only");  // 3通りのみ (overround正規化不可)
const BATCH_SIZE  = parseInt(getArg("--batch-size", "30"), 10);

// H011専用の3通り。デフォルトは全30通りを保存する (overround正規化に必要)
const H011_COMBOS = ["1-2", "1-3", "1-4"];

console.log(`=== exacta closing odds backfill ===`);
console.log(`  モード: ${WRITE_MODE ? "⚠️  WRITE" : "🔍 dry-run"}`);
console.log(`  limit: ${LIMIT} / sleep: ${SLEEP_MS}ms / 組番: ${H011_ONLY ? "1-2/1-3/1-4のみ(overround正規化不可)" : "全30通り"} / batch: ${BATCH_SIZE}`);
if (FROM_DATE) console.log(`  from: ${FROM_DATE}`);
if (TO_DATE)   console.log(`  to:   ${TO_DATE}`);
console.log();

// ─── DB 初期化 ────────────────────────────────────────────────────────────────

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: !WRITE_MODE });
db.exec("PRAGMA busy_timeout = 5000;");

// テーブル存在確認 (bet_type 列が必須)
const tableInfo = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='historical_alternative_odds'`
).get() as { name: string } | undefined;
if (!tableInfo) {
  console.error("ERROR: historical_alternative_odds テーブルが存在しません。先に db:create-historical-alt-odds を実行してください。");
  process.exit(1);
}

const colInfo = db.prepare(
  `SELECT COUNT(*) as n FROM pragma_table_info('historical_alternative_odds') WHERE name='bet_type'`
).get() as { n: number };
if (colInfo.n === 0) {
  console.error("ERROR: bet_type 列がありません。スキーマ変更が必要です。");
  console.error("  ALTER TABLE historical_alternative_odds ADD COLUMN bet_type TEXT NOT NULL DEFAULT 'trifecta';");
  process.exit(1);
}

// ─── 対象レース抽出 ───────────────────────────────────────────────────────────

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

type Race = {
  race_id: string; date: string; venue: string; venue_code: string;
  race_no: number;
};

let dateClause = "AND dh.date >= '2024-01-01'";
if (FROM_DATE) dateClause = `AND dh.date >= '${FROM_DATE}'`;
if (TO_DATE)   dateClause += ` AND dh.date <= '${TO_DATE}'`;

// 完全保存済みレースのみスキップ (20組番以上 = 6艇30通りまたは欠場5艇20通り)
// 3通りしか保存していない部分保存レースは再処理対象とする
const allBuyRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue,
    COALESCE(vc.code, '00') as venue_code,
    dh.race_no
  FROM decision_history dh
  LEFT JOIN (
    SELECT venue, MIN(venue_code) code FROM historical_alternative_odds GROUP BY venue
  ) vc ON vc.venue = dh.venue
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.selection='1-2-3'
    AND dh.venue NOT IN (${excl_v}) AND dh.race_no NOT IN (${excl_r})
    ${dateClause}
  ORDER BY dh.date
`).all() as Race[];

// 会場コードを VENUE_CODES から補完
for (const r of allBuyRaces) {
  r.venue_code = VENUE_CODES[r.venue] ?? r.venue_code;
}

// 事前スキップ: COUNT=30 のみ (6艇完全保存確定)。
// COUNT=20 の欠場レースや COUNT=3 の部分保存は fetch+parse 後に savedCount vs parsedCount で判定。
// これにより「6艇レースが途中停止で20〜29通りだけ保存」されても永久欠損にならない。
const savedSet = new Set(
  (db.prepare(
    `SELECT race_id FROM historical_alternative_odds WHERE bet_type='exacta'
     GROUP BY race_id HAVING COUNT(*) = 30`
  ).all() as { race_id: string }[]).map(r => r.race_id)
);

const missing = allBuyRaces.filter(r => !savedSet.has(r.race_id));
const targets = missing.slice(0, LIMIT);

console.log(`BUY 対象 (2024+): ${allBuyRaces.length}件`);
console.log(`  保存済み: ${savedSet.size}件`);
console.log(`  未取得: ${missing.length}件`);
console.log(`  今回処理: ${targets.length}件 (limit=${LIMIT})`);
console.log();

if (targets.length === 0) {
  console.log("✅ 全件取得済み。処理なし。");
  process.exit(0);
}

// ─── HTML fetch + parse ────────────────────────────────────────────────────────

function makeUrl(r: Race): string | null {
  if (!r.venue_code || r.venue_code === "00") return null;
  const dateStr = r.date.replace(/-/g, "");
  return `https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=${r.race_no}&jcd=${r.venue_code}&hd=${dateStr}`;
}

function cacheFilePath(r: Race): string {
  return `${CACHE_DIR}/${r.date}/${r.venue_code}-${String(r.race_no).padStart(2, "0")}.html`;
}

async function fetchHtml(r: Race): Promise<{ html: string | null; cached: boolean; url: string; error?: string }> {
  const url = makeUrl(r);
  if (!url) return { html: null, cached: false, url: "", error: `unknown venue: ${r.venue}` };
  const cp = cacheFilePath(r);
  if (existsSync(cp)) {
    return { html: readFileSync(cp, "utf-8"), cached: true, url };
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { html: null, cached: false, url, error: `HTTP ${res.status}` };
    const html = await res.text();
    mkdirSync(dirname(cp), { recursive: true });
    writeFileSync(cp, html, "utf-8");
    return { html, cached: false, url };
  } catch (err) {
    return { html: null, cached: false, url: url ?? "", error: String(err) };
  }
}

// 2連単30通りのパース。最初の tbody (2連単テーブル) のみ行単位で解析する。
// 欠場艇がある場合でも2連単テーブルは完全なので行単位パースが安全。
function parseExactaOdds(html: string): { exacta: Record<string, number>; cellCount: number } {
  const tbodyStart = html.indexOf('<tbody class="is-p3-0">');
  if (tbodyStart < 0) return { exacta: {}, cellCount: 0 };
  const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const exacta: Record<string, number> = {};
  let cellCount = 0;
  for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
    // 12td = (2着艇, oddsPoint) × 6列
    for (let col = 0; col < Math.floor(tds.length / 2); col++) {
      const second = tds[col * 2];
      const odds = parseFloat(tds[col * 2 + 1]);
      if (!/^\d$/.test(second) || !Number.isFinite(odds)) continue;
      exacta[`${col + 1}-${second}`] = odds;
      cellCount++;
    }
  }
  return { exacta, cellCount };
}

// ─── INSERT 文 (WRITE モード時のみ使用) ─────────────────────────────────────

const insertStmt = WRITE_MODE ? db.prepare(`
  INSERT OR IGNORE INTO historical_alternative_odds
    (race_id, race_date, venue, venue_code, race_no,
     combination, odds, bet_type,
     source_type, source_quality, source_url,
     fetched_at, parser_version, is_backfill, fetch_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'success')
`) : null;

// ─── 実行ループ ───────────────────────────────────────────────────────────────

type ResultRow = {
  race_id: string; date: string; venue: string;
  status: "ok" | "cached_ok" | "already_complete" | "fetch_error" | "parse_error";
  cellCount: number; parsedCount: number; dbSavedCount: number;
  insertedCount: number; skippedCount: number;
  combosAvailable: string[]; error?: string;
  isFRefund: boolean;
};

const results: ResultRow[] = [];
let totalInserted = 0;
let totalSkipped  = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let batchBuffer: any[][] = [];

async function flushBatch() {
  if (!WRITE_MODE || !insertStmt || batchBuffer.length === 0) return;
  const t = db.prepare("BEGIN");
  const c = db.prepare("COMMIT");
  t.run();
  for (const args of batchBuffer) {
    insertStmt.run(...args);
  }
  c.run();
  batchBuffer = [];
}

const now = new Date().toISOString();

for (const [i, r] of targets.entries()) {
  const prefix = `[${i + 1}/${targets.length}] ${r.race_id}`;
  const f = await fetchHtml(r);

  const row: ResultRow = {
    race_id: r.race_id, date: r.date, venue: r.venue,
    status: "fetch_error", cellCount: 0, parsedCount: 0, dbSavedCount: 0,
    insertedCount: 0, skippedCount: 0,
    combosAvailable: [], isFRefund: false, error: f.error,
  };

  if (!f.html) {
    console.log(`${prefix}${f.cached ? " [cache]" : ""}: ❌ fetch_error: ${f.error}`);
    results.push(row);
    if (!f.cached) await new Promise(s => setTimeout(s, SLEEP_MS));
    continue;
  }

  const { exacta, cellCount } = parseExactaOdds(f.html);
  row.cellCount = cellCount;

  if (cellCount < 20 || exacta["1-2"] == null) {
    row.status = "parse_error";
    console.log(`${prefix}${f.cached ? " [cache]" : ""}: ❌ parse_error cellCount=${cellCount}`);
    results.push(row);
    if (!f.cached) await new Promise(s => setTimeout(s, SLEEP_MS));
    continue;
  }

  row.status = f.cached ? "cached_ok" : "ok";

  // F返還チェック (集計用タグ。保存はする)
  row.isFRefund = ((db.prepare(
    `SELECT COUNT(*) n FROM race_entries WHERE race_id=? AND status_code='F'`
  ).get(r.race_id) as { n: number }).n > 0);

  // 保存対象の組番を決定 (デフォルト: 全30通り。overround正規化に必要)
  const targetCombos = H011_ONLY
    ? H011_COMBOS.filter(c => exacta[c] != null)
    : Object.keys(exacta);

  row.parsedCount = targetCombos.length;
  row.combosAvailable = targetCombos;

  // post-fetch 完了チェック: DB保存数 vs パース数を比較
  // これにより6艇レースが途中停止で20〜29通りだけ保存された場合でも補完できる
  const dbSavedCount = (db.prepare(
    `SELECT COUNT(*) n FROM historical_alternative_odds WHERE race_id=? AND bet_type='exacta'`
  ).get(r.race_id) as { n: number }).n;
  row.dbSavedCount = dbSavedCount;

  if (dbSavedCount >= targetCombos.length) {
    // 完全保存済み (事前スキップの漏れ = 欠場レース等)
    row.status = "already_complete";
    const cTag = f.cached ? " [cache]" : "";
    console.log(`${prefix}${cTag}: ✅ already_complete (saved=${dbSavedCount}/${targetCombos.length})`);
    results.push(row);
    if (!f.cached) await new Promise(s => setTimeout(s, SLEEP_MS));
    continue;
  }

  const fetchedAt = now;
  let inserted = 0;
  let skipped  = 0;

  for (const combo of targetCombos) {
    const odds = exacta[combo];
    if (odds == null) continue;
    if (WRITE_MODE) {
      batchBuffer.push([
        r.race_id, r.date, r.venue, r.venue_code, r.race_no,
        combo, odds, "exacta",
        SOURCE_TYPE, SOURCE_QUALITY, f.url,
        fetchedAt, PARSER_VERSION,
      ]);
      inserted++;
    } else {
      skipped++;
    }
  }

  if (WRITE_MODE && batchBuffer.length >= BATCH_SIZE * (H011_ONLY ? 3 : 30)) {
    await flushBatch();
    console.log(`  → バッチ書き込み完了`);
  }

  row.insertedCount = inserted;
  row.skippedCount  = skipped;
  totalInserted += inserted;
  totalSkipped  += skipped;

  const oddsStr = `1-2=${exacta["1-2"] ?? "—"} 1-3=${exacta["1-3"] ?? "—"} 1-4=${exacta["1-4"] ?? "—"}`;
  const fTag    = row.isFRefund ? " [F返還]" : "";
  const cTag    = f.cached ? " [cache]" : "";
  const wTag    = WRITE_MODE ? ` (+${inserted}件INSERT)` : ` (dry-run ${targetCombos.length}件)`;
  console.log(`${prefix}${cTag}${fTag}: ✅ cells=${cellCount} ${oddsStr}${wTag}`);

  results.push(row);
  if (!f.cached) await new Promise(s => setTimeout(s, SLEEP_MS));
}

// 残バッファをフラッシュ
await flushBatch();

// ─── 集計 ────────────────────────────────────────────────────────────────────

const okCount           = results.filter(r => r.status === "ok" || r.status === "cached_ok").length;
const alreadyComplete   = results.filter(r => r.status === "already_complete").length;
const fRefundCount      = results.filter(r => r.isFRefund).length;
const errCount          = results.filter(r => r.status === "fetch_error" || r.status === "parse_error").length;
const remaining         = missing.length - okCount;

// 保存済み件数 (DBから再カウント)
const savedExactaCount = WRITE_MODE
  ? (db.prepare(`SELECT COUNT(DISTINCT race_id) n FROM historical_alternative_odds WHERE bet_type='exacta'`).get() as { n: number }).n
  : savedSet.size;

console.log(`\n=== 完了 ===`);
console.log(`  今回処理: ${targets.length}件 (ok=${okCount} / already_complete=${alreadyComplete} / error=${errCount} / F返還=${fRefundCount})`);
if (WRITE_MODE) {
  console.log(`  INSERT: ${totalInserted}行`);
  console.log(`  exacta保存済み (DB, 完全): ${savedExactaCount}件 / 全体: ${allBuyRaces.length}件 / 残: ${remaining}件`);
} else {
  console.log(`  (dry-run: INSERT しない。対象組番: ${totalSkipped + totalInserted}行)`);
  console.log(`  残: ${missing.length}件 (limit=${LIMIT}で今回は${targets.length}件処理)`);
}

// quality check: race別 exacta count 分布
const countDist = db.prepare(`
  SELECT cnt, COUNT(*) races FROM (
    SELECT race_id, COUNT(*) cnt FROM historical_alternative_odds
    WHERE bet_type='exacta' GROUP BY race_id
  ) GROUP BY cnt ORDER BY cnt
`).all() as { cnt: number; races: number }[];

console.log(`\n  [quality check] race別 exacta count 分布:`);
let warnCount = 0;
for (const d of countDist) {
  const label = d.cnt === 30 ? "(6艇完全)" : d.cnt === 20 ? "(欠場1艇)" : d.cnt === 12 ? "(欠場2艇)" : d.cnt === 3 ? "(旧部分保存)" : "⚠️ 要調査";
  if (d.cnt > 3 && d.cnt < 20) warnCount++;
  console.log(`    COUNT=${d.cnt}: ${d.races}件 ${label}`);
}
if (warnCount > 0) {
  console.log(`  ⚠️ COUNT 4〜19 のレースが存在します。途中保存またはパース欠損の可能性があります。`);
} else {
  console.log(`  ✅ 中途半端な保存数なし (COUNT 4〜19 = 0件)`);
}
console.log();

// ─── レポート出力 ─────────────────────────────────────────────────────────────

const lines: string[] = [];
lines.push(`# exacta closing odds backfill`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(`モード: ${WRITE_MODE ? "WRITE" : "dry-run"}`);
lines.push(``);
lines.push(`> **BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(``);
lines.push(`## 実行サマリ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| BUY対象 (全期間) | ${allBuyRaces.length}件 |`);
lines.push(`| 保存済み (exacta) | ${savedExactaCount}件 |`);
lines.push(`| 未取得 | ${missing.length}件 |`);
lines.push(`| 今回処理 | ${targets.length}件 (limit=${LIMIT}) |`);
lines.push(`| 成功 | ${okCount}件 |`);
lines.push(`| エラー | ${errCount}件 |`);
lines.push(`| F返還レース | ${fRefundCount}件 (odds 取得可、払戻検算は構造的不一致) |`);
if (WRITE_MODE) lines.push(`| INSERT 行数 | ${totalInserted}行 |`);
lines.push(``);
if (errCount > 0) {
  lines.push(`## エラー詳細`);
  lines.push(``);
  for (const r of results.filter(r => r.status === "fetch_error" || r.status === "parse_error")) {
    lines.push(`- ${r.race_id} (${r.date} ${r.venue}): ${r.status} — ${r.error ?? ""}`);
  }
  lines.push(``);
}
lines.push(`## 処理詳細 (先頭20件)`);
lines.push(``);
lines.push(`| race_id | status | cells | 1-2 | 1-3 | 1-4 | F返還 |`);
lines.push(`|---|---|---|---|---|---|---|`);
for (const r of results.slice(0, 20)) {
  const rrow = results.find(x => x.race_id === r.race_id)!;
  const exacta = rrow.combosAvailable.length > 0 ? "—" : "—";
  lines.push(`| ${r.race_id} | ${r.status} | ${r.cellCount} | — | — | — | ${r.isFRefund ? "✓" : ""} |`);
}
if (results.length > 20) lines.push(`... 他 ${results.length - 20}件`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: backfill-exacta-closing-odds.ts*`);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"), "utf-8");
writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  writeMode: WRITE_MODE,
  allBuyRaces: allBuyRaces.length,
  savedExactaRaces: savedExactaCount,
  missing: missing.length,
  processed: targets.length,
  ok: okCount,
  errors: errCount,
  fRefund: fRefundCount,
  inserted: totalInserted,
  results: results.map(r => ({
    race_id: r.race_id, date: r.date, venue: r.venue,
    status: r.status, cellCount: r.cellCount, isFRefund: r.isFRefund,
    combos: r.combosAvailable.length,
  })),
}, null, 2), "utf-8");

console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
