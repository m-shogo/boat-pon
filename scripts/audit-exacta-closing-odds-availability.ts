/**
 * audit-exacta-closing-odds-availability.ts — 読み取り専用 (DB write なし)
 *
 * exacta closing odds の公式アーカイブ取得可能性を historical BUY で監査する。
 * DB / decision / app_settings / production behavior は変更しない。
 */

import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseExactaClosingOddsAuditSleepMs,
  requireExactaClosingOddsAuditCandidates,
} from "../src/research-replay/exactaClosingOddsAuditSafety";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/exacta-closing-odds-availability.md";
const OUT_JSON = "reports/exacta-closing-odds-availability.json";
const CACHE_DIR = "data/raw/official/odds2tf";
const SLEEP_MS = parseExactaClosingOddsAuditSleepMs(process.env.AUDIT_SLEEP_MS ?? "1500");
const SAMPLES_PER_QUARTER = 2;

function atomicPublishReport(
  path: string,
  content: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function publishOfficialCache(path: string, content: string): string {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;

    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "EXACTA_CLOSING_ODDS_AUDIT_CACHE_TEMP_IDENTITY_INVALID",
    );
    if (existsSync(path)) {
      const verifiedExistingPath = assertCanonicalSingleLinkRegularFile(
        path,
        "EXACTA_CLOSING_ODDS_AUDIT_CACHE_DESTINATION_IDENTITY_INVALID",
      );
      return readFileSync(verifiedExistingPath, "utf-8");
    }
    renameSync(verifiedTempPath, path);
    return content;
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

if (!existsSync(DB_PATH)) throw new Error("EXACTA_CLOSING_ODDS_AUDIT_DB_MISSING");
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "EXACTA_CLOSING_ODDS_AUDIT_DB_IDENTITY_INVALID",
);
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");

const EXCL_VENUES = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES = [10, 11, 12];
const exclV = EXCL_VENUES.map((v) => `'${v}'`).join(",");
const exclR = EXCL_RACES.join(",");

const VENUE_CODES: Record<string, string> = {
  桐生: "01", 戸田: "02", 江戸川: "03", 平和島: "04", 多摩川: "05",
  浜名湖: "06", 蒲郡: "07", 常滑: "08", 津: "09", 三国: "10",
  びわこ: "11", 住之江: "12", 尼崎: "13", 鳴門: "14", 丸亀: "15",
  児島: "16", 宮島: "17", 徳山: "18", 下関: "19", 若松: "20",
  芦屋: "21", 福岡: "22", 唐津: "23", 大村: "24",
};

type Race = { race_id: string; date: string; venue: string; race_no: number; quarter: string };
type SettlementIssue = { race_id: string; combination: string | null; row_count: number; valid_count: number };

function assertDecisionCohortIntegrity(): void {
  const row = db.prepare(`
    SELECT COUNT(*) AS invalid
    FROM decision_history dh
    WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
      AND (dh.bet_type IS NULL OR dh.bet_type != '3連単' OR dh.returned IS NULL OR dh.returned != 0)
      AND dh.result IS NOT NULL AND dh.result != ''
      AND dh.current_odds IS NOT NULL
      AND dh.venue NOT IN (${exclV}) AND dh.race_no NOT IN (${exclR})
      AND dh.selection='1-2-3'
      AND dh.date >= '2024-01-01'
  `).get() as { invalid: number };
  if (Number(row.invalid ?? 0) > 0) {
    throw new Error("EXACTA_CLOSING_ODDS_AUDIT_DECISION_COHORT_INVALID");
  }
}

assertDecisionCohortIntegrity();

const buyRaces = db.prepare(`
  SELECT DISTINCT dh.race_id, dh.date, dh.venue, dh.race_no,
    substr(dh.date, 1, 4) || '-Q' || ((CAST(substr(dh.date, 6, 2) AS INTEGER) + 2) / 3) quarter
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.bet_type='3連単'
    AND dh.returned=0
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${exclV}) AND dh.race_no NOT IN (${exclR})
    AND dh.selection='1-2-3'
    AND dh.date >= '2024-01-01'
  ORDER BY dh.date
`).all() as Race[];

requireExactaClosingOddsAuditCandidates(buyRaces.map((r) => ({
  raceId: r.race_id,
  date: r.date,
  venue: r.venue,
  raceNo: r.race_no,
  quarter: r.quarter,
})));

function assertExactaSettlementIntegrity(): void {
  const issues = db.prepare(`
    WITH target_races AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
        AND dh.bet_type='3連単'
        AND dh.returned=0
        AND dh.result IS NOT NULL AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${exclV}) AND dh.race_no NOT IN (${exclR})
        AND dh.selection='1-2-3'
        AND dh.date >= '2024-01-01'
    )
    SELECT rp.race_id, rp.combination,
      COUNT(*) AS row_count,
      SUM(CASE WHEN rp.returned=0
        AND rp.payout_yen IS NOT NULL AND rp.payout_yen>0
        AND rp.combination IS NOT NULL AND trim(rp.combination)!=''
        THEN 1 ELSE 0 END) AS valid_count
    FROM race_payouts rp
    JOIN target_races tr ON tr.race_id=rp.race_id
    WHERE rp.bet_type='exacta'
    GROUP BY rp.race_id, rp.combination
    HAVING COUNT(*) != 1 OR valid_count != 1
    ORDER BY rp.race_id, rp.combination
    LIMIT 1
  `).all() as SettlementIssue[];
  if (issues.length > 0) {
    throw new Error("EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_INTEGRITY_INVALID");
  }

  const missing = db.prepare(`
    WITH target_races AS (
      SELECT DISTINCT dh.race_id
      FROM decision_history dh
      WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
        AND dh.bet_type='3連単'
        AND dh.returned=0
        AND dh.result IS NOT NULL AND dh.result != ''
        AND dh.current_odds IS NOT NULL
        AND dh.venue NOT IN (${exclV}) AND dh.race_no NOT IN (${exclR})
        AND dh.selection='1-2-3'
        AND dh.date >= '2024-01-01'
    )
    SELECT tr.race_id
    FROM target_races tr
    WHERE NOT EXISTS (
      SELECT 1 FROM race_payouts rp
      WHERE rp.race_id=tr.race_id AND rp.bet_type='exacta'
        AND rp.returned=0 AND rp.payout_yen>0
        AND rp.combination IS NOT NULL AND trim(rp.combination)!=''
    )
    LIMIT 1
  `).all();
  if (missing.length > 0) throw new Error("EXACTA_CLOSING_ODDS_AUDIT_SETTLEMENT_MISSING");
}

assertExactaSettlementIntegrity();

const byQuarter = new Map<string, Race[]>();
for (const r of buyRaces) {
  if (!byQuarter.has(r.quarter)) byQuarter.set(r.quarter, []);
  byQuarter.get(r.quarter)!.push(r);
}
const samples: Race[] = [];
for (const [, races] of [...byQuarter.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  samples.push(races[0]);
  if (races.length > 2 && SAMPLES_PER_QUARTER >= 2) samples.push(races[Math.floor(races.length / 2)]);
}

console.log(`BUY対象 (2024+): ${buyRaces.length}件 / 四半期数: ${byQuarter.size} / auditサンプル: ${samples.length}件`);

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
    const verifiedCachePath = assertCanonicalSingleLinkRegularFile(
      cp,
      "EXACTA_CLOSING_ODDS_AUDIT_CACHE_READ_IDENTITY_INVALID",
    );
    return { html: readFileSync(verifiedCachePath, "utf-8"), cached: true, url };
  }
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return { html: null, cached: false, url, error: `HTTP ${response.status}` };
    const html = await response.text();
    mkdirSync(dirname(cp), { recursive: true });
    const cachedHtml = publishOfficialCache(cp, html);
    return { html: cachedHtml, cached: false, url };
  } catch (error) {
    return { html: null, cached: false, url, error: String(error) };
  }
}

function parseExactaOdds(html: string): { exacta: Record<string, number>; cellCount: number } {
  const tbodyStart = html.indexOf('<tbody class="is-p3-0">');
  if (tbodyStart < 0) return { exacta: {}, cellCount: 0 };
  const tbodyEnd = html.indexOf("</tbody>", tbodyStart);
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const exacta: Record<string, number> = {};
  let cellCount = 0;
  for (const tr of tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
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
  const fetched = await fetchHtml(r);
  const res: AuditResult = {
    race_id: r.race_id, date: r.date, url: fetched.url, cached: fetched.cached,
    status: "fetch_error", cellCount: 0,
    odds14: null, odds12: null, odds13: null,
    winCombo: null, winPayout: null, winOdds: null, validated: false,
    error: fetched.error,
  };
  if (fetched.html) {
    const { exacta, cellCount } = parseExactaOdds(fetched.html);
    res.cellCount = cellCount;
    if (cellCount < 20 || exacta["1-2"] == null) {
      res.status = "parse_error";
    } else {
      res.odds14 = exacta["1-4"] ?? null;
      res.odds12 = exacta["1-2"] ?? null;
      res.odds13 = exacta["1-3"] ?? null;
      const win = db.prepare(`
        SELECT combination, payout_yen
        FROM race_payouts
        WHERE race_id=? AND bet_type='exacta'
          AND returned=0 AND payout_yen>0
          AND combination IS NOT NULL AND trim(combination)!=''
        ORDER BY combination
        LIMIT 1
      `).get(r.race_id) as { combination: string; payout_yen: number } | undefined;
      if (!win) {
        res.status = "no_payout";
      } else {
        res.winCombo = win.combination;
        res.winPayout = win.payout_yen;
        res.winOdds = exacta[win.combination] ?? null;
        const matches = res.winOdds != null && Math.abs(res.winOdds - win.payout_yen / 100) < 0.05;
        if (matches) {
          res.validated = true;
          res.status = "ok";
        } else {
          const hasF = (db.prepare(
            `SELECT COUNT(*) n FROM race_entries WHERE race_id=? AND status_code='F'`,
          ).get(r.race_id) as { n: number }).n > 0;
          if (hasF) {
            res.validated = true;
            res.status = "ok_f_refund";
          } else {
            res.status = "validation_mismatch";
          }
        }
      }
    }
  }
  results.push(res);
  const mark = res.status === "ok" || res.status === "ok_f_refund" ? "✅" : "❌";
  console.log(`[${i + 1}/${samples.length}] ${r.race_id}${fetched.cached ? " [cache]" : ""}: ${mark} ${res.status}`);
  if (!fetched.cached) await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
}

const okCount = results.filter((r) => r.status === "ok" || r.status === "ok_f_refund").length;
const fRefundCount = results.filter((r) => r.status === "ok_f_refund").length;
const feasible = okCount === results.length && results.length > 0;
const targetCount2024 = buyRaces.filter((r) => r.date < "2025-01-01").length;
const targetCount2025 = buyRaces.filter((r) => r.date >= "2025-01-01").length;
const estMinutes = Math.ceil(buyRaces.length * (SLEEP_MS + 500) / 1000 / 60);
const now = new Date().toISOString();

const lines = [
  "# exacta (2連単) closing odds 取得可能性 audit",
  "",
  `生成日時: ${now}`,
  "",
  "> **読み取り専用 audit。DB write なし。BUY は検証候補、ROI は検証指標。購入推奨ではない。**",
  "> **historical closing odds は live/T-5/timeseries odds ではない。**",
  "",
  "## audit 結果サマリ",
  "",
  "| 項目 | 値 |",
  "|---|---|",
  `| サンプル数 (四半期層化) | ${results.length} |`,
  `| 取得+検算成功 | ${okCount}/${results.length} (うちF返還で払戻検算対象外: ${fRefundCount}) |`,
  `| **判定** | ${feasible ? "✅ **取得可能**" : "❌ 要調査 (失敗サンプルあり)"} |`,
  `| キャッシュ | ${CACHE_DIR}/ |`,
  "",
  "## サンプル別検算",
  "",
  "| race_id | 取得 | 1-2 | 1-3 | 1-4 | 当選組番 | 払戻 | 当選odds | 検算 |",
  "|---|---|---:|---:|---:|---|---:|---:|---|",
];
for (const r of results) {
  lines.push(`| ${r.race_id} | ${r.status === "fetch_error" ? "❌" : r.cached ? "cache" : "fetch"} | ${r.odds12 ?? "—"} | ${r.odds13 ?? "—"} | ${r.odds14 ?? "—"} | ${r.winCombo ?? "—"} | ${r.winPayout ?? "—"} | ${r.winOdds ?? "—"} | ${r.validated ? "✅" : `❌ ${r.status}`} |`);
}
lines.push(
  "",
  "## backfill 設計提案 (実行しない)",
  "",
  `- 対象: 2024 held-out ${targetCount2024}件 + 2025+ forward ${targetCount2025}件 = ${buyRaces.length}件`,
  `- 想定所要: 約${estMinutes}分 (sleep ${SLEEP_MS}ms)`,
  "- historical_alternative_odds へ bet_type を持たせる設計変更は人間確認が必要。ここでは実行しない。",
);

const jsonReport = JSON.stringify({
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
    schemaChangeRequired: "historical_alternative_odds.bet_type (+ unique index review)",
    humanConfirmRequired: true,
  },
  samples: results,
}, null, 2);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
atomicPublishReport(
  OUT_MD,
  lines.join("\n"),
  "EXACTA_CLOSING_ODDS_AUDIT_MD_PUBLISH_TEMP_IDENTITY_INVALID",
  "EXACTA_CLOSING_ODDS_AUDIT_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
);
atomicPublishReport(
  OUT_JSON,
  jsonReport,
  "EXACTA_CLOSING_ODDS_AUDIT_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  "EXACTA_CLOSING_ODDS_AUDIT_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
);

console.log(`\n=== audit 判定 ===`);
console.log(`  ${feasible ? "✅ 取得可能" : "❌ 要調査"} (${okCount}/${results.length} 検算成功)`);
console.log(`  backfill 対象: ${buyRaces.length}件 (2024: ${targetCount2024} / 2025+: ${targetCount2025}) / 想定${estMinutes}分`);
console.log(`出力: ${OUT_MD}`);
console.log(`出力: ${OUT_JSON}`);