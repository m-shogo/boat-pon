/**
 * ROI Miss Pattern Analysis — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 *
 * 目的:
 * 外れ方を分析し、どの買い方selectorが有望かを特定する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-miss-patterns.md";
const OUT_JSON = "reports/roi-miss-patterns.json";
const STAKE = 100;
const STRONG_MONTHS = new Set([4, 6, 8, 12]);

if (!existsSync(DB_PATH)) {
  console.error(`[miss-patterns] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ───────────────── Types ─────────────────

type Row = {
  id: number;
  raceId: string;
  date: string;
  ym: string;
  month: number;
  venue: string;
  raceNo: number;
  selection: string;
  selNums: [number, number, number]; // [1st, 2nd, 3rd]
  result: string;
  resultNums: number[];
  hit: boolean;
  currentOdds: number;
  isStrongMonth: boolean;
  isIsBase: boolean;
  isParts0: boolean;
  headFlyingCount: number | null;
  isHeadFZero: boolean;
  isWindGte3: boolean;
  isOddsGte80: boolean;
  // miss pattern (computed later)
  missType: MissType;
};

type MissType =
  | "HIT"
  | "HEAD_CORRECT_REST_WRONG"    // 1着は当たったが2/3着が外れ
  | "HEAD_CORRECT_REVERSED"      // 1着は当たったが2/3着が逆
  | "TOP3_INCLUDED"              // 買い目3艇はすべて結果Top3に含まれていた
  | "HEAD_FIXED_WOULD_HIT"       // 1-X-X流しなら当たった (結果が1-?-? で2/3は違う)
  | "FIRST_SECOND_FIXED_WOULD_HIT" // 1-2-X流しなら当たった
  | "COMPLETE_MISS";             // 完全外れ

type SelectorSimulation = {
  selectorName: string;
  description: string;
  ticketsPerRace: number;
  totalTickets: number;
  totalStake: number;
  hits: number;
  totalReturn: number;
  roi: number;
  roiExMaxHit: number;
  hitRate: number;
  maxHitOdds: number;
  avgOdds: number;
  warning: string;
  recommendation: "PROMISING" | "WATCH" | "DANGEROUS" | "NO_BUY";
};

type MissPatternReport = {
  generatedAt: string;
  dbPath: string;
  totalRows: number;
  totalHits: number;
  totalMisses: number;
  // miss breakdown
  missBreakdown: { type: MissType; n: number; rate: number; description: string }[];
  // by month
  monthlyMissBreakdown: { month: number; label: string; n: number; hits: number; hitRate: number; topMissType: MissType; description: string }[];
  // by condition
  conditionMissBreakdown: { label: string; n: number; hits: number; hitRate: number; topMissType: MissType }[];
  // by odds band
  oddsMissBreakdown: { label: string; n: number; hits: number; hitRate: number; topMissType: MissType }[];
  // selector simulations
  selectorSimulations: SelectorSimulation[];
  // isBase specific
  isBaseMissBreakdown: { type: MissType; n: number; rate: number }[];
  // recommendations
  selectorRecommendations: string[];
};

// ───────────────── Load ─────────────────

function loadRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
      dh.current_odds, dh.result,
      rw.wind_speed_mps,
      re.parts_changed_count,
      ed.start_timing AS head_ex_st,
      rp.flying_count AS head_flying_count
    FROM decision_history dh
    LEFT JOIN race_weather rw ON rw.race_id = dh.race_id
    LEFT JOIN race_equipment re ON re.race_id = dh.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = re.course
    LEFT JOIN exhibition_data ed ON ed.race_id = dh.race_id
      AND CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) = ed.course
    LEFT JOIN race_entries ra ON ra.race_id = dh.race_id
      AND ra.entry_course = CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT)
    LEFT JOIN racer_profiles rp ON rp.registration_no = ra.racer_reg
    WHERE dh.run_kind = 'historical-backfill'
      AND dh.decision = 'BUY'
      AND dh.current_odds IS NOT NULL
      AND dh.result IS NOT NULL
    ORDER BY dh.date, dh.id
  `).all() as Array<{
    id: number; race_id: string; date: string; venue: string; race_no: number;
    selection: string; current_odds: number; result: string | null;
    wind_speed_mps: number | null; parts_changed_count: number | null;
    head_ex_st: number | null; head_flying_count: number | null;
  }>;

  return raw.map((r) => {
    const selNums = parseNums(r.selection);
    const resultNums = parseNums(r.result ?? "");
    const hit = r.result != null && r.result === r.selection;
    const month = Number(r.date.slice(5, 7));
    const isParts0 = r.parts_changed_count != null && r.parts_changed_count === 0;
    const isHeadFZero = r.head_flying_count != null && r.head_flying_count === 0;
    const isWindGte3 = r.wind_speed_mps != null && r.wind_speed_mps >= 3;
    const exSt = r.head_ex_st;
    const isExStSafe = exSt == null || !(exSt >= 0.10 && exSt < 0.15);
    const isStrongMonth = STRONG_MONTHS.has(month);
    const isIsBase =
      isStrongMonth && isParts0 &&
      r.race_no < 10 && r.venue !== "戸田" && r.venue !== "多摩川" &&
      isWindGte3 && (r.head_flying_count == null || r.head_flying_count === 0) && isExStSafe;

    const missType = computeMissType(selNums, resultNums, hit);

    return {
      id: r.id, raceId: r.race_id, date: r.date, ym: r.date.slice(0, 7),
      month, venue: r.venue, raceNo: r.race_no, selection: r.selection,
      selNums: [selNums[0] ?? 0, selNums[1] ?? 0, selNums[2] ?? 0],
      result: r.result ?? "", resultNums, hit, currentOdds: r.current_odds,
      headFlyingCount: r.head_flying_count,
      isStrongMonth, isIsBase, isParts0, isHeadFZero, isWindGte3,
      isOddsGte80: r.current_odds >= 80, missType,
    };
  });
}

function parseNums(s: string): number[] {
  return s.split("-").map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function computeMissType(selNums: number[], resultNums: number[], hit: boolean): MissType {
  if (hit) return "HIT";
  if (selNums.length < 3 || resultNums.length < 3) return "COMPLETE_MISS";

  const [s1, s2, s3] = selNums;
  const [r1, r2, r3] = resultNums;

  // 完全一致 = HIT 済み
  // 1着正解
  if (s1 === r1) {
    // 2着も正解 → 3着だけ外れ = HEAD_FIXED_WOULD_HIT (1-2-X流しなら当たった)
    if (s2 === r2) {
      return "FIRST_SECOND_FIXED_WOULD_HIT";
    }
    // 2/3着が逆
    if (s2 === r3 && s3 === r2) {
      return "HEAD_CORRECT_REVERSED";
    }
    // 2/3着のうちどちらか入っている
    const selRest = new Set([s2, s3]);
    if (selRest.has(r2) || selRest.has(r3)) {
      return "HEAD_CORRECT_REST_WRONG";
    }
    return "HEAD_FIXED_WOULD_HIT";
  }

  // 買い目3艇が結果Top3に全部含まれている
  const selSet = new Set([s1, s2, s3]);
  const resSet = new Set([r1, r2, r3]);
  if ([...selSet].every((n) => resSet.has(n))) {
    return "TOP3_INCLUDED";
  }

  return "COMPLETE_MISS";
}

// ───────────────── Selector Simulation ─────────────────

type SelectorDef = {
  name: string;
  description: string;
  ticketsPerRace: number;
  // returns list of (selection, odds_multiplier) for a given row
  // odds_multiplier = 1 means use current_odds directly
  // For multi-ticket selectors, we simulate each ticket separately
  simulate: (row: Row) => Array<{ key: string; hit: boolean; odds: number }>;
};

// We need the trifecta result payouts from DB to simulate alternate tickets
// For simplicity, use odds estimation: alternate combinations get approximate odds
// We'll use actual DB result + current_odds for the original ticket,
// and for "would have hit" scenarios we use actual payout odds from race_payouts table

function loadTrifectaPayouts(raceIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  // chunk 400
  for (let i = 0; i < raceIds.length; i += 400) {
    const chunk = raceIds.slice(i, i + 400);
    const ph = chunk.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT race_id, payout_yen FROM race_payouts
      WHERE bet_type='trifecta' AND race_id IN (${ph}) AND returned=0
    `).all(...chunk) as Array<{ race_id: string; payout_yen: number }>;
    for (const r of rows) {
      if (!map.has(r.race_id)) map.set(r.race_id, r.payout_yen);
    }
  }
  return map;
}

function calcMetric(rows: Row[]): { n: number; hits: number; hitRate: number; roi: number; roiExMaxHit: number; maxHitOdds: number; avgOdds: number } {
  const n = rows.length;
  if (n === 0) return { n: 0, hits: 0, hitRate: 0, roi: 0, roiExMaxHit: 0, maxHitOdds: 0, avgOdds: 0 };
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const avgOdds = rows.reduce((s, r) => s + r.currentOdds, 0) / n;
  return {
    n, hits, hitRate: hits / n,
    roi: (total / n) * 100,
    roiExMaxHit: (ex1 / n) * 100,
    maxHitOdds: hitOdds[0] ?? 0,
    avgOdds,
  };
}

// ───────────────── Analysis ─────────────────

function analyzeMissPatterns(rows: Row[]): MissPatternReport {
  const payoutsMap = loadTrifectaPayouts([...new Set(rows.map((r) => r.raceId))]);

  const hits = rows.filter((r) => r.hit);
  const misses = rows.filter((r) => !r.hit);

  // Miss type breakdown
  const missTypeCounts = new Map<MissType, number>();
  const allTypes: MissType[] = ["HIT", "HEAD_CORRECT_REVERSED", "TOP3_INCLUDED", "HEAD_CORRECT_REST_WRONG", "FIRST_SECOND_FIXED_WOULD_HIT", "HEAD_FIXED_WOULD_HIT", "COMPLETE_MISS"];
  for (const t of allTypes) missTypeCounts.set(t, 0);
  for (const r of rows) missTypeCounts.set(r.missType, (missTypeCounts.get(r.missType) ?? 0) + 1);

  const missBreakdown = allTypes.filter((t) => t !== "HIT").map((t) => ({
    type: t,
    n: missTypeCounts.get(t) ?? 0,
    rate: misses.length > 0 ? (missTypeCounts.get(t) ?? 0) / misses.length : 0,
    description: missTypeDesc(t),
  }));

  // Monthly miss breakdown
  const monthlyMiss: MissPatternReport["monthlyMissBreakdown"] = [];
  for (let m = 1; m <= 12; m++) {
    const rs = rows.filter((r) => r.month === m);
    if (rs.length < 5) continue;
    const mHits = rs.filter((r) => r.hit).length;
    const mMisses = rs.filter((r) => !r.hit);
    const topMissType = findTopMissType(mMisses);
    monthlyMiss.push({
      month: m,
      label: `月${m}${STRONG_MONTHS.has(m) ? "⭐" : ""}`,
      n: rs.length, hits: mHits, hitRate: rs.length > 0 ? mHits / rs.length : 0,
      topMissType,
      description: `最多外れパターン: ${topMissType} — ${missTypeDesc(topMissType)}`,
    });
  }

  // Condition miss breakdown
  const condMiss: MissPatternReport["conditionMissBreakdown"] = [];
  const condDefs: { label: string; pred: (r: Row) => boolean }[] = [
    { label: "isBase条件", pred: (r) => r.isIsBase },
    { label: "強月×parts=0", pred: (r) => r.isStrongMonth && r.isParts0 },
    { label: "弱月(その他)", pred: (r) => !r.isStrongMonth },
    { label: "parts=0", pred: (r) => r.isParts0 },
    { label: "partsあり", pred: (r) => !r.isParts0 },
    { label: "headF=0", pred: (r) => r.isHeadFZero },
    { label: "headFあり", pred: (r) => r.headFlyingCount != null && r.headFlyingCount > 0 },
  ] as Array<{ label: string; pred: (r: Row) => boolean }>;
  for (const { label, pred } of condDefs) {
    const rs = rows.filter(pred);
    if (rs.length < 5) continue;
    const rHits = rs.filter((r) => r.hit).length;
    condMiss.push({
      label, n: rs.length, hits: rHits,
      hitRate: rs.length > 0 ? rHits / rs.length : 0,
      topMissType: findTopMissType(rs.filter((r) => !r.hit)),
    });
  }

  // Odds band miss breakdown
  const oddsBands = [
    { label: "odds<30", pred: (r: Row) => r.currentOdds < 30 },
    { label: "30-50", pred: (r: Row) => r.currentOdds >= 30 && r.currentOdds < 50 },
    { label: "50-80", pred: (r: Row) => r.currentOdds >= 50 && r.currentOdds < 80 },
    { label: ">=80", pred: (r: Row) => r.currentOdds >= 80 },
  ];
  const oddsMiss = oddsBands.map(({ label, pred }) => {
    const rs = rows.filter(pred);
    const rHits = rs.filter((r) => r.hit).length;
    return {
      label, n: rs.length, hits: rHits,
      hitRate: rs.length > 0 ? rHits / rs.length : 0,
      topMissType: findTopMissType(rs.filter((r) => !r.hit)),
    };
  });

  // isBase miss breakdown
  const isBaseMisses = rows.filter((r) => r.isIsBase && !r.hit);
  const isBaseMissBreakdown = allTypes.filter((t) => t !== "HIT").map((t) => ({
    type: t,
    n: isBaseMisses.filter((r) => r.missType === t).length,
    rate: isBaseMisses.length > 0 ? isBaseMisses.filter((r) => r.missType === t).length / isBaseMisses.length : 0,
  }));

  // Selector simulations
  const selectorSimulations = simulateSelectors(rows, payoutsMap);

  // Recommendations
  const recommendations = buildRecommendations(rows, missBreakdown, selectorSimulations);

  return {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    totalRows: rows.length,
    totalHits: hits.length,
    totalMisses: misses.length,
    missBreakdown,
    monthlyMissBreakdown: monthlyMiss,
    conditionMissBreakdown: condMiss,
    oddsMissBreakdown: oddsMiss,
    selectorSimulations,
    isBaseMissBreakdown,
    selectorRecommendations: recommendations,
  };
}

function findTopMissType(misses: Row[]): MissType {
  if (misses.length === 0) return "COMPLETE_MISS";
  const counts = new Map<MissType, number>();
  for (const r of misses) counts.set(r.missType, (counts.get(r.missType) ?? 0) + 1);
  let top: MissType = "COMPLETE_MISS";
  let topN = 0;
  for (const [t, n] of counts) {
    if (n > topN) { topN = n; top = t; }
  }
  return top;
}

function missTypeDesc(t: MissType): string {
  switch (t) {
    case "HIT": return "的中";
    case "HEAD_CORRECT_REVERSED": return "1着正解・2/3着が逆 → REVERSE selectorで的中可能性";
    case "TOP3_INCLUDED": return "買い目3艇がTop3に全部入っていた → TOP3_BOX selectorで的中可能性";
    case "HEAD_CORRECT_REST_WRONG": return "1着正解・2/3着が一部外れ → HEAD_FIXED_FLOWで改善余地";
    case "FIRST_SECOND_FIXED_WOULD_HIT": return "1着2着正解・3着だけ外れ → 1-2固定3着流しで的中可能性";
    case "HEAD_FIXED_WOULD_HIT": return "1着正解・2/3着外れ → 1着固定流しで的中の可能性";
    case "COMPLETE_MISS": return "完全外れ";
  }
}

function simulateSelectors(rows: Row[], payoutsMap: Map<string, number>): SelectorSimulation[] {
  const sims: SelectorSimulation[] = [];

  // SINGLE: 現在の1点買い (baseline)
  {
    const n = rows.length;
    const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
    const total = hitOdds.reduce((s, o) => s + o, 0);
    const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
    sims.push({
      selectorName: "SINGLE",
      description: "現在の1点買い (baseline)",
      ticketsPerRace: 1,
      totalTickets: n,
      totalStake: n * STAKE,
      hits: hitOdds.length,
      totalReturn: total * STAKE,
      roi: n > 0 ? (total / n) * 100 : 0,
      roiExMaxHit: n > 0 ? (ex1 / n) * 100 : 0,
      hitRate: n > 0 ? hitOdds.length / n : 0,
      maxHitOdds: hitOdds[0] ?? 0,
      avgOdds: n > 0 ? rows.reduce((s, r) => s + r.currentOdds, 0) / n : 0,
      warning: "baseline",
      recommendation: "WATCH",
    });
  }

  // REVERSE: 1着と2着を入れ替えた1点追加 (2点買い)
  // 的中: 元が当たる OR resultが s2-s1-s3 形式
  {
    const n = rows.length;
    const totalTickets = n * 2;
    const totalStake = totalTickets * STAKE;
    let hits = 0;
    let totalReturn = 0;
    const hitOdds: number[] = [];
    for (const r of rows) {
      if (r.hit) {
        hits++;
        totalReturn += r.currentOdds * STAKE;
        hitOdds.push(r.currentOdds);
      } else {
        // check if reversed would hit
        const [s1, s2, s3] = r.selNums;
        const reversed = `${s2}-${s1}-${s3}`;
        if (r.result === reversed) {
          // get payout for reversed ticket — use current_odds as approximation
          // In reality would need actual odds for this combination
          // We'll estimate: reversed 2nd ticket odds won't be available, use 0 (conservative)
          // But we can check if current result trifecta payout is available
          const payoutYen = payoutsMap.get(r.raceId);
          const estimatedOdds = payoutYen ? payoutYen / 100 : 0;
          if (estimatedOdds > 0) {
            hits++;
            totalReturn += estimatedOdds * STAKE;
            hitOdds.push(estimatedOdds);
          }
        }
      }
    }
    hitOdds.sort((a, b) => b - a);
    const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
    const roi = totalStake > 0 ? (totalReturn / totalStake) * 100 : 0;
    const roiEx = totalStake > 0 ? ((totalReturn - (hitOdds[0] ?? 0) * STAKE) / totalStake) * 100 : 0;
    sims.push({
      selectorName: "REVERSE",
      description: "1-2着入れ替え 2点買い (点数2倍)",
      ticketsPerRace: 2,
      totalTickets, totalStake, hits, totalReturn,
      roi, roiExMaxHit: roiEx,
      hitRate: n > 0 ? hits / n : 0,
      maxHitOdds: hitOdds[0] ?? 0,
      avgOdds: 0,
      warning: "点数2倍注意: コスト増加分をROI改善が上回るか要確認",
      recommendation: roi > 105 ? "WATCH" : "DANGEROUS",
    });
  }

  // TOP3_BOX: 選択3艇の6通りBOX (6点買い)
  {
    const n = rows.length;
    const totalTickets = n * 6;
    const totalStake = totalTickets * STAKE;
    let hits = 0;
    let totalReturn = 0;
    const hitOdds: number[] = [];
    for (const r of rows) {
      const [s1, s2, s3] = r.selNums;
      const selSet = new Set([s1, s2, s3]);
      const resSet = new Set(r.resultNums.slice(0, 3));
      const wouldHit = selSet.size === 3 && [...selSet].every((n) => resSet.has(n));
      if (wouldHit) {
        hits++;
        const payoutYen = payoutsMap.get(r.raceId);
        const estimatedOdds = r.hit ? r.currentOdds : (payoutYen ? payoutYen / 100 : 0);
        totalReturn += estimatedOdds * STAKE;
        hitOdds.push(estimatedOdds);
      }
    }
    hitOdds.sort((a, b) => b - a);
    const roi = totalStake > 0 ? (totalReturn / totalStake) * 100 : 0;
    const roiEx = totalStake > 0 ? ((totalReturn - (hitOdds[0] ?? 0) * STAKE) / totalStake) * 100 : 0;
    sims.push({
      selectorName: "TOP3_BOX",
      description: "3艇BOX 6点買い (⚠️常時BOXは危険候補)",
      ticketsPerRace: 6,
      totalTickets, totalStake, hits, totalReturn,
      roi, roiExMaxHit: roiEx,
      hitRate: n > 0 ? hits / n : 0,
      maxHitOdds: hitOdds[0] ?? 0,
      avgOdds: 0,
      warning: "⚠️ 点数6倍: 常時BOX適用は危険候補。ROI改善が大幅でなければ不採用",
      recommendation: roi > 110 ? "WATCH" : "DANGEROUS",
    });
  }

  // HEAD_FIXED_FLOW: 1着固定3着流し (5点: 1-X-Y 全組み合わせ from boats 1-6)
  // 1艇固定で残り5艇から2着3着 = 5*4=20通りだが現実的には3着流し=1-2-X,1-3-X,1-4-X,1-5-X (Xは1/2/3以外)
  // 簡略化: 1着正解なら必ずhit (1-?-? を全通り流す = 必中)
  // → 点数は5艇なら 1-X-Y: 5C2=10通り、実際は多点になるので5点想定
  {
    const n = rows.length;
    const TICKETS_PER_RACE = 10; // 1着固定の2/3着組み合わせ (5艇選択 = C(5,2)=10)
    const totalTickets = n * TICKETS_PER_RACE;
    const totalStake = totalTickets * STAKE;
    let hits = 0;
    let totalReturn = 0;
    const hitOdds: number[] = [];
    for (const r of rows) {
      const [s1] = r.selNums;
      const [r1] = r.resultNums;
      if (s1 === r1) {
        // 1着固定流しなら当たる
        hits++;
        const payoutYen = payoutsMap.get(r.raceId);
        const estimatedOdds = r.hit ? r.currentOdds : (payoutYen ? payoutYen / 100 : 0);
        totalReturn += estimatedOdds * STAKE;
        hitOdds.push(estimatedOdds);
      }
    }
    hitOdds.sort((a, b) => b - a);
    const roi = totalStake > 0 ? (totalReturn / totalStake) * 100 : 0;
    const roiEx = totalStake > 0 ? ((totalReturn - (hitOdds[0] ?? 0) * STAKE) / totalStake) * 100 : 0;
    sims.push({
      selectorName: "HEAD_FIXED_FLOW",
      description: `1着固定 2/3着流し ${TICKETS_PER_RACE}点買い (⚠️常時FLOWは危険候補)`,
      ticketsPerRace: TICKETS_PER_RACE,
      totalTickets, totalStake, hits, totalReturn,
      roi, roiExMaxHit: roiEx,
      hitRate: n > 0 ? hits / n : 0,
      maxHitOdds: hitOdds[0] ?? 0,
      avgOdds: 0,
      warning: `⚠️ 点数${TICKETS_PER_RACE}倍: 常時採用不可 (全レース適用禁止)。特定条件に絞った部分適用のみ要検討`,
      recommendation: "DANGEROUS" as const,
    });
  }

  // FIRST_SECOND_FIXED_FLOW: 1-2固定 3着流し (4点: 1-2-X, X=3,4,5,6)
  {
    const n = rows.length;
    const TICKETS_PER_RACE = 4;
    const totalTickets = n * TICKETS_PER_RACE;
    const totalStake = totalTickets * STAKE;
    let hits = 0;
    let totalReturn = 0;
    const hitOdds: number[] = [];
    for (const r of rows) {
      const [s1, s2] = r.selNums;
      const [r1, r2] = r.resultNums;
      if (s1 === r1 && s2 === r2) {
        hits++;
        const payoutYen = payoutsMap.get(r.raceId);
        const estimatedOdds = r.hit ? r.currentOdds : (payoutYen ? payoutYen / 100 : 0);
        totalReturn += estimatedOdds * STAKE;
        hitOdds.push(estimatedOdds);
      }
    }
    hitOdds.sort((a, b) => b - a);
    const roi = totalStake > 0 ? (totalReturn / totalStake) * 100 : 0;
    const roiEx = totalStake > 0 ? ((totalReturn - (hitOdds[0] ?? 0) * STAKE) / totalStake) * 100 : 0;
    sims.push({
      selectorName: "FIRST_SECOND_FIXED_FLOW",
      description: `1-2着固定 3着流し ${TICKETS_PER_RACE}点買い`,
      ticketsPerRace: TICKETS_PER_RACE,
      totalTickets, totalStake, hits, totalReturn,
      roi, roiExMaxHit: roiEx,
      hitRate: n > 0 ? hits / n : 0,
      maxHitOdds: hitOdds[0] ?? 0,
      avgOdds: 0,
      warning: `点数${TICKETS_PER_RACE}倍: 1-2着正解率に依存。改善幅要確認`,
      recommendation: roi > 105 ? "WATCH" : "NO_BUY",
    });
  }

  return sims;
}

function buildRecommendations(
  rows: Row[],
  missBreakdown: MissPatternReport["missBreakdown"],
  sims: SelectorSimulation[],
): string[] {
  const total = rows.filter((r) => !r.hit).length;
  if (total === 0) return ["外れなし"];

  const recs: string[] = [];
  const top3IncRate = missBreakdown.find((m) => m.type === "TOP3_INCLUDED")?.rate ?? 0;
  const reversedRate = missBreakdown.find((m) => m.type === "HEAD_CORRECT_REVERSED")?.rate ?? 0;
  const headFixedRate = (missBreakdown.find((m) => m.type === "HEAD_FIXED_WOULD_HIT")?.rate ?? 0) +
    (missBreakdown.find((m) => m.type === "HEAD_CORRECT_REST_WRONG")?.rate ?? 0) +
    (missBreakdown.find((m) => m.type === "HEAD_CORRECT_REVERSED")?.rate ?? 0);
  const first2FixedRate = missBreakdown.find((m) => m.type === "FIRST_SECOND_FIXED_WOULD_HIT")?.rate ?? 0;

  if (top3IncRate > 0.15) {
    recs.push(`TOP3_BOX: 外れのうち${pct(top3IncRate)}が3艇Box該当 → Box有効だが点数6倍注意`);
  }
  if (reversedRate > 0.1) {
    recs.push(`REVERSE: 外れのうち${pct(reversedRate)}が逆順外れ → 2点買い追加で改善余地あり`);
  }
  if (headFixedRate > 0.3) {
    recs.push(`HEAD_FIXED_FLOW: 外れのうち${pct(headFixedRate)}が1着正解 → **常時採用不可** (点数10倍: 全レース一律適用は禁止)。特定条件を絞った部分検討のみ`);
  }
  if (first2FixedRate > 0.1) {
    recs.push(`FIRST_SECOND_FIXED_FLOW: 外れのうち${pct(first2FixedRate)}が1-2固定3着外れ → 追加1点で改善可能`);
  }

  // Compare sims to single
  const single = sims.find((s) => s.selectorName === "SINGLE");
  if (single) {
    for (const sim of sims.filter((s) => s.selectorName !== "SINGLE")) {
      const roiDiff = sim.roi - single.roi;
      if (roiDiff > 5) {
        recs.push(`${sim.selectorName}: ROI ${pct(roiDiff / 100)} 改善 (${pct(single.roi / 100)} → ${pct(sim.roi / 100)}), 点数${sim.ticketsPerRace}倍`);
      } else if (roiDiff < -5) {
        recs.push(`${sim.selectorName}: ROI ${pct(Math.abs(roiDiff) / 100)} 悪化 → 不採用推奨`);
      }
    }
  }

  if (recs.length === 0) recs.push("現時点では SINGLE (1点買い) が最も効率的な可能性あり");

  recs.push("");
  recs.push("⚠️ 常時BOX/常時FLOWは危険候補: 全レースに適用すると期待値が下がるリスクあり。");
  recs.push("条件を絞った上での部分適用のみ検討してください。");

  return recs;
}

// ───────────────── Render ─────────────────

function renderMd(r: MissPatternReport): string {
  const lines: string[] = [];
  lines.push("# ROI Miss Pattern Analysis", "");
  lines.push(`生成: ${r.generatedAt} / DB: ${r.dbPath}`, "");
  lines.push(`対象: historical-backfill BUY n=${r.totalRows} / hits=${r.totalHits} / misses=${r.totalMisses}`, "");
  lines.push("");

  // 外れ方サマリー
  lines.push("## 1. 外れ方サマリー", "");
  lines.push("| 外れパターン | 件数 | 外れ中割合 | 説明 |");
  lines.push("|---|---:|---:|---|");
  for (const b of r.missBreakdown) {
    lines.push(`| ${b.type} | ${b.n} | ${pct(b.rate)} | ${b.description} |`);
  }
  lines.push("");

  // 月別外れ
  lines.push("## 2. 月別 外れパターン", "");
  lines.push("| 月 | n | hits | hitRate | 最多外れパターン |");
  lines.push("|---|---:|---:|---:|---|");
  for (const m of r.monthlyMissBreakdown) {
    lines.push(`| ${m.label} | ${m.n} | ${m.hits} | ${pct(m.hitRate)} | ${m.topMissType} |`);
  }
  lines.push("");

  // 条件別外れ
  lines.push("## 3. 条件別 外れパターン", "");
  lines.push("| 条件 | n | hits | hitRate | 最多外れパターン |");
  lines.push("|---|---:|---:|---:|---|");
  for (const c of r.conditionMissBreakdown) {
    lines.push(`| ${c.label} | ${c.n} | ${c.hits} | ${pct(c.hitRate)} | ${c.topMissType} |`);
  }
  lines.push("");

  // オッズ帯別外れ
  lines.push("## 4. オッズ帯別 外れパターン", "");
  lines.push("| オッズ帯 | n | hits | hitRate | 最多外れパターン |");
  lines.push("|---|---:|---:|---:|---|");
  for (const o of r.oddsMissBreakdown) {
    lines.push(`| ${o.label} | ${o.n} | ${o.hits} | ${pct(o.hitRate)} | ${o.topMissType} |`);
  }
  lines.push("");

  // isBase条件の外れ
  lines.push("## 5. isBase条件内の外れパターン", "");
  lines.push("| 外れパターン | 件数 | 外れ中割合 |");
  lines.push("|---|---:|---:|");
  for (const b of r.isBaseMissBreakdown) {
    lines.push(`| ${b.type} | ${b.n} | ${pct(b.rate)} |`);
  }
  lines.push("");

  // セレクターシミュレーション
  lines.push("## 6. 買い方Selector シミュレーション", "");
  lines.push("> **⚠️ 注意**: 常時BOXや常時FLOWは危険候補です。点数増加分をROI改善が上回る場合のみ部分適用を検討してください。", "");
  lines.push("| Selector | 点数/R | hits | hitRate | ROI | roiExMaxHit | maxHit | 評価 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const s of r.selectorSimulations) {
    const icon = s.recommendation === "PROMISING" ? "✅" : s.recommendation === "WATCH" ? "△" : s.recommendation === "DANGEROUS" ? "⚠️" : "❌";
    lines.push(`| ${s.selectorName} | ${s.ticketsPerRace} | ${s.hits} | ${pct(s.hitRate)} | ${pct(s.roi / 100)} | ${pct(s.roiExMaxHit / 100)} | ${num(s.maxHitOdds)} | ${icon} ${s.recommendation} |`);
  }
  lines.push("");
  lines.push("**Selectorの解説:**", "");
  for (const s of r.selectorSimulations) {
    lines.push(`- **${s.selectorName}**: ${s.description}`);
    lines.push(`  警告: ${s.warning}`);
    lines.push("");
  }

  // レコメンデーション
  lines.push("## 7. 買い方Selector 推奨", "");
  for (const rec of r.selectorRecommendations) {
    lines.push(rec ? `- ${rec}` : "");
  }
  lines.push("");

  lines.push("---");
  lines.push(`*生成: ${r.generatedAt} / DB: ${r.dbPath}*`);
  return lines.join("\n");
}

// ───────────────── Helpers ─────────────────

function pct(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(2)}%`;
}

function num(v: number): string {
  if (!Number.isFinite(v)) return "-";
  return v.toFixed(2);
}

// ───────────────── Main ─────────────────

console.log("[miss-patterns] loading rows...");
const rows = loadRows();
console.log(`[miss-patterns] loaded ${rows.length} rows`);

const report = analyzeMissPatterns(rows);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, renderMd(report), "utf8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(`[miss-patterns] done → ${OUT_MD} / ${OUT_JSON}`);
console.log("  Miss breakdown:");
for (const b of report.missBreakdown) {
  console.log(`    ${b.type}: ${b.n} (${pct(b.rate)})`);
}
console.log("  Selector recommendations:");
for (const r of report.selectorRecommendations) {
  if (r) console.log(`    ${r}`);
}
