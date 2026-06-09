/**
 * audit-historical-closing-odds-availability.ts — 読み取り専用 (デフォルトdry-run)
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 *
 * 目的: 過去 forward BUY 期間について、公式アーカイブから「締切時代替買い目 odds」を
 *   取得できるかどうかを小規模サンプルで確認する。
 *   結果を historical closing odds として使えるかを評価する（switch 分析の準備段階）。
 *
 * 重要:
 *   - このスクリプトはDB書き込みをしない（読み取り専用監査）
 *   - 大量アクセス禁止: デフォルト30件、sleep付き、失敗時は記録してskip
 *   - 取得したoddsは live/T-5 odds とは呼ばない。必ず historical closing odds として扱う
 *
 * 使い方:
 *   tsx scripts/audit-historical-closing-odds-availability.ts [options]
 *
 *   --limit 30           取得件数上限（デフォルト30）
 *   --sleep-ms 1500      取得間隔ms（デフォルト1500）
 *   --from YYYY-MM-DD    対象期間開始（デフォルト: 最古forward日）
 *   --to   YYYY-MM-DD    対象期間終了（デフォルト: 最新forward日）
 *   --venue 宮島          会場絞り込み
 *   --race-no 6          レース番号絞り込み
 *   --category condB     condB/6R/hamanako/suminoe/normal から絞り込み
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { parseAllTrifectaOdds } from "../src/domain/oddsParser";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/historical-closing-odds-availability.md";
const OUT_JSON = "reports/historical-closing-odds-availability.json";
const CACHE_DIR = "data/raw/official/odds";

const FORWARD_START = "2025-01-01";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const TARGET_SELS   = ["1-2-3", "1-3-2", "1-2-4", "1-4-2", "1-3-4"] as const;

// venue → venue_code マッピング（fetch-official-odds.ts と同じ）
const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

// CLI オプション
const argv = process.argv.slice(2);
function getArg(flag: string, defaultVal: string): string {
  const idx = argv.indexOf(flag);
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : defaultVal;
}

const LIMIT    = parseInt(getArg("--limit", "30"), 10);
const SLEEP_MS = parseInt(getArg("--sleep-ms", "1500"), 10);
const FROM_DATE = getArg("--from", "");
const TO_DATE   = getArg("--to", "");
const VENUE_FILTER  = getArg("--venue", "");
const RACENO_FILTER = getArg("--race-no", "");
const CAT_FILTER    = getArg("--category", "");

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// ─── サンプルレース選択 ────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

type SampleRace = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  current_odds: number;
  category: string;
};

const dateWhere = [
  FROM_DATE ? `dh.date >= '${FROM_DATE}'` : `dh.date >= '${FORWARD_START}'`,
  TO_DATE ? `dh.date <= '${TO_DATE}'` : null,
  VENUE_FILTER ? `dh.venue='${VENUE_FILTER}'` : null,
  RACENO_FILTER ? `dh.race_no=${parseInt(RACENO_FILTER, 10)}` : null,
].filter(Boolean).join(" AND ");

// カテゴリ別に満遍なく選ぶ（各カテゴリから均等に）
const allCandidates = db.prepare(`
  WITH fwd AS (
    SELECT dh.race_id, dh.date, dh.venue, dh.race_no, dh.current_odds
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${excl_v})
      AND dh.race_no NOT IN (${excl_r})
      AND dh.selection='1-2-3'
      AND ${dateWhere}
  ),
  cb AS (
    SELECT dh.race_id
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND dh.selection='1-2-3'
      AND ${WIND24} AND ${EXH1}
  )
  SELECT f.race_id, f.date, f.venue, f.race_no, f.current_odds,
    CASE WHEN cb.race_id IS NOT NULL THEN 'condB'
         WHEN f.race_no=6 AND f.venue IN ('浜名湖','住之江') THEN '6R_bad_venue'
         WHEN f.race_no=6 THEN '6R'
         WHEN f.venue='浜名湖' THEN 'hamanako'
         WHEN f.venue='住之江' THEN 'suminoe'
         ELSE 'normal'
    END category
  FROM fwd f
  LEFT JOIN cb ON cb.race_id=f.race_id
  ORDER BY f.date DESC
`).all() as SampleRace[];

// カテゴリフィルター
const filtered = CAT_FILTER
  ? allCandidates.filter(r => r.category === CAT_FILTER)
  : allCandidates;

// カテゴリ別に均等抽出（各カテゴリから LIMIT/n_cats 件ずつ）
const CATEGORIES = ["condB", "6R", "hamanako", "suminoe", "6R_bad_venue", "normal"] as const;
const perCat = Math.max(1, Math.floor(LIMIT / CATEGORIES.length));

let samples: SampleRace[] = [];
if (CAT_FILTER) {
  samples = filtered.slice(0, LIMIT);
} else {
  for (const cat of CATEGORIES) {
    const group = filtered.filter(r => r.category === cat).slice(0, perCat);
    samples.push(...group);
  }
  // 余った枠を normal で埋める
  if (samples.length < LIMIT) {
    const used = new Set(samples.map(r => r.race_id));
    const extra = filtered.filter(r => r.category === "normal" && !used.has(r.race_id))
      .slice(0, LIMIT - samples.length);
    samples.push(...extra);
  }
  samples = samples.slice(0, LIMIT);
}

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

  // キャッシュ確認 (live データと区別するため既存キャッシュも読む)
  const cachePath = getCachePath(date, venue, raceNo);
  if (existsSync(cachePath)) {
    try {
      const html = readFileSync(cachePath, "utf-8");
      return { html, cached: true, url };
    } catch {
      // キャッシュ読み失敗 → 再取得へ
    }
  }

  try {
    const res = await fetch(url, {
      headers: { "user-agent": "BoatPon/0.1 personal audit low-frequency" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { html: null, cached: false, url, error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    // キャッシュ保存
    const dir = `${CACHE_DIR}/${date}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath, html, "utf-8");
    return { html, cached: false, url };
  } catch (err) {
    return { html: null, cached: false, url, error: String(err) };
  }
}

// ─── 結果型 ──────────────────────────────────────────────────────────────────

type AuditResult = {
  race_id: string;
  date: string;
  venue: string;
  race_no: number;
  category: string;
  current_odds_123: number;
  url: string | null;
  cached: boolean;
  fetch_ok: boolean;
  parse_ok: boolean;
  all5_found: boolean;
  fetch_error?: string;
  odds: Partial<Record<typeof TARGET_SELS[number], number | null>>;
  // 検証項目
  odds_132_diff_from_123: boolean;   // 1-3-2 ≠ 1-2-3
  all5_diff_from_123: boolean;       // 全5買い目が1-2-3と異なる
  odds_123_vs_current_odds_delta: number | null; // |fetch_odds_123 - current_odds|
  notes: string[];
};

// ─── メイン処理 ───────────────────────────────────────────────────────────────

console.log(`=== historical closing odds 取得可能性監査 ===`);
console.log(`サンプル: ${samples.length}件 / sleep: ${SLEEP_MS}ms / limit: ${LIMIT}`);
console.log(`期間: ${FROM_DATE || FORWARD_START}〜${TO_DATE || "(最新)"}`);
console.log();

const results: AuditResult[] = [];

for (let i = 0; i < samples.length; i++) {
  const race = samples[i];
  const { date, venue, race_no, current_odds, category } = race;
  process.stdout.write(`[${i + 1}/${samples.length}] ${race.race_id} (${category})... `);

  const { html, cached, url, error } = await fetchOddsHtml(date, venue, race_no);

  const result: AuditResult = {
    race_id: race.race_id,
    date,
    venue,
    race_no,
    category,
    current_odds_123: current_odds,
    url,
    cached,
    fetch_ok: html !== null,
    parse_ok: false,
    all5_found: false,
    fetch_error: error,
    odds: {},
    odds_132_diff_from_123: false,
    all5_diff_from_123: false,
    odds_123_vs_current_odds_delta: null,
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

    if (o123 !== null && o123 !== undefined) {
      result.odds_123_vs_current_odds_delta = Math.round(Math.abs(o123 - current_odds) * 100) / 100;
    }

    if (o123 !== null && o132 !== null && o123 !== undefined && o132 !== undefined) {
      result.odds_132_diff_from_123 = Math.abs(o123 - o132) >= 0.1;
    }

    result.all5_diff_from_123 = o123 !== null && o123 !== undefined &&
      TARGET_SELS.slice(1).every(s => {
        const v = result.odds[s];
        return v !== null && v !== undefined && Math.abs(v - o123!) >= 0.1;
      });

    // 注記
    if (!result.parse_ok) result.notes.push("parse失敗: odds取得不可");
    if (!result.all5_found) result.notes.push(`5買い目中 ${found.length}買い目のみ取得`);
    if (o123 !== null && o132 !== null && o123 !== undefined && o132 !== undefined && Math.abs(o123 - o132) < 0.1) {
      result.notes.push("⚠️ 1-2-3=1-3-2 同値（バグ疑い）");
    }
    if (result.odds_123_vs_current_odds_delta !== null && result.odds_123_vs_current_odds_delta > 5) {
      result.notes.push(`⚠️ 1-2-3 odds乖離 ${result.odds_123_vs_current_odds_delta}pt (current_odds=${current_odds})`);
    }
  }

  const status = !result.fetch_ok ? `FAIL(${error})` : !result.parse_ok ? "FETCH_OK/PARSE_NG" : result.all5_found ? "OK_ALL5" : "PARTIAL";
  console.log(`${cached ? "[cache] " : ""}${status}`);

  results.push(result);

  if (!cached && i < samples.length - 1) await sleep(SLEEP_MS);
}

// ─── 集計 ────────────────────────────────────────────────────────────────────

const fetchOk     = results.filter(r => r.fetch_ok).length;
const parseOk     = results.filter(r => r.parse_ok).length;
const all5Ok      = results.filter(r => r.all5_found).length;
const diff132Ok   = results.filter(r => r.odds_132_diff_from_123).length;
const all5DiffOk  = results.filter(r => r.all5_diff_from_123).length;
const cachedCount = results.filter(r => r.cached).length;

// カテゴリ別集計
type CatStat = { cat: string; n: number; fetch: number; parse: number; all5: number; diff132: number };
const catStats = new Map<string, CatStat>();
for (const r of results) {
  if (!catStats.has(r.category)) {
    catStats.set(r.category, { cat: r.category, n: 0, fetch: 0, parse: 0, all5: 0, diff132: 0 });
  }
  const s = catStats.get(r.category)!;
  s.n++;
  if (r.fetch_ok) s.fetch++;
  if (r.parse_ok) s.parse++;
  if (r.all5_found) s.all5++;
  if (r.odds_132_diff_from_123) s.diff132++;
}

// 1-2-3 vs current_odds 乖離分布
const deltas = results.filter(r => r.odds_123_vs_current_odds_delta !== null)
  .map(r => r.odds_123_vs_current_odds_delta!);
const avgDelta = deltas.length > 0 ? Math.round(deltas.reduce((s, v) => s + v, 0) / deltas.length * 100) / 100 : null;
const maxDelta = deltas.length > 0 ? Math.max(...deltas) : null;

// 全体評価
function overallVerdict(): string {
  if (fetchOk < results.length * 0.5) return "❌ 取得不可（サイト変更/アーカイブなし）";
  if (parseOk < results.length * 0.5) return "❌ parse失敗率高（HTML構造変更）";
  if (all5Ok < results.length * 0.5) return "⚠️ 5買い目揃わない（一部のみ）";
  if (diff132Ok < results.length * 0.5) return "⚠️ 1-2-3=1-3-2 同値率高（バグ疑い）";
  if (all5Ok >= results.length * 0.8 && diff132Ok >= results.length * 0.7) {
    return "✅ 取得可能・5買い目OK・odds差異あり → backfill候補";
  }
  return "⚠️ 取得可能だが品質要確認";
}

const verdict = overallVerdict();

// サンプル例（最大5件）
const goodExamples = results.filter(r => r.all5_found && r.odds_132_diff_from_123).slice(0, 5);
const badExamples  = results.filter(r => !r.fetch_ok || !r.parse_ok).slice(0, 5);

// ─── MD 出力 ──────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# 過去 forward 期間 締切時代替 odds 取得可能性監査`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(`サンプル: ${results.length}件 (limit=${LIMIT} / sleep=${SLEEP_MS}ms)`);
lines.push(`対象期間: ${FROM_DATE || FORWARD_START}〜${TO_DATE || "(最新forward)"}`);
lines.push(``);
lines.push(`> **読み取り専用監査。DB書き込みなし。**`);
lines.push(`> **取得した odds は historical closing odds として扱う。live/T-5 odds とは呼ばない。**`);
lines.push(`> BUY は検証候補、ROI は検証指標。購入指示ではない。app_settings / 本番 decision 変更禁止。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 総合判定`);
lines.push(``);
lines.push(`**${verdict}**`);
lines.push(``);
lines.push(`| 項目 | 件数 | 成功率 |`);
lines.push(`|---|---:|---:|`);
lines.push(`| サンプル総数 | ${results.length} | — |`);
lines.push(`| キャッシュ利用 | ${cachedCount} | — |`);
lines.push(`| fetch 成功 | ${fetchOk} | ${Math.round(fetchOk / results.length * 100)}% |`);
lines.push(`| parse 成功 | ${parseOk} | ${Math.round(parseOk / results.length * 100)}% |`);
lines.push(`| 5買い目全取得 | ${all5Ok} | ${Math.round(all5Ok / results.length * 100)}% |`);
lines.push(`| 1-3-2≠1-2-3（別値） | ${diff132Ok} | ${Math.round(diff132Ok / results.length * 100)}% |`);
lines.push(`| 5買い目全て別値 | ${all5DiffOk} | ${Math.round(all5DiffOk / results.length * 100)}% |`);
lines.push(``);
lines.push(`### 1-2-3 odds vs current_odds 乖離`);
lines.push(``);
lines.push(`| 指標 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| 平均乖離 | ${avgDelta !== null ? avgDelta + "pt" : "—"} |`);
lines.push(`| 最大乖離 | ${maxDelta !== null ? maxDelta + "pt" : "—"} |`);
lines.push(``);
lines.push(`> 乖離が大きい場合、current_odds は締切前暫定値であり、取得した closing odds と異なる可能性あり。`);
lines.push(`> 乖離が小さい場合、historical closing odds は current_odds の精度確認にも使える。`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## カテゴリ別集計`);
lines.push(``);
lines.push(`| カテゴリ | n | fetch成功 | parse成功 | 5買い目 | 1-3-2別値 |`);
lines.push(`|---|---:|---:|---:|---:|---:|`);
for (const [, s] of catStats) {
  const p = (a: number) => s.n > 0 ? `${a}(${Math.round(a / s.n * 100)}%)` : "—";
  lines.push(`| ${s.cat} | ${s.n} | ${p(s.fetch)} | ${p(s.parse)} | ${p(s.all5)} | ${p(s.diff132)} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 取得成功例（最大5件）`);
lines.push(``);
if (goodExamples.length > 0) {
  lines.push(`| race_id | 1-2-3 | 1-3-2 | 1-2-4 | 1-4-2 | 1-3-4 | current_odds乖離 |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const r of goodExamples) {
    const o = (s: string) => String(r.odds[s as typeof TARGET_SELS[number]] ?? "—");
    lines.push(`| ${r.race_id} | ${o("1-2-3")} | ${o("1-3-2")} | ${o("1-2-4")} | ${o("1-4-2")} | ${o("1-3-4")} | ${r.odds_123_vs_current_odds_delta ?? "—"}pt |`);
  }
} else {
  lines.push(`> 取得成功例なし（fetch/parse失敗 or 同値問題）`);
}
lines.push(``);
lines.push(`## 取得失敗例（最大5件）`);
lines.push(``);
if (badExamples.length > 0) {
  lines.push(`| race_id | 状態 | エラー |`);
  lines.push(`|---|---|---|`);
  for (const r of badExamples) {
    lines.push(`| ${r.race_id} | ${r.fetch_ok ? "fetch_ok/parse_ng" : "fetch_NG"} | ${(r.fetch_error ?? r.notes.join("; ")) || "—"} |`);
  }
} else {
  lines.push(`> 失敗例なし`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 全サンプル詳細`);
lines.push(``);
lines.push(`| race_id | cat | fetch | parse | all5 | 1-3-2別値 | 乖離 | notes |`);
lines.push(`|---|---|:---:|:---:|:---:|:---:|---:|---|`);
for (const r of results) {
  const tf = (b: boolean) => b ? "✅" : "❌";
  lines.push(`| ${r.race_id} | ${r.category} | ${tf(r.fetch_ok)} | ${tf(r.parse_ok)} | ${tf(r.all5_found)} | ${tf(r.odds_132_diff_from_123)} | ${r.odds_123_vs_current_odds_delta ?? "—"}pt | ${r.notes.join("; ") || "—"} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 結論`);
lines.push(``);
const canBackfill = fetchOk >= results.length * 0.7 && parseOk >= results.length * 0.7 && all5Ok >= results.length * 0.5;
const goodDiff    = diff132Ok >= results.length * 0.7;

lines.push(`| 判断軸 | 結果 |`);
lines.push(`|---|---|`);
lines.push(`| 取得可能か | ${fetchOk >= results.length * 0.7 ? "✅ 可能" : "❌ 不可"} |`);
lines.push(`| 5買い目 parse 可能か | ${all5Ok >= results.length * 0.5 ? "✅ 可能" : "❌ 不可"} |`);
lines.push(`| 1-3-2が正しく別値か | ${goodDiff ? "✅ 別値あり" : "⚠️ 同値疑い"} |`);
lines.push(`| historical closing odds として使えるか | ${canBackfill && goodDiff ? "✅ 使えそう" : "⚠️ 要検討"} |`);
lines.push(`| 大量 backfill してよいか | ${canBackfill && goodDiff ? "⚠️ --limit 200 で次フェーズ可" : "❌ 追加確認必要"} |`);
lines.push(`| まだ switch 分析できない理由 | timeseries BUY重複 n<200 / live forward odds 未蓄積 |`);
lines.push(`| 次に --write してよいか | ${canBackfill && goodDiff ? "⚠️ dry-run n=200確認後に検討" : "❌ まだ待つ"} |`);
lines.push(``);
lines.push(`> ⚠️ **switch 分析は historical closing odds が取れても本採用不可。**`);
lines.push(`> live/T-5 odds（odds_timeseries_snapshots）での forward 検証が揃うまで採用できない。`);
lines.push(`> 条件B は n=200 到達後も、代替 odds が蓄積されなければ switch 採用不可。`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: audit-historical-closing-odds-availability.ts*`);

const md = lines.join("\n");
if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, md, "utf-8");

const jsonOutput = {
  generatedAt: now,
  params: { limit: LIMIT, sleepMs: SLEEP_MS, fromDate: FROM_DATE, toDate: TO_DATE, venueFilter: VENUE_FILTER, categoryFilter: CAT_FILTER },
  summary: { total: results.length, cached: cachedCount, fetchOk, parseOk, all5Ok, diff132Ok, all5DiffOk, avgDelta, maxDelta },
  verdict,
  categoryStats: Object.fromEntries(catStats),
  canBackfill,
  goodDiff,
  results,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOutput, null, 2), "utf-8");

console.log();
console.log("=== 結果サマリ ===");
console.log(`  fetch成功: ${fetchOk}/${results.length}`);
console.log(`  parse成功: ${parseOk}/${results.length}`);
console.log(`  5買い目全取得: ${all5Ok}/${results.length}`);
console.log(`  1-3-2別値: ${diff132Ok}/${results.length}`);
console.log(`  総合判定: ${verdict}`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
