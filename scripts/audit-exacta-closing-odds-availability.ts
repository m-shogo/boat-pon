/**
 * audit-exacta-closing-odds-availability.ts — 読み取り専用 (DB write なし)
 *
 * 禁止: DBへのINSERT/UPDATE/DELETE/DROP, app_settings変更, 本番decision変更
 * 禁止: 自動投票・ログイン保存・投票サイト操作・購入推奨
 *
 * 目的: H011「1-4系 市場過小評価」の決着に必要な exacta (2連単) closing odds が
 *   公式アーカイブ (odds2tf ページ) から取得可能かを audit する。
 *
 * 背景:
 *   - H011 held-out検証 (b768c02) で「2着=4号艇の頻度の傾きは構造、ROI優位は期間依存」と判明
 *   - 残る検証は「市場価格 (exacta closing odds) が頻度の傾きを織り込んでいるか」の直接比較
 *   - implied確率 vs 実頻度を比較できれば H011 に白黒がつく
 *
 * 検証方法:
 *   - BUY レース (2024 held-out / 2025+ forward) から層化サンプリング
 *   - https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=X&jcd=YY&hd=YYYYMMDD を取得
 *   - ページ構造: table1 = 2連単30通り (列=1着艇1-6, 行=2着艇昇順), table2 = 2連複15通り
 *   - 検算: race_payouts の当選 exacta 組番の払戻/100 == ページ上の closing odds (完全一致するはず)
 *
 * 出力: reports/exacta-closing-odds-availability.{md,json}
 * 取得HTML は data/raw/official/odds2tf/ にキャッシュ (将来の backfill で再利用)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/exacta-closing-odds-availability.md";
const OUT_JSON = "reports/exacta-closing-odds-availability.json";
const CACHE_DIR = "data/raw/official/odds2tf";
const SLEEP_MS = parseInt(process.env.AUDIT_SLEEP_MS ?? "1500", 10);
const SAMPLES_PER_QUARTER = 2;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES  = [10, 11, 12];
const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

// ─── サンプル選定: BUY レースを四半期ごとに層化 ───────────────────────────────

type Race = { race_id: string; date: string; venue: string; race_no: number; quarter: string };

const buyRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no,
    substr(dh.date, 1, 4) || '-Q' || ((CAST(substr(dh.date, 6, 2) AS INTEGER) + 2) / 3) quarter
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v}) AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3'
    AND dh.date >= '2024-01-01'
  ORDER BY dh.date
`).all() as Race[];

// 四半期ごとに先頭から SAMPLES_PER_QUARTER 件
const byQuarter = new Map<string, Race[]>();
for (const r of buyRaces) {
  if (!byQuarter.has(r.quarter)) byQuarter.set(r.quarter, []);
  byQuarter.get(r.quarter)!.push(r);
}
const samples: Race[] = [];
for (const [, races] of [...byQuarter.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  // 四半期の最初と中央からサンプル (日付の偏り回避)
  samples.push(races[0]);
  if (races.length > 2 && SAMPLES_PER_QUARTER >= 2) samples.push(races[Math.floor(races.length / 2)]);
}

console.log(`BUY対象 (2024+): ${buyRaces.length}件 / 四半期数: ${byQuarter.size} / auditサンプル: ${samples.length}件`);

// ─── fetch + parse ────────────────────────────────────────────────────────────

function makeUrl(date: string, venue: string, raceNo: number): string | null {
  const jcd = VENUE_CODES[venue];
  if (!jcd) return null;
  return `https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=${raceNo}&jcd=${jcd}&hd=${date.replace(/-/g, "")}`;
}

function cachePath(date: string, venue: string, raceNo: number): string {
  const jcd = VENUE_CODES[venue] ?? "??";
  return `${CACHE_DIR}/${date}/${jcd}-${String(raceNo).padStart(2, "0")}.html`;
}

async function fetchHtml(r: Race): Promise<{ html: string | null; cached: boolean; url: string | null; error?: string }> {
  const url = makeUrl(r.date, r.venue, r.race_no);
  if (!url) return { html: null, cached: false, url: null, error: `unknown venue: ${r.venue}` };
  const cp = cachePath(r.date, r.venue, r.race_no);
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
    return { html: null, cached: false, url, error: String(err) };
  }
}

// 2連単30通りのパース: 最初の tbody (2連単テーブル) のみを行単位で解析する。
// 行ごとに6ペア (2着艇td, oddsPoint td)、ペア位置 = 1着艇列 (1-6)。
// フラット正規表現だと欠場等で2連複側のセルが欠けた時に index がズレるため不可。
// 注意: class="oddsPoint " (末尾スペースあり)。欠場セルは非数値になり得るためスキップ。
function parseExactaOdds(html: string): { exacta: Record<string, number>; cellCount: number } {
  const tbodyStart = html.indexOf('<tbody class="is-p3-0">');
  if (tbodyStart < 0) return { exacta: {}, cellCount: 0 };
  const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const exacta: Record<string, number> = {};
  let cellCount = 0;
  for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
    // 12td = (2着艇, odds) × 6列
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

// ─── 実行 ─────────────────────────────────────────────────────────────────────

type AuditResult = {
  race_id: string; date: string; url: string | null; cached: boolean;
  status: "ok" | "ok_f_refund" | "fetch_error" | "parse_error" | "validation_mismatch" | "no_payout";
  cellCount: number;
  odds14: number | null; odds12: number | null; odds13: number | null;
  winCombo: string | null; winPayout: number | null; winOdds: number | null;
  validated: boolean;
  error?: string;
};

const results: AuditResult[] = [];

for (const [i, r] of samples.entries()) {
  const f = await fetchHtml(r);
  let res: AuditResult = {
    race_id: r.race_id, date: r.date, url: f.url, cached: f.cached,
    status: "fetch_error", cellCount: 0,
    odds14: null, odds12: null, odds13: null,
    winCombo: null, winPayout: null, winOdds: null, validated: false,
    error: f.error,
  };
  if (f.html) {
    const { exacta, cellCount } = parseExactaOdds(f.html);
    res.cellCount = cellCount;
    // 完全な6艇レースは30セル。欠場1艇なら20セル (5×4)。20未満はparse異常
    if (cellCount < 20 || exacta["1-2"] == null) {
      res.status = "parse_error";
    } else {
      res.odds14 = exacta["1-4"] ?? null;
      res.odds12 = exacta["1-2"] ?? null;
      res.odds13 = exacta["1-3"] ?? null;
      const win = db.prepare(
        `SELECT combination, payout_yen FROM race_payouts WHERE race_id=? AND bet_type='exacta' LIMIT 1`
      ).get(r.race_id) as { combination: string; payout_yen: number } | undefined;
      if (!win) {
        res.status = "no_payout";
      } else {
        res.winCombo = win.combination;
        res.winPayout = win.payout_yen;
        res.winOdds = exacta[win.combination] ?? null;
        // 検算: 払戻/100 == closing odds (完全一致を期待、浮動小数のみ許容)
        // ⚠️ F返還レースは pool 再計算で 払戻 ≠ closing odds になる (odds自体は正しい)
        const ok = res.winOdds != null && Math.abs(res.winOdds - win.payout_yen / 100) < 0.05;
        if (ok) {
          res.validated = true;
          res.status = "ok";
        } else {
          const hasF = (db.prepare(
            `SELECT COUNT(*) n FROM race_entries WHERE race_id=? AND status_code='F'`
          ).get(r.race_id) as { n: number }).n > 0;
          if (hasF) {
            // F返還: oddsは取得できているが払戻検算は構造的に不一致。取得可能性としてはOK
            res.validated = true;
            res.status = "ok_f_refund";
          } else {
            res.validated = false;
            res.status = "validation_mismatch";
          }
        }
      }
    }
  }
  results.push(res);
  const mark = res.status === "ok" ? "✅" : "❌";
  console.log(`[${i + 1}/${samples.length}] ${r.race_id}${f.cached ? " [cache]" : ""}: ${mark} ${res.status}` +
    (res.status === "ok" ? ` (当選${res.winCombo} ${res.winPayout}円 = odds ${res.winOdds})` : ` ${res.error ?? ""}`));
  if (!f.cached) await new Promise(s => setTimeout(s, SLEEP_MS));
}

const okCount = results.filter(r => r.status === "ok" || r.status === "ok_f_refund").length;
const fRefundCount = results.filter(r => r.status === "ok_f_refund").length;
const feasible = okCount === results.length && results.length > 0;

// ─── backfill 設計 (提案のみ・実行しない) ─────────────────────────────────────

const targetCount2024 = buyRaces.filter(r => r.date < "2025-01-01").length;
const targetCount2025 = buyRaces.filter(r => r.date >= "2025-01-01").length;
const estMinutes = Math.ceil(buyRaces.length * (SLEEP_MS + 500) / 1000 / 60);

// ─── 出力 ─────────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const lines: string[] = [];

lines.push(`# exacta (2連単) closing odds 取得可能性 audit`);
lines.push(``);
lines.push(`生成日時: ${now}`);
lines.push(``);
lines.push(`> **読み取り専用 audit。DB write なし。BUY は検証候補、ROI は検証指標。購入推奨ではない。**`);
lines.push(`> **historical closing odds は live/T-5/timeseries odds ではない。**`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## 目的`);
lines.push(``);
lines.push(`H011 held-out検証 (b768c02) の残課題「**市場価格が4号艇2着の頻度の傾きを織り込んでいるか**」を`);
lines.push(`直接検証するため、exacta closing odds が公式アーカイブから取得可能かを確認する。`);
lines.push(``);
lines.push(`## audit 結果サマリ`);
lines.push(``);
lines.push(`| 項目 | 値 |`);
lines.push(`|---|---|`);
lines.push(`| サンプル数 (四半期層化) | ${results.length} |`);
lines.push(`| 取得+検算成功 | ${okCount}/${results.length} (うちF返還で払戻検算対象外: ${fRefundCount}) |`);
lines.push(`| **判定** | ${feasible ? "✅ **取得可能** (全サンプルで当選組番の払戻/100 = closing odds が一致、F返還レースを除く)" : "❌ 要調査 (失敗サンプルあり)"} |`);
lines.push(`| ⚠️ F返還の注意 | F艇絡みの買い目は返還されpoolが再計算されるため、**F返還レースでは払戻 ≠ closing odds** (oddsは正しく取得可)。implied確率分析ではodds使用のため影響なし |`);
lines.push(`| ソースURL形式 | \`odds2tf?rno=X&jcd=YY&hd=YYYYMMDD\` |`);
lines.push(`| ページ構造 | 最初のtbody = 2連単30通り (列=1着艇1-6, 行=2着艇)。行単位パース必須 (フラット抽出は欠場ページでズレる) |`);
lines.push(`| キャッシュ | ${CACHE_DIR}/ (backfill で再利用可) |`);
lines.push(``);
lines.push(`## サンプル別検算`);
lines.push(``);
lines.push(`| race_id | 取得 | 1-2 | 1-3 | 1-4 | 当選組番 | 払戻 | 当選odds | 検算 |`);
lines.push(`|---|---|---:|---:|---:|---|---:|---:|---|`);
for (const r of results) {
  lines.push(`| ${r.race_id} | ${r.status === "fetch_error" ? "❌" : r.cached ? "cache" : "fetch"} | ${r.odds12 ?? "—"} | ${r.odds13 ?? "—"} | ${r.odds14 ?? "—"} | ${r.winCombo ?? "—"} | ${r.winPayout ?? "—"} | ${r.winOdds ?? "—"} | ${r.validated ? "✅" : "❌ " + r.status} |`);
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## backfill 設計提案 (実行はしない・人間確認待ち)`);
lines.push(``);
lines.push(`| 項目 | 内容 |`);
lines.push(`|---|---|`);
lines.push(`| 対象 | BUY レース 2024 held-out ${targetCount2024}件 + 2025+ forward ${targetCount2025}件 = **${buyRaces.length}件** |`);
lines.push(`| 取得組番 | exacta 1-2 / 1-3 / 1-4 (+ 全30通り保存も可、ページ上に全てある) |`);
lines.push(`| 想定所要 | 約${estMinutes}分 (sleep ${SLEEP_MS}ms、30件単位バッチ推奨) |`);
lines.push(`| **必要なスキーマ変更** | historical_alternative_odds に **bet_type 列がない**。combination='1-4' は quinella と衝突するため \`ALTER TABLE ... ADD COLUMN bet_type TEXT NOT NULL DEFAULT 'trifecta'\` が必要 (既存行は trifecta なので default で整合) |`);
lines.push(`| UNIQUE 制約 | 既存 unique index が (race_id, combination, source_quality) 等の場合、bet_type を含む新 index が必要 → 要確認 |`);
lines.push(`| 検証手順 | backup → スキーマ変更 (人間確認) → dry-run 5件 → 30件 write → quality check → 全件 |`);
lines.push(``);
lines.push(`## 判定後の分析計画`);
lines.push(``);
lines.push(`- implied 確率 = (1/odds) を overround で正規化し、当選頻度と比較`);
lines.push(`- 「2着=4号艇 26-30%」の実頻度に対し exacta 1-4 の implied が何%かを直接測定`);
lines.push(`- implied < 実頻度 なら価格の歪み (H011 復活)、implied ≈ 実頻度 なら完全織り込み (H011 終了)`);
lines.push(`- どちらでも H011 に決着がつく`);
lines.push(``);
lines.push(`---`);
lines.push(`*生成: audit-exacta-closing-odds-availability.ts*`);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, lines.join("\n"), "utf-8");

writeFileSync(OUT_JSON, JSON.stringify({
  generatedAt: now,
  feasible,
  okCount,
  sampleCount: results.length,
  urlPattern: "https://www.boatrace.jp/owpc/pc/race/odds2tf?rno=X&jcd=YY&hd=YYYYMMDD",
  cacheDir: CACHE_DIR,
  backfillProposal: {
    targetRaces: buyRaces.length,
    target2024: targetCount2024,
    target2025plus: targetCount2025,
    estMinutes,
    schemaChangeRequired: "ALTER TABLE historical_alternative_odds ADD COLUMN bet_type TEXT NOT NULL DEFAULT 'trifecta' (+ unique index 見直し)",
    humanConfirmRequired: true,
  },
  samples: results,
}, null, 2), "utf-8");

console.log(`\n=== audit 判定 ===`);
console.log(`  ${feasible ? "✅ 取得可能" : "❌ 要調査"} (${okCount}/${results.length} 検算成功)`);
console.log(`  backfill 対象: ${buyRaces.length}件 (2024: ${targetCount2024} / 2025+: ${targetCount2025}) / 想定${estMinutes}分`);
console.log(`  ⚠️ スキーマ変更 (bet_type列追加) が必要 → 人間確認待ち`);
console.log();
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);
