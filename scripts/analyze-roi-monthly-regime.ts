/**
 * ROI Monthly Regime Analysis — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 *
 * 目的:
 * 月4+6+8+12が本当に強いのか、parts=0/F歴なし/風/展示ST/odds帯の代理変数なのかを診断する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-monthly-regime.md";
const OUT_JSON = "reports/roi-monthly-regime.json";
const STAKE = 100;

// 強月定義
const STRONG_MONTHS = new Set([4, 6, 8, 12]);

if (!existsSync(DB_PATH)) {
  console.error(`[monthly-regime] DB not found: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

// ───────────────── Types ─────────────────

type Row = {
  raceId: string;
  date: string;
  ym: string;
  month: number;
  venue: string;
  raceNo: number;
  selection: string;
  headCourse: number;
  result: string;
  hit: boolean;
  currentOdds: number;
  // weather
  windMps: number | null;
  waveCm: number | null;
  weatherPresent: boolean;
  // equipment (head)
  partsCount: number | null;
  partsPresent: boolean;
  // exhibition (head)
  headExSt: number | null;
  headExRank: number | null;
  exhibitionPresent: boolean;
  // F count (head)
  headFlyingCount: number | null;
  fPresent: boolean;
  // condition flags
  isParts0: boolean;
  isHeadFZero: boolean;
  isWindGte3: boolean;
  isExStSafe: boolean;
  isStrongMonth: boolean;
  isIsBase: boolean; // passes full isBase condition
};

type MonthStats = {
  month: number;
  label: string;
  n: number;
  hits: number;
  hitRate: number;
  roi: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  maxHitOdds: number;
  avgOdds: number;
  // parts
  parts0Rate: number;
  partsAnyRate: number;
  partsMissingRate: number;
  // F
  headFZeroRate: number;
  headFAnyRate: number;
  headFMissingRate: number;
  // wind
  windGte3Rate: number;
  windLt3Rate: number;
  windMissingRate: number;
  avgWind: number | null;
  // wave
  avgWave: number | null;
  // exSt
  exStSafeRate: number;
  exStRiskyRate: number;
  exStMissingRate: number;
  avgExSt: number | null;
  // odds
  oddsLt30Rate: number;
  odds30to50Rate: number;
  odds50to80Rate: number;
  oddsGte80Rate: number;
  // isBase
  isBaseRate: number;
  isBaseN: number;
  isBaseROI: number;
  isBaseROIExMaxHit: number;
  // regime
  regime: string;
  regimeReasons: string[];
  grade: string;
  explanation: string;
};

type RegimeReport = {
  generatedAt: string;
  dbPath: string;
  totalRows: number;
  monthlyStats: MonthStats[];
  strongMonths: MonthStats[];
  weakMonths: MonthStats[];
  watchMonths: MonthStats[];
  overallMetric: ReturnType<typeof calcMetric>;
  strongMonthMetric: ReturnType<typeof calcMetric>;
  otherMonthMetric: ReturnType<typeof calcMetric>;
  isBaseStrongMetric: ReturnType<typeof calcMetric>;
  isBaseOtherMetric: ReturnType<typeof calcMetric>;
  // 代理変数診断
  proxyDiagnosis: ProxyDiagnosis;
};

type ProxyDiagnosis = {
  // 月固定で条件を変えたとき
  strongMonthParts0: ReturnType<typeof calcMetric>;
  strongMonthPartsAny: ReturnType<typeof calcMetric>;
  strongMonthNoEquip: ReturnType<typeof calcMetric>;
  otherMonthParts0: ReturnType<typeof calcMetric>;
  // 条件固定で月を変えたとき
  parts0StrongMonth: ReturnType<typeof calcMetric>;
  parts0OtherMonth: ReturnType<typeof calcMetric>;
  headFZeroStrongMonth: ReturnType<typeof calcMetric>;
  headFZeroOtherMonth: ReturnType<typeof calcMetric>;
  windGte3StrongMonth: ReturnType<typeof calcMetric>;
  windGte3OtherMonth: ReturnType<typeof calcMetric>;
  // isBase全条件
  isBaseStrongMonth: ReturnType<typeof calcMetric>;
  isBaseOtherMonth: ReturnType<typeof calcMetric>;
  interpretation: string[];
};

// ───────────────── Load ─────────────────

function loadRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
      dh.current_odds, dh.result,
      CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) AS head_course,
      rw.wind_speed_mps, rw.wave_height_cm,
      re.parts_changed_count,
      ed.start_timing AS head_ex_st, ed.ranking AS head_ex_rank,
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
    race_id: string; date: string; venue: string; race_no: number;
    selection: string; current_odds: number; result: string | null;
    head_course: number;
    wind_speed_mps: number | null; wave_height_cm: number | null;
    parts_changed_count: number | null;
    head_ex_st: number | null; head_ex_rank: number | null;
    head_flying_count: number | null;
  }>;

  return raw.map((r) => {
    const hit = r.result != null && r.result === r.selection;
    const month = Number(r.date.slice(5, 7));
    const partsPresent = r.parts_changed_count != null;
    const isParts0 = partsPresent && r.parts_changed_count === 0;
    const isHeadFZero = r.head_flying_count != null && r.head_flying_count === 0;
    const isWindGte3 = r.wind_speed_mps != null && r.wind_speed_mps >= 3;
    // exSt: safe = not in [0.10, 0.15)
    const exSt = r.head_ex_st;
    const isExStSafe = exSt == null || !(exSt >= 0.10 && exSt < 0.15);
    const isStrongMonth = STRONG_MONTHS.has(month);

    // isBase: full paper condition
    const isIsBase =
      isStrongMonth &&
      isParts0 &&
      r.race_no < 10 &&
      r.venue !== "戸田" && r.venue !== "多摩川" &&
      isWindGte3 &&
      (r.head_flying_count == null || r.head_flying_count === 0) &&
      isExStSafe;

    return {
      raceId: r.race_id,
      date: r.date,
      ym: r.date.slice(0, 7),
      month,
      venue: r.venue,
      raceNo: r.race_no,
      selection: r.selection,
      headCourse: r.head_course,
      result: r.result ?? "",
      hit,
      currentOdds: r.current_odds,
      windMps: r.wind_speed_mps,
      waveCm: r.wave_height_cm,
      weatherPresent: r.wind_speed_mps != null,
      partsCount: r.parts_changed_count,
      partsPresent,
      headExSt: exSt,
      headExRank: r.head_ex_rank,
      exhibitionPresent: exSt != null,
      headFlyingCount: r.head_flying_count,
      fPresent: r.head_flying_count != null,
      isParts0,
      isHeadFZero,
      isWindGte3,
      isExStSafe,
      isStrongMonth,
      isIsBase,
    };
  });
}

// ───────────────── Metrics ─────────────────

function calcMetric(rows: Row[]) {
  const n = rows.length;
  if (n === 0) return { n: 0, hits: 0, hitRate: 0, avgOdds: 0, roi: 0, roiExMaxHit: 0, roiExMax3Hits: 0, maxHitOdds: 0 };
  const hits = rows.filter((r) => r.hit).length;
  const hitOdds = rows.filter((r) => r.hit).map((r) => r.currentOdds).sort((a, b) => b - a);
  const total = hitOdds.reduce((s, o) => s + o, 0);
  const ex1 = hitOdds.slice(1).reduce((s, o) => s + o, 0);
  const ex3 = hitOdds.slice(3).reduce((s, o) => s + o, 0);
  const avgOdds = rows.reduce((s, r) => s + r.currentOdds, 0) / n;
  return {
    n,
    hits,
    hitRate: hits / n,
    avgOdds,
    roi: (total / n) * 100,
    roiExMaxHit: (ex1 / n) * 100,
    roiExMax3Hits: (ex3 / n) * 100,
    maxHitOdds: hitOdds[0] ?? 0,
  };
}

function rate(rows: Row[], pred: (r: Row) => boolean): number {
  if (rows.length === 0) return 0;
  return rows.filter(pred).length / rows.length;
}

function avgVal(rows: Row[], fn: (r: Row) => number | null): number | null {
  const vals = rows.map(fn).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function assignRegime(stats: {
  roi: number; roiExMaxHit: number; n: number; hits: number;
  parts0Rate: number; partsMissingRate: number;
  windGte3Rate: number; headFZeroRate: number;
  exStSafeRate: number; oddsGte80Rate: number;
  isStrongMonth: boolean;
}): { regime: string; reasons: string[] } {
  const reasons: string[] = [];
  let regime = "REGIME_WATCH";

  if (stats.n < 20) { reasons.push("n<20: データ不足"); return { regime: "REGIME_INSUFFICIENT", reasons }; }

  // isBase通過率が高くROI安定
  if (stats.isStrongMonth && stats.roi >= 150 && stats.roiExMaxHit >= 120 && stats.n >= 50) {
    regime = "REGIME_PAPER_STRONG";
    reasons.push("強月×ROI>=150%×roiExMaxHit>=120%");
  } else if (stats.roi >= 120 && stats.roiExMaxHit >= 100 && stats.parts0Rate >= 0.5) {
    regime = "REGIME_STABLE";
    reasons.push("ROI>=120%×parts0率>=50%");
  } else if (stats.roi > 100 && stats.roiExMaxHit < 80) {
    regime = "REGIME_VOLATILE";
    reasons.push("ROI>100%だがroiExMaxHit<80%: 高配当一発依存");
  } else if (stats.partsMissingRate > 0.3) {
    regime = "REGIME_PARTS_UNKNOWN";
    reasons.push(`parts欠損率${pct(stats.partsMissingRate)}: parts=0条件の信頼性低`);
  } else if (stats.windGte3Rate < 0.3) {
    regime = "REGIME_WEATHER_RISK";
    reasons.push(`windGte3率${pct(stats.windGte3Rate)}: 風条件が弱い`);
  } else if (stats.headFZeroRate < 0.5 && stats.headFZeroRate > 0) {
    regime = "REGIME_ORDER_UNCERTAIN";
    reasons.push(`headFZero率${pct(stats.headFZeroRate)}: F歴あり艇が多い`);
  } else if (stats.oddsGte80Rate > 0.3) {
    regime = "REGIME_MARKET_MISPRICE";
    reasons.push(`odds>=80率${pct(stats.oddsGte80Rate)}: 高配当依存リスク`);
  } else if (stats.roi < 80) {
    regime = "REGIME_WEAK_MONTH";
    reasons.push(`ROI${pct(stats.roi / 100)}: 弱い`);
  } else {
    reasons.push("様子見");
  }

  return { regime, reasons };
}

function gradeMonth(roi: number, roiExMaxHit: number, n: number): string {
  if (n < 20) return "C";
  if (roi >= 200 && roiExMaxHit >= 150) return "S";
  if (roi >= 150 && roiExMaxHit >= 120) return "A";
  if (roi >= 100 && roiExMaxHit >= 80) return "B";
  if (roi >= 70) return "C";
  return "D";
}

// ───────────────── Analysis ─────────────────

function analyzeMonthlyRegime(rows: Row[]): RegimeReport {
  const byMonth = new Map<number, Row[]>();
  for (let m = 1; m <= 12; m++) byMonth.set(m, []);
  for (const r of rows) {
    byMonth.get(r.month)!.push(r);
  }

  const monthlyStats: MonthStats[] = [];

  for (let m = 1; m <= 12; m++) {
    const rs = byMonth.get(m)!;
    if (rs.length === 0) continue;

    const met = calcMetric(rs);
    const isBaseRs = rs.filter((r) => r.isIsBase);
    const isBaseMet = calcMetric(isBaseRs);

    const parts0Rs = rs.filter((r) => r.partsPresent && r.isParts0);
    const partsAnyRs = rs.filter((r) => r.partsPresent && !r.isParts0);
    const partsMissingRs = rs.filter((r) => !r.partsPresent);

    const headFZeroRs = rs.filter((r) => r.fPresent && r.isHeadFZero);
    const headFAnyRs = rs.filter((r) => r.fPresent && !r.isHeadFZero);
    const headFMissingRs = rs.filter((r) => !r.fPresent);

    const windGte3Rs = rs.filter((r) => r.weatherPresent && r.isWindGte3);
    const windLt3Rs = rs.filter((r) => r.weatherPresent && !r.isWindGte3);
    const windMissingRs = rs.filter((r) => !r.weatherPresent);

    const exStPresent = rs.filter((r) => r.exhibitionPresent);
    const exStSafeRs = exStPresent.filter((r) => r.isExStSafe);
    const exStRiskyRs = exStPresent.filter((r) => !r.isExStSafe);

    const { regime, reasons } = assignRegime({
      roi: met.roi,
      roiExMaxHit: met.roiExMaxHit,
      n: met.n,
      hits: met.hits,
      parts0Rate: rs.length > 0 ? parts0Rs.length / rs.length : 0,
      partsMissingRate: rs.length > 0 ? partsMissingRs.length / rs.length : 0,
      windGte3Rate: rs.length > 0 ? windGte3Rs.length / rs.length : 0,
      headFZeroRate: rs.length > 0 ? headFZeroRs.length / rs.length : 0,
      exStSafeRate: rs.length > 0 ? exStSafeRs.length / rs.length : 0,
      oddsGte80Rate: rate(rs, (r) => r.currentOdds >= 80),
      isStrongMonth: STRONG_MONTHS.has(m),
    });

    const grade = gradeMonth(met.roi, met.roiExMaxHit, met.n);

    const explanation =
      regime === "REGIME_PAPER_STRONG"
        ? "強月×高ROI×roiExMaxHit安定: 最上位観察候補"
        : regime === "REGIME_STABLE"
          ? "ROI安定かつparts=0率高: 条件が揃いやすい月"
          : regime === "REGIME_VOLATILE"
            ? "高配当一発依存: 除外すると期待値が崩れる"
            : regime === "REGIME_WEAK_MONTH"
              ? "ROI低: NO_BUY候補。月だけで除外するより条件フィルター検討"
              : regime === "REGIME_PARTS_UNKNOWN"
                ? "parts欠損率高: parts=0条件が不安定。PAPER_ONLYで様子見"
                : regime === "REGIME_WEATHER_RISK"
                  ? "風条件が弱い月: wind>=3要件を満たしにくい"
                  : regime === "REGIME_ORDER_UNCERTAIN"
                    ? "F歴あり艇が多い: 1艇固定ロジックが不安定化しやすい"
                    : regime === "REGIME_MARKET_MISPRICE"
                      ? "高オッズ帯依存: market misprice vs noise判別が必要"
                      : "観察継続";

    monthlyStats.push({
      month: m,
      label: `月${m}`,
      n: met.n,
      hits: met.hits,
      hitRate: met.hitRate,
      roi: met.roi,
      roiExMaxHit: met.roiExMaxHit,
      roiExMax3Hits: met.roiExMax3Hits,
      maxHitOdds: met.maxHitOdds,
      avgOdds: met.avgOdds,
      parts0Rate: rs.length > 0 ? parts0Rs.length / rs.length : 0,
      partsAnyRate: rs.length > 0 ? partsAnyRs.length / rs.length : 0,
      partsMissingRate: rs.length > 0 ? partsMissingRs.length / rs.length : 0,
      headFZeroRate: rs.length > 0 ? headFZeroRs.length / rs.length : 0,
      headFAnyRate: rs.length > 0 ? headFAnyRs.length / rs.length : 0,
      headFMissingRate: rs.length > 0 ? headFMissingRs.length / rs.length : 0,
      windGte3Rate: rs.length > 0 ? windGte3Rs.length / rs.length : 0,
      windLt3Rate: rs.length > 0 ? windLt3Rs.length / rs.length : 0,
      windMissingRate: rs.length > 0 ? windMissingRs.length / rs.length : 0,
      avgWind: avgVal(rs, (r) => r.windMps),
      avgWave: avgVal(rs, (r) => r.waveCm),
      exStSafeRate: exStPresent.length > 0 ? exStSafeRs.length / exStPresent.length : 0,
      exStRiskyRate: exStPresent.length > 0 ? exStRiskyRs.length / exStPresent.length : 0,
      exStMissingRate: rs.length > 0 ? (rs.length - exStPresent.length) / rs.length : 0,
      avgExSt: avgVal(rs, (r) => r.headExSt),
      oddsLt30Rate: rate(rs, (r) => r.currentOdds < 30),
      odds30to50Rate: rate(rs, (r) => r.currentOdds >= 30 && r.currentOdds < 50),
      odds50to80Rate: rate(rs, (r) => r.currentOdds >= 50 && r.currentOdds < 80),
      oddsGte80Rate: rate(rs, (r) => r.currentOdds >= 80),
      isBaseRate: rs.length > 0 ? isBaseRs.length / rs.length : 0,
      isBaseN: isBaseMet.n,
      isBaseROI: isBaseMet.roi,
      isBaseROIExMaxHit: isBaseMet.roiExMaxHit,
      regime,
      regimeReasons: reasons,
      grade,
      explanation,
    });
  }

  // 強月/弱月/観察月分類
  const strongMonths = monthlyStats.filter((s) => STRONG_MONTHS.has(s.month));
  const weakMonths = monthlyStats.filter((s) => s.roi < 80 && s.n >= 20);
  const watchMonths = monthlyStats.filter((s) => s.roi >= 80 && s.roi < 120 && s.n >= 20);

  // 全体メトリクス
  const strongRows = rows.filter((r) => r.isStrongMonth);
  const otherRows = rows.filter((r) => !r.isStrongMonth);
  const isBaseStrongRows = rows.filter((r) => r.isIsBase);
  const isBaseOtherRows = rows.filter((r) => !r.isStrongMonth && r.isParts0 && r.isHeadFZero && r.isWindGte3 && r.isExStSafe);

  // 代理変数診断
  const proxy = buildProxyDiagnosis(rows, strongRows, otherRows);

  return {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    totalRows: rows.length,
    monthlyStats,
    strongMonths,
    weakMonths,
    watchMonths,
    overallMetric: calcMetric(rows),
    strongMonthMetric: calcMetric(strongRows),
    otherMonthMetric: calcMetric(otherRows),
    isBaseStrongMetric: calcMetric(isBaseStrongRows),
    isBaseOtherMetric: calcMetric(isBaseOtherRows),
    proxyDiagnosis: proxy,
  };
}

function buildProxyDiagnosis(
  allRows: Row[],
  strongRows: Row[],
  otherRows: Row[],
): ProxyDiagnosis {
  const strongParts0 = strongRows.filter((r) => r.isParts0);
  const strongPartsAny = strongRows.filter((r) => r.partsPresent && !r.isParts0);
  const strongNoEquip = strongRows.filter((r) => !r.partsPresent);
  const otherParts0 = otherRows.filter((r) => r.isParts0);
  const parts0All = allRows.filter((r) => r.isParts0);
  const parts0Strong = parts0All.filter((r) => r.isStrongMonth);
  const parts0Other = parts0All.filter((r) => !r.isStrongMonth);
  const headFZeroAll = allRows.filter((r) => r.isHeadFZero);
  const headFZeroStrong = headFZeroAll.filter((r) => r.isStrongMonth);
  const headFZeroOther = headFZeroAll.filter((r) => !r.isStrongMonth);
  const windGte3All = allRows.filter((r) => r.isWindGte3);
  const windGte3Strong = windGte3All.filter((r) => r.isStrongMonth);
  const windGte3Other = windGte3All.filter((r) => !r.isStrongMonth);
  const isBaseStrong = allRows.filter((r) => r.isIsBase);
  const isBaseOther = allRows.filter((r) => !r.isStrongMonth && r.isParts0 && r.isHeadFZero && r.isWindGte3 && r.isExStSafe);

  const smP0 = calcMetric(strongParts0);
  const smPA = calcMetric(strongPartsAny);
  const omP0 = calcMetric(otherParts0);

  // 解釈文を生成
  const interpretation: string[] = [];
  if (smP0.roi > smPA.roi + 20) {
    interpretation.push(`強月内: parts=0(ROI${pct(smP0.roi / 100)}) vs partsあり(ROI${pct(smPA.roi / 100)}) — parts=0が月内でも有意差あり`);
  } else if (smP0.roi <= smPA.roi + 10) {
    interpretation.push(`強月内: parts=0 vs partsあり ROI差が小さい — 月が主因の可能性`);
  }
  if (parts0Strong.length > 0 && parts0Other.length > 0) {
    const p0S = calcMetric(parts0Strong);
    const p0O = calcMetric(parts0Other);
    if (p0S.roi > p0O.roi + 30) {
      interpretation.push(`parts=0内: 強月(ROI${pct(p0S.roi / 100)}) vs 弱月(ROI${pct(p0O.roi / 100)}) — 月が有意差を出している`);
    } else {
      interpretation.push(`parts=0内: 強月 vs 弱月 ROI差が小 — parts=0が主因の可能性`);
    }
  }
  if (isBaseStrong.length > 0 && isBaseOther.length > 0) {
    const ibS = calcMetric(isBaseStrong);
    const ibO = calcMetric(isBaseOther);
    interpretation.push(`isBase条件内: 強月ROI${pct(ibS.roi / 100)} (n=${ibS.n}) vs 同条件×弱月ROI${pct(ibO.roi / 100)} (n=${ibO.n})`);
    if (ibS.roi > ibO.roi + 30) {
      interpretation.push("→ 月が条件を揃えた後でも追加効果を持つ可能性");
    } else {
      interpretation.push("→ 月の効果は主にparts=0/F/風の代理かもしれない");
    }
  }

  return {
    strongMonthParts0: smP0,
    strongMonthPartsAny: smPA,
    strongMonthNoEquip: calcMetric(strongNoEquip),
    otherMonthParts0: omP0,
    parts0StrongMonth: calcMetric(parts0Strong),
    parts0OtherMonth: calcMetric(parts0Other),
    headFZeroStrongMonth: calcMetric(headFZeroStrong),
    headFZeroOtherMonth: calcMetric(headFZeroOther),
    windGte3StrongMonth: calcMetric(windGte3Strong),
    windGte3OtherMonth: calcMetric(windGte3Other),
    isBaseStrongMonth: calcMetric(isBaseStrong),
    isBaseOtherMonth: calcMetric(isBaseOther),
    interpretation,
  };
}

// ───────────────── Render ─────────────────

function renderMd(r: RegimeReport): string {
  const lines: string[] = [];
  lines.push("# ROI Monthly Regime Analysis", "");
  lines.push(`生成: ${r.generatedAt} / DB: ${r.dbPath}`, "");
  lines.push(`対象: historical-backfill BUY n=${r.totalRows}`, "");
  lines.push("");

  // 全体比較
  lines.push("## 1. 強月 vs その他月 — 全体比較", "");
  lines.push("| 区分 | n | hits | hitRate | ROI | roiExMaxHit | roiExMax3Hits | maxHitOdds | avgOdds |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const rows_ = [
    ["全体", r.overallMetric],
    ["強月(4/6/8/12)", r.strongMonthMetric],
    ["その他月", r.otherMonthMetric],
    ["isBase条件×強月", r.isBaseStrongMetric],
    ["isBase条件×弱月", r.isBaseOtherMetric],
  ] as [string, ReturnType<typeof calcMetric>][];
  for (const [label, m] of rows_) {
    lines.push(`| ${label} | ${m.n} | ${m.hits} | ${pct(m.hitRate)} | ${pct(m.roi / 100)} | ${pct(m.roiExMaxHit / 100)} | ${pct(m.roiExMax3Hits / 100)} | ${num(m.maxHitOdds)} | ${num(m.avgOdds)} |`);
  }
  lines.push("");

  // 月別詳細
  lines.push("## 2. 月別詳細", "");
  lines.push("| 月 | n | hits | hitRate | ROI | roiExMaxHit | roiExMax3Hits | maxHitOdds | avgOdds | grade | regime |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---|");
  for (const s of r.monthlyStats) {
    const flag = STRONG_MONTHS.has(s.month) ? "⭐" : "";
    lines.push(`| ${flag}${s.label} | ${s.n} | ${s.hits} | ${pct(s.hitRate)} | ${pct(s.roi / 100)} | ${pct(s.roiExMaxHit / 100)} | ${pct(s.roiExMax3Hits / 100)} | ${num(s.maxHitOdds)} | ${num(s.avgOdds)} | ${s.grade} | ${s.regime} |`);
  }
  lines.push("");

  // 月別条件詳細
  lines.push("## 3. 月別 parts=0 / headF / wind / exSt 詳細", "");
  lines.push("| 月 | parts0% | partsAny% | partsMiss% | headFZero% | headFAny% | headFMiss% | windGte3% | exStSafe% | odds>=80% | isBase% | isBase n | isBase ROI |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of r.monthlyStats) {
    const flag = STRONG_MONTHS.has(s.month) ? "⭐" : "";
    lines.push(`| ${flag}${s.label} | ${pct(s.parts0Rate)} | ${pct(s.partsAnyRate)} | ${pct(s.partsMissingRate)} | ${pct(s.headFZeroRate)} | ${pct(s.headFAnyRate)} | ${pct(s.headFMissingRate)} | ${pct(s.windGte3Rate)} | ${pct(s.exStSafeRate)} | ${pct(s.oddsGte80Rate)} | ${pct(s.isBaseRate)} | ${s.isBaseN} | ${pct(s.isBaseROI / 100)} |`);
  }
  lines.push("");

  // 月別レジーム詳細
  lines.push("## 4. 月別レジーム・格付け・解説", "");
  for (const s of r.monthlyStats) {
    const flag = STRONG_MONTHS.has(s.month) ? "⭐" : "";
    lines.push(`### ${flag}月${s.month} — ${s.grade} / ${s.regime}`, "");
    lines.push(`**解説**: ${s.explanation}`, "");
    lines.push(`**レジーム理由**: ${s.regimeReasons.join(" / ")}`, "");
    lines.push(`n=${s.n} / ROI=${pct(s.roi / 100)} / roiExMaxHit=${pct(s.roiExMaxHit / 100)} / isBase n=${s.isBaseN} / isBase ROI=${pct(s.isBaseROI / 100)}`, "");
    lines.push("");
  }

  // 分類サマリー
  lines.push("## 5. 強月/弱月/観察月 分類", "");
  lines.push(`**強月候補** (ROI>=150% or isBase ROI高): ${r.strongMonths.map((s) => s.label).join(", ")}`, "");
  lines.push(`**弱月候補** (ROI<80% n>=20): ${r.weakMonths.map((s) => s.label).join(", ") || "なし"}`, "");
  lines.push(`**観察月** (ROI 80-120%): ${r.watchMonths.map((s) => s.label).join(", ") || "なし"}`, "");
  lines.push("");

  // 代理変数診断
  lines.push("## 6. 代理変数診断 — 月 vs parts=0/F/風", "");
  lines.push("月が独立して効いているのか、それとも parts=0/F歴なし/風 の代理変数なのかを検証する。", "");
  lines.push("### 6a. 強月内でのparts=0 vs partsあり", "");
  lines.push("| 区分 | n | hits | ROI | roiExMaxHit |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [label, m] of [
    ["強月×parts=0", r.proxyDiagnosis.strongMonthParts0],
    ["強月×partsあり", r.proxyDiagnosis.strongMonthPartsAny],
    ["強月×parts欠損", r.proxyDiagnosis.strongMonthNoEquip],
    ["弱月×parts=0", r.proxyDiagnosis.otherMonthParts0],
  ] as [string, ReturnType<typeof calcMetric>][]) {
    lines.push(`| ${label} | ${m.n} | ${m.hits} | ${pct(m.roi / 100)} | ${pct(m.roiExMaxHit / 100)} |`);
  }
  lines.push("");
  lines.push("### 6b. parts=0内での強月 vs 弱月", "");
  lines.push("| 区分 | n | hits | ROI | roiExMaxHit |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [label, m] of [
    ["parts=0×強月", r.proxyDiagnosis.parts0StrongMonth],
    ["parts=0×弱月", r.proxyDiagnosis.parts0OtherMonth],
    ["headFZero×強月", r.proxyDiagnosis.headFZeroStrongMonth],
    ["headFZero×弱月", r.proxyDiagnosis.headFZeroOtherMonth],
    ["wind>=3×強月", r.proxyDiagnosis.windGte3StrongMonth],
    ["wind>=3×弱月", r.proxyDiagnosis.windGte3OtherMonth],
    ["isBase×強月", r.proxyDiagnosis.isBaseStrongMonth],
    ["isBase×弱月同条件", r.proxyDiagnosis.isBaseOtherMonth],
  ] as [string, ReturnType<typeof calcMetric>][]) {
    lines.push(`| ${label} | ${m.n} | ${m.hits} | ${pct(m.roi / 100)} | ${pct(m.roiExMaxHit / 100)} |`);
  }
  lines.push("");
  lines.push("### 6c. 解釈", "");
  for (const s of r.proxyDiagnosis.interpretation) {
    lines.push(`- ${s}`);
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

console.log("[monthly-regime] loading rows...");
const rows = loadRows();
console.log(`[monthly-regime] loaded ${rows.length} rows`);

const report = analyzeMonthlyRegime(rows);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, renderMd(report), "utf8");

// JSON: strip Map types for serialization
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(`[monthly-regime] done → ${OUT_MD} / ${OUT_JSON}`);
console.log(`  強月: ${report.strongMonths.map((s) => `月${s.month}(ROI=${num(s.roi)}%)`).join(", ")}`);
console.log(`  弱月: ${report.weakMonths.map((s) => `月${s.month}(ROI=${num(s.roi)}%)`).join(", ") || "なし"}`);
