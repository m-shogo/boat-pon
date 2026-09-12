/** 開催文脈×1着1号艇のexacta 5買い目を横断し、1-4だけの後付け物語を崩すread-only screen。 */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { load } from "cheerio";
import { EVENT_CONTEXT_CATEGORIES, eventContextFlags } from "../src/domain/eventContext";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
  historicalExactaCompleteMarketPredicate,
} from "../src/research-replay/historicalExactaMarketAuthority";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

type OddsRow = { race_id: string; date: string; combination: string; odds: number; winner: string | null; payout_yen: number | null };
type EvalRow = OddsRow & { period: "discovery" | "forward"; implied: number; hit: boolean; flags: string[] };
type Metric = { n: number; hits: number; edgePp: number; roi: number; max2HitExclRoi: number };
const selections = ["1-2", "1-3", "1-4", "1-5", "1-6"];
const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_JSON = "reports/event-selection-matrix.json";
const OUT_MD = "reports/event-selection-matrix.md";

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=30000;");
try {
  assertSettlementCompleteness();

  const odds = db.prepare(`
    SELECT h.race_id, h.race_date AS date, h.combination, h.odds, p.combination AS winner, p.payout_yen
    FROM historical_alternative_odds h
    LEFT JOIN race_payouts p ON p.race_id=h.race_id AND p.bet_type='exacta' AND p.returned=0 AND p.payout_yen>0
    WHERE h.bet_type='exacta' AND ${historicalExactaCanonicalSourcePredicate("h")} AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
      AND h.combination IN ('1-2','1-3','1-4','1-5','1-6')
      AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
  `).all() as OddsRow[];
  const raceIds = [...new Set(odds.map(row => row.race_id))];
  const overround = new Map((db.prepare(`
    SELECT race_id, SUM(1.0/odds) AS value FROM historical_alternative_odds
    WHERE bet_type='exacta' AND ${historicalExactaCanonicalSourcePredicate()} AND race_date BETWEEN '2024-01-01' AND '2025-12-31' GROUP BY race_id HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
  `).all() as Array<{ race_id: string; value: number }>).map(row => [row.race_id, row.value]));
  const flagsByRace = new Map(raceIds.map(raceId => {
    const date = `${raceId.slice(0, 4)}-${raceId.slice(4, 6)}-${raceId.slice(6, 8)}`;
    return [raceId, eventContextFlags(readEventTitle(raceId, date), date)] as const;
  }));
  const rows: EvalRow[] = odds.map(row => ({ ...row, period: row.date <= "2024-12-31" ? "discovery" : "forward", implied: (1 / row.odds) / (overround.get(row.race_id) ?? 1), hit: row.winner === row.combination, flags: flagsByRace.get(row.race_id) ?? [] }));
  const cells = EVENT_CONTEXT_CATEGORIES.flatMap(category => selections.map(selection => {
    const inside = rows.filter(row => row.combination === selection && row.flags.includes(category.id));
    const outside = rows.filter(row => row.combination === selection && !row.flags.includes(category.id));
    return { category: category.id, categoryLabel: category.label, selection, inside: byPeriod(inside), outside: byPeriod(outside) };
  }));
  const eligible = cells.filter(cell => cell.inside.discovery.n >= 30 && cell.inside.forward.n >= 30);
  const stable = eligible.filter(cell => cell.inside.discovery.edgePp > 0 && cell.inside.forward.edgePp > 0)
    .sort((a, b) => Math.min(b.inside.discovery.edgePp, b.inside.forward.edgePp) - Math.min(a.inside.discovery.edgePp, a.inside.forward.edgePp));
  const robust = stable.filter(cell => cell.inside.discovery.max2HitExclRoi >= 1 && cell.inside.forward.max2HitExclRoi >= 1);
  const report = { generatedAt: new Date().toISOString(), safety: { readOnly: true, preDefinedFamily: true, productionConnected: false },
    family: { categories: EVENT_CONTEXT_CATEGORIES.length, selections: selections.length, cells: cells.length, eligibleCells: eligible.length }, stable, robust,
    caveats: ["安定セル順位も探索結果でありfamily-wise補正前", "1着1号艇の5買い目だけを比較", "historical closing oddsでT-5価格ではない"] };
  mkdirSync("reports", { recursive: true });
  const lines = ["# イベント文脈×exacta買い目matrix", "", `探索族: ${EVENT_CONTEXT_CATEGORIES.length}カテゴリ × ${selections.length}買い目 = ${cells.length}セル（両期n≥30: ${eligible.length}）`, "",
    "## 両期で市場残差がプラスのセル", "", "| 順位 | 文脈 | 買い目 | 2024 n / edge / ROI / max2 | 2025 n / edge / ROI / max2 |", "|---:|---|---:|---:|---:|",
    ...stable.map((cell, index) => `| ${index + 1} | ${cell.categoryLabel} | ${cell.selection} | ${metricCell(cell.inside.discovery)} | ${metricCell(cell.inside.forward)} |`), "",
    "## 最大2的中除外まで両期100%以上", "", robust.length ? robust.map(cell => `- ${cell.categoryLabel} × ${cell.selection}`).join("\n") : "該当なし。", "",
    "> この順位は仮説生成用。55セルを見た後の順位であり、future-only T-5へ事前固定するまではedge認定しない。"];
  verifyExistingOutput(OUT_JSON, "EVENT_SELECTION_MATRIX_PREEXISTING_JSON_IDENTITY_INVALID");
  verifyExistingOutput(OUT_MD, "EVENT_SELECTION_MATRIX_PREEXISTING_MD_IDENTITY_INVALID");
  atomicPublish(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "EVENT_SELECTION_MATRIX_JSON_PUBLISH_TEMP_IDENTITY_INVALID");
  atomicPublish(OUT_MD, `${lines.join("\n")}\n`, "EVENT_SELECTION_MATRIX_MD_PUBLISH_TEMP_IDENTITY_INVALID");
  console.log(`event selection matrix: races=${raceIds.length} eligible=${eligible.length} stable=${stable.length} robust=${robust.length}`);
} finally { db.close(); }

function assertSettlementCompleteness(): void {
  const rows = db.prepare(`
    WITH population AS (
      SELECT h.race_id, h.race_date AS date
      FROM historical_alternative_odds h
      WHERE h.bet_type='exacta'
        AND ${historicalExactaCanonicalSourcePredicate("h")}
        AND h.race_date BETWEEN '2024-01-01' AND '2025-12-31'
        AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.race_id=h.race_id AND re.status_code='F')
      GROUP BY h.race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
    ), settlement AS (
      SELECT rp.race_id,
        COUNT(*) AS payout_rows,
        SUM(CASE WHEN rp.returned = 0 AND rp.payout_yen IS NOT NULL AND rp.payout_yen > 0 AND rp.combination IS NOT NULL AND trim(rp.combination) != ''
          AND EXISTS (
            SELECT 1 FROM historical_alternative_odds winner_h
            WHERE winner_h.race_id=rp.race_id
              AND winner_h.bet_type='exacta'
              AND ${historicalExactaCanonicalSourcePredicate("winner_h")}
              AND winner_h.combination=rp.combination
          ) THEN 1 ELSE 0 END) AS valid_rows
      FROM race_payouts rp
      WHERE rp.bet_type='exacta'
      GROUP BY rp.race_id
    )
    SELECT
      CASE WHEN p.date <= '2024-12-31' THEN 'discovery' ELSE 'forward' END AS period,
      COUNT(*) AS total,
      SUM(CASE WHEN s.payout_rows = 1 AND s.valid_rows = 1 THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN COALESCE(s.payout_rows, 0) > 1 THEN 1 ELSE 0 END) AS ambiguous
    FROM population p
    LEFT JOIN settlement s ON s.race_id=p.race_id
    GROUP BY period
    ORDER BY period
  `).all() as Array<{ period: string; total: number; settled: number; ambiguous: number }>;

  const byPeriod = Object.fromEntries(["discovery", "forward"].map(period => {
    const row = rows.find(candidate => candidate.period === period);
    const total = Number(row?.total ?? 0);
    const settled = Number(row?.settled ?? 0);
    const ambiguous = Number(row?.ambiguous ?? 0);
    return [period, { total, settled, missing: total - settled, ambiguous }];
  }));

  const invalid = ["discovery", "forward"].some(period => {
    const { total, settled, missing, ambiguous } = byPeriod[period];
    return !Number.isInteger(total) || !Number.isInteger(settled) || !Number.isInteger(ambiguous) || total <= 0 || settled !== total || missing !== 0 || ambiguous !== 0;
  });

  if (invalid) {
    throw new Error(`EVENT_SELECTION_MATRIX_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(byPeriod)}`);
  }
}

function readEventTitle(raceId: string, date: string) {
  const path = `data/raw/kyotei24/odds/${date}/${raceId}-odds3t.html`;
  if (!existsSync(path)) return "";
  const verifiedPath = assertCanonicalSingleLinkRegularFile(path, "EVENT_SELECTION_MATRIX_EVENT_TITLE_IDENTITY_INVALID");
  const $ = load(readFileSync(verifiedPath, "utf8"));
  return $(".rname a").first().text().replace(/\s+/g, " ").trim();
}
function verifyExistingOutput(path: string, identityErrorCode: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, identityErrorCode);
}
function atomicPublish(path: string, content: string, identityErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, identityErrorCode);
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}
function byPeriod(rows: EvalRow[]) { return { discovery: metric(rows.filter(row => row.period === "discovery")), forward: metric(rows.filter(row => row.period === "forward")) }; }
function metric(rows: EvalRow[]): Metric { const payouts=rows.filter(row=>row.hit).map(row=>requiredPayout(row)).sort((a,b)=>b-a); const total=payouts.reduce((a,b)=>a+b,0); const expected=rows.reduce((sum,row)=>sum+row.implied,0); return {n:rows.length,hits:payouts.length,edgePp:rows.length?(payouts.length-expected)/rows.length*100:0,roi:rows.length?total/(rows.length*100):0,max2HitExclRoi:rows.length>2?(total-(payouts[0]??0)-(payouts[1]??0))/((rows.length-2)*100):0}; }
function requiredPayout(row: EvalRow): number { if(row.payout_yen===null || row.payout_yen<=0) throw new Error(`EVENT_SELECTION_MATRIX_HIT_PAYOUT_MISSING race=${row.race_id} selection=${row.combination}`); return row.payout_yen; }
function pct(value:number){return `${(value*100).toFixed(1)}%`;}
function metricCell(value:Metric){return `${value.n} / ${value.edgePp>=0?"+":""}${value.edgePp.toFixed(2)}pt / ${pct(value.roi)} / ${pct(value.max2HitExclRoi)}`;}
