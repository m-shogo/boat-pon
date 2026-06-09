/**
 * backfill-historical-alternative-odds.ts
 *
 * 禁止: 既存DBテーブルへのINSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision 変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 過去 forward BUY レースの「締切時代替買い目 odds」を公式アーカイブから取得する。
 *   取得した odds は historical closing odds として historical_alternative_odds テーブルに保存する。
 *   live/T-5/timeseries odds とは必ず区別する。
 *
 * デフォルト: dry-run。--write 指定時のみ DB に INSERT する。
 *   --write 時は historical_alternative_odds テーブルが存在する場合のみ INSERT。
 *   テーブルが存在しない場合はエラー停止。勝手に CREATE TABLE しない。
 *   既存テーブル (odds_snapshots 等) へは絶対に INSERT しない。
 *
 * 使い方:
 *   pnpm backfill:historical-alt-odds [options]
 *
 *   --limit 30              取得件数上限（デフォルト30）
 *   --from YYYY-MM-DD       対象期間開始
 *   --to   YYYY-MM-DD       対象期間終了
 *   --venue 宮島             会場絞り込み
 *   --race-no 6             レース番号絞り込み
 *   --priority condB|skip6R|skipVenue|allForward  対象優先順位
 *   --write                 DB に INSERT する（デフォルト: dry-run）
 *   --sleep-ms 1000         取得間隔ms（デフォルト1000）
 *   --resume                取得済みレースをスキップ
 *   --only-missing          未取得レースのみ対象（デフォルトtrue）
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseAllTrifectaOdds } from "../src/domain/oddsParser";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/historical-alternative-odds-backfill.md";
const OUT_JSON = "reports/historical-alternative-odds-backfill.json";
const CACHE_DIR = "data/raw/official/odds";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELS   = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;
const SOURCE_TYPE    = "official_archive";
const SOURCE_QUALITY = "historical_closing_odds";
const PARSER_VERSION = "1.0";

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

const LIMIT      = parseInt(getArg("--limit", "30"), 10);
const SLEEP_MS   = parseInt(getArg("--sleep-ms", "1000"), 10);
const FROM_DATE  = getArg("--from", "");
const TO_DATE    = getArg("--to", "");
const VENUE_FILTER  = getArg("--venue", "");
const RACENO_FILTER = getArg("--race-no", "");
const PRIORITY   = getArg("--priority", "condB") as "condB" | "skip6R" | "skipVenue" | "allForward";
const WRITE_MODE = hasFlag("--write");
const ONLY_MISSING = !hasFlag("--no-only-missing"); // デフォルト: 未取得のみ

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: !WRITE_MODE });
db.exec("PRAGMA busy_timeout = 5000;");

// --write 時: テーブル存在確認（なければエラー停止）
if (WRITE_MODE) {
  const tableExists = db.prepare(
    "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='historical_alternative_odds'"
  ).get() as { n: number };
  if (tableExists.n === 0) {
    console.error("❌ エラー: historical_alternative_odds テーブルが存在しません。");
    console.error("   CREATE TABLE を先に実行してください（次フェーズで実施）。");
    console.error("   このスクリプトは勝手に CREATE TABLE しません。");
    process.exit(1);
  }
}

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ─── condB 判定 SQL ───────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

// ─── 取得済み race_id セット（--only-missing 用）────────────────────────────

const fetchedRaceIds = new Set<string>();
if (ONLY_MISSING && WRITE_MODE) {
  // テーブルが存在する場合のみ確認
  try {
    const fetched = db.prepare(
      `SELECT DISTINCT race_id FROM historical_alternative_odds
       WHERE source_type='${SOURCE_TYPE}' AND source_quality='${SOURCE_QUALITY}'`
    ).all() as { race_id: string }[];
    for (const r of fetched) fetchedRaceIds.add(r.race_id);
  } catch {
    // テーブルなしは無視（dry-run なら到達しない）
  }
}

// ─── 優先順位別 WHERE 句 ──────────────────────────────────────────────────────

function priorityWhere(priority: string): string {
  switch (priority) {
    case "condB":     return `AND ${WIND24} AND ${EXH1}`;
    case "skip6R":    return `AND dh.race_no = 6`;
    case "skipVenue": return `AND dh.venue IN ('浜名湖','住之江')`;
    case "allForward": return "";
    default:          return "";
  }
}

const priorityLabel: Record<string, string> = {
  condB: "条件B (風速2〜4 × 1号艇展示1位)",
  skip6R: "6R",
  skipVenue: "浜名湖+住之江",
  allForward: "全 forward BUY",
};

// ─── 対象レース抽出 ───────────────────────────────────────────────────────────

type TargetRace = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
};

const extraWhere = [
  FROM_DATE ? `dh.date >= '${FROM_DATE}'` : `dh.date >= '${FORWARD_START}'`,
  TO_DATE ? `dh.date <= '${TO_DATE}'` : null,
  VENUE_FILTER ? `dh.venue='${VENUE_FILTER}'` : null,
  RACENO_FILTER ? `dh.race_no=${parseInt(RACENO_FILTER, 10)}` : null,
].filter(Boolean).join(" AND ");

const allCandidates = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v})
    AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND ${extraWhere}
    ${priorityWhere(PRIORITY)}
  ORDER BY dh.date DESC
`).all() as TargetRace[];

// --only-missing: 取得済みを除外
const candidates = ONLY_MISSING
  ? allCandidates.filter(r => !fetchedRaceIds.has(r.race_id))
  : allCandidates;

const targets = candidates.slice(0, LIMIT);

// ─── URL 生成 ─────────────────────────────────────────────────────────────────

function makeOddsUrl(date: string, venue: string, raceNo: number): string | null {
  const jcd = VENUE_CODES[venue];
  if (!jcd) return null;
  const hd = date.replaceAll("-", "");
  return `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${raceNo}&jcd=${jcd}&hd=${hd}`;
}

function getCachePath(date: string, venue: string, raceNo: number): string {
  const jcd = VENUE_CODES[venue] ?? "??";
  return `${CACHE_DIR}/${date}/${jcd}-${String(raceNo).padStart(2, "0")}.html`;
}

// ─── fetch (既存 cache 優先) ──────────────────────────────────────────────────

async function fetchOddsHtml(date: string, venue: string, raceNo: number): Promise<{
  html: string | null; cached: boolean; url: string | null; error?: string
}> {
  const url = makeOddsUrl(date, venue, raceNo);
  if (!url) return { html: null, cached: false, url: null, error: `unknown venue: ${venue}` };

  const cachePath = getCachePath(date, venue, raceNo);
  if (existsSync(cachePath)) {
    try {
      const { readFileSync } = await import("node:fs");
      const html = readFileSync(cachePath, "utf-8");
      return { html, cached: true, url };
    } catch { /* fall through */ }
  }

  try {
    const res = await fetch(url, {
      headers: { "user-agent": "BoatPon/0.1 personal audit low-frequency" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { html: null, cached: false, url, error: `HTTP ${res.status}` };
    const html = await res.text();
    const dir = `${CACHE_DIR}/${date}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cachePath, html, "utf-8");
    return { html, cached: false, url };
  } catch (err) {
    return { html: null, cached: false, url, error: String(err) };
  }
}

// ─── 結果型 ──────────────────────────────────────────────────────────────────

type BackfillRecord = {
  race_id: string;
  race_date: string;
  venue: string;
  venue_code: string;
  race_no: number;
  combination: string;
  odds: number;
  source_type: string;
  source_quality: string;
  source_url: string;
  fetched_at: string;
  parser_version: string;
  is_backfill: number;
  fetch_status: string;
  notes: string | null;
};

type RaceResult = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
  url: string | null;
  cached: boolean;
  fetch_ok: boolean;
  parse_ok: boolean;
  all5_found: boolean;
  fetch_error?: string;
  odds: Partial<Record<typeof TARGET_SELS[number], number | null>>;
  odds_132_diff_from_123: boolean;
  all5_diff_from_123: boolean;
  odds_123_vs_current_odds_delta: number | null;
  would_insert: BackfillRecord[];
  was_inserted: boolean;
  notes: string[];
};

// ─── メイン処理 ───────────────────────────────────────────────────────────────

console.log(`=== historical closing odds backfill ===`);
console.log(`モード: ${WRITE_MODE ? "⚠️ --write (DB INSERT)" : "✅ dry-run (DB書き込みなし)"}`);
console.log(`優先順位: ${PRIORITY} (${priorityLabel[PRIORITY] ?? PRIORITY})`);
console.log(`対象: ${targets.length}件 / 候補: ${allCandidates.length}件 / limit: ${LIMIT} / sleep: ${SLEEP_MS}ms`);
console.log(`only-missing: ${ONLY_MISSING} / from: ${FROM_DATE || FORWARD_START} / to: ${TO_DATE || "(最新)"}`);
console.log();

const results: RaceResult[] = [];
const fetchedAt = new Date().toISOString();

for (let i = 0; i < targets.length; i++) {
  const race = targets[i];
  const { race_id, date, venue, race_no, current_odds } = race;
  process.stdout.write(`[${i + 1}/${targets.length}] ${race_id}... `);

  const { html, cached, url, error } = await fetchOddsHtml(date, venue, race_no);
  const venue_code = VENUE_CODES[venue] ?? "??";

  const result: RaceResult = {
    race_id, date, venue, race_no, current_odds,
    url, cached,
    fetch_ok: html !== null,
    parse_ok: false,
    all5_found: false,
    fetch_error: error,
    odds: {},
    odds_132_diff_from_123: false,
    all5_diff_from_123: false,
    odds_123_vs_current_odds_delta: null,
    would_insert: [],
    was_inserted: false,
    notes: [],
  };

  if (html) {
    const allOdds = parseAllTrifectaOdds(html);
    for (const sel of TARGET_SELS) {
      result.odds[sel] = allOdds.get(sel) ?? null;
    }
    const found = TARGET_SELS.filter(s => result.odds[s] !== null && result.odds[s]! > 0);
    result.parse_ok = found.length > 0;
    result.all5_found = found.length === TARGET_SELS.length;

    const o123 = result.odds["1-2-3"];
    const o132 = result.odds["1-3-2"];

    if (o123 != null) {
      result.odds_123_vs_current_odds_delta = Math.round(Math.abs(o123 - current_odds) * 100) / 100;
    }
    if (o123 != null && o132 != null) {
      result.odds_132_diff_from_123 = Math.abs(o123 - o132) >= 0.1;
    }
    result.all5_diff_from_123 = o123 != null &&
      TARGET_SELS.slice(1).every(s => {
        const v = result.odds[s];
        return v != null && Math.abs(v - o123!) >= 0.1;
      });

    // 品質チェック
    if (!result.all5_found) result.notes.push(`5買い目中 ${found.length}件のみ`);
    if (o123 != null && o132 != null && Math.abs(o123 - o132) < 0.1) {
      result.notes.push("⚠️ 1-2-3=1-3-2 同値（バグ疑い）");
    }
    if (result.odds_123_vs_current_odds_delta != null && result.odds_123_vs_current_odds_delta > 10) {
      result.notes.push(`⚠️ 1-2-3 odds 乖離 ${result.odds_123_vs_current_odds_delta}pt (dh.current_odds=${current_odds})`);
    }

    // INSERT 予定レコード生成
    for (const sel of TARGET_SELS) {
      const oddsVal = result.odds[sel];
      if (oddsVal == null || oddsVal <= 0) continue;
      result.would_insert.push({
        race_id, race_date: date, venue, venue_code, race_no,
        combination: sel,
        odds: oddsVal,
        source_type: SOURCE_TYPE,
        source_quality: SOURCE_QUALITY,
        source_url: url ?? "",
        fetched_at: fetchedAt,
        parser_version: PARSER_VERSION,
        is_backfill: 1,
        fetch_status: "success",
        notes: result.notes.length > 0 ? result.notes.join("; ") : null,
      });
    }
  } else {
    // fetch 失敗レコード（status記録用）
    result.would_insert.push({
      race_id, race_date: date, venue, venue_code: VENUE_CODES[venue] ?? "??", race_no,
      combination: "N/A",
      odds: 0,
      source_type: SOURCE_TYPE,
      source_quality: SOURCE_QUALITY,
      source_url: url ?? "",
      fetched_at: fetchedAt,
      parser_version: PARSER_VERSION,
      is_backfill: 1,
      fetch_status: error ? "fetch_error" : "no_html",
      notes: error ?? null,
    });
  }

  // --write: INSERT
  if (WRITE_MODE && result.fetch_ok) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO historical_alternative_odds
        (race_id, race_date, venue, venue_code, race_no, combination, odds,
         source_type, source_quality, source_url, fetched_at, parser_version,
         is_backfill, fetch_status, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    let insertedCount = 0;
    for (const rec of result.would_insert.filter(r => r.combination !== "N/A")) {
      insertStmt.run(
        rec.race_id, rec.race_date, rec.venue, rec.venue_code, rec.race_no,
        rec.combination, rec.odds,
        rec.source_type, rec.source_quality, rec.source_url, rec.fetched_at,
        rec.parser_version, rec.is_backfill, rec.fetch_status, rec.notes
      );
      insertedCount++;
    }
    result.was_inserted = insertedCount > 0;
  }

  const status = !result.fetch_ok ? `FAIL(${error})` :
    !result.parse_ok ? "PARSE_NG" :
    result.all5_found ? "OK_ALL5" : "PARTIAL";
  const insertNote = WRITE_MODE ? (result.was_inserted ? " [INSERTED]" : " [SKIP/DUP]") : " [DRY-RUN]";
  console.log(`${cached ? "[cache] " : ""}${status}${insertNote}`);

  results.push(result);
  if (!cached && i < targets.length - 1) await sleep(SLEEP_MS);
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

const total       = results.length;
const fetchOk     = results.filter(r => r.fetch_ok).length;
const parseOk     = results.filter(r => r.parse_ok).length;
const all5Ok      = results.filter(r => r.all5_found).length;
const diff132Ok   = results.filter(r => r.odds_132_diff_from_123).length;
const all5DiffOk  = results.filter(r => r.all5_diff_from_123).length;
const cachedCount = results.filter(r => r.cached).length;
const wouldInsert = results.reduce((s, r) => s + r.would_insert.filter(x => x.combination !== "N/A" && x.odds > 0).length, 0);
const inserted    = results.filter(r => r.was_inserted).length;

const deltas = results.filter(r => r.odds_123_vs_current_odds_delta !== null).map(r => r.odds_123_vs_current_odds_delta!);
const avgDelta = deltas.length > 0 ? Math.round(deltas.reduce((s, v) => s + v, 0) / deltas.length * 100) / 100 : null;
const maxDelta = deltas.length > 0 ? Math.max(...deltas) : null;

// 品質判定
function fetchRate() { return total > 0 ? Math.round(fetchOk / total * 100) : 0; }
function all5Rate()  { return total > 0 ? Math.round(all5Ok / total * 100) : 0; }
function diff132Rate() { return total > 0 ? Math.round(diff132Ok / total * 100) : 0; }

const qualityOk = fetchRate() >= 95 && all5Rate() >= 95 && diff132Rate() >= 70;
const sameValueWarning = diff132Rate() < 70;
const hasError = results.some(r => r.all5_found && !r.all5_diff_from_123);

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# historical closing odds backfill dry-run`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(`モード: **${WRITE_MODE ? "⚠️ --write (DB INSERT実行)" : "✅ dry-run (DB書き込みなし)"}**`);
lines.push(`優先順位: \`${PRIORITY}\` (${priorityLabel[PRIORITY] ?? PRIORITY})`);
lines.push(``);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではありません。**`);
lines.push(`> **公式アーカイブから後日取得した「締切時オッズ backfill」です。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 実行結果サマリ`);
lines.push(``);
lines.push(`| 項目 | 件数 | 率 |`);
lines.push(`|---|---:|---:|`);
lines.push(`| 対象レース | ${total} | — |`);
lines.push(`| キャッシュ利用 | ${cachedCount} | — |`);
lines.push(`| fetch 成功 | ${fetchOk} | ${fetchRate()}% |`);
lines.push(`| parse 成功 | ${parseOk} | ${Math.round(parseOk/total*100)}% |`);
lines.push(`| 5買い目全取得 | ${all5Ok} | ${all5Rate()}% |`);
lines.push(`| 1-3-2≠1-2-3（別値） | ${diff132Ok} | ${diff132Rate()}% |`);
lines.push(`| 5買い目全て別値 | ${all5DiffOk} | ${Math.round(all5DiffOk/total*100)}% |`);
lines.push(`| 保存予定レコード数 | ${wouldInsert} | — |`);
if (WRITE_MODE) lines.push(`| INSERT 完了レース | ${inserted} | — |`);
lines.push(``);
lines.push(`### 1-2-3 odds vs current_odds 乖離`);
lines.push(``);
lines.push(`| 平均乖離 | 最大乖離 |`);
lines.push(`|---:|---:|`);
lines.push(`| ${avgDelta !== null ? avgDelta + "pt" : "—"} | ${maxDelta !== null ? maxDelta + "pt" : "—"} |`);
lines.push(``);
lines.push(`> 乖離は current_odds（取得タイミング前後）と closing odds（締切直後）の差。`);
lines.push(`> 大きい乖離は「締切前後でオッズが動いた」ことを示す（即バグではない）。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 品質判定`);
lines.push(``);
lines.push(`| 項目 | 結果 |`);
lines.push(`|---|---|`);
lines.push(`| fetch成功率 ≥ 95% | ${fetchRate() >= 95 ? "✅ OK" : "❌ NG"} (${fetchRate()}%) |`);
lines.push(`| 5買い目全取得率 ≥ 95% | ${all5Rate() >= 95 ? "✅ OK" : "⚠️ 要確認"} (${all5Rate()}%) |`);
lines.push(`| 1-3-2別値率 | ${!sameValueWarning ? "✅ OK" : "⚠️ 同値多い"} (${diff132Rate()}%) |`);
lines.push(`| 全体品質 | ${qualityOk ? "✅ 良好" : "⚠️ 要確認"} |`);
lines.push(`| 次に --write してよいか | ${qualityOk && !WRITE_MODE ? "⚠️ dry-run 成功 → 次回 --limit 30 --write 可" : WRITE_MODE ? "実行済み" : "❌ 品質確認後に判断"} |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 全レース詳細`);
lines.push(``);
lines.push(`| race_id | fetch | parse | all5 | 1-3-2別値 | 乖離 | 保存予定 | notes |`);
lines.push(`|---|:---:|:---:|:---:|:---:|---:|---:|---|`);
for (const r of results) {
  const tf = (b: boolean) => b ? "✅" : "❌";
  const insertN = r.would_insert.filter(x => x.combination !== "N/A" && x.odds > 0).length;
  lines.push(`| ${r.race_id} | ${tf(r.fetch_ok)} | ${tf(r.parse_ok)} | ${tf(r.all5_found)} | ${tf(r.odds_132_diff_from_123)} | ${r.odds_123_vs_current_odds_delta ?? "—"}pt | ${insertN}件 | ${r.notes.join("; ") || "—"} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 保存予定レコードサンプル（最大3件）`);
lines.push(``);
const sampleInserts = results.flatMap(r => r.would_insert.filter(x => x.combination !== "N/A" && x.odds > 0)).slice(0, 15);
if (sampleInserts.length > 0) {
  lines.push(`| race_id | combination | odds | source_quality | source_url |`);
  lines.push(`|---|---|---:|---|---|`);
  for (const rec of sampleInserts.slice(0, 15)) {
    const urlShort = rec.source_url.replace("https://www.boatrace.jp/owpc/pc/race/", "...");
    lines.push(`| ${rec.race_id} | ${rec.combination} | ${rec.odds} | ${rec.source_quality} | ${urlShort} |`);
  }
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 注記`);
lines.push(``);
lines.push(`- 条件Bの 1-3-2 ROI は **事後計算**（race_payouts.payout_yen ベース）であり、事前 odds ベースの switch 評価ではない`);
lines.push(`- 事前代替 odds 不足のため switch 本採用不可`);
lines.push(`- **historical closing odds backfill ができても live/T-5 forward ではない**`);
lines.push(`- 現時点で採用可能なのは skip monitor のみ`);
lines.push(`- 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可`);
lines.push(`- switch は必ず future-only odds_timeseries で再確認する`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: backfill-historical-alternative-odds.ts / mode=${WRITE_MODE ? "write" : "dry-run"} / priority=${PRIORITY}*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  mode: WRITE_MODE ? "write" : "dry-run",
  priority: PRIORITY,
  params: { limit: LIMIT, sleepMs: SLEEP_MS, fromDate: FROM_DATE, toDate: TO_DATE, venueFilter: VENUE_FILTER, onlyMissing: ONLY_MISSING },
  summary: { total, cached: cachedCount, fetchOk, parseOk, all5Ok, diff132Ok, all5DiffOk, wouldInsert, inserted, avgDelta, maxDelta },
  quality: { fetchRate: fetchRate(), all5Rate: all5Rate(), diff132Rate: diff132Rate(), qualityOk, nextWriteReady: qualityOk && !WRITE_MODE },
  results,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log();
console.log("=== 集計 ===");
console.log(`  fetch: ${fetchOk}/${total} / parse: ${parseOk}/${total} / 5買い目: ${all5Ok}/${total} / 1-3-2別値: ${diff132Ok}/${total}`);
console.log(`  保存予定: ${wouldInsert}件 / 品質: ${qualityOk ? "✅ 良好" : "⚠️ 要確認"}`);
if (!WRITE_MODE) console.log(`  ✅ dry-run 完了 (DB書き込みなし)`);
if (WRITE_MODE)  console.log(`  ⚠️ --write 実行: ${inserted}件 INSERT`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
