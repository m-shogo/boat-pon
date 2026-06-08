/**
 * ROI Weak Patterns Analysis — 読み取り専用
 *
 * 禁止:
 * - DB INSERT / UPDATE / DELETE / DROP
 * - app_settings 変更
 * - 本番decisionロジック変更
 *
 * 目的:
 * 避けるべき条件・弱条件を抽出し、NO_BUY候補・PAPER_ONLY候補を特定する。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-weak-patterns.md";
const OUT_JSON = "reports/roi-weak-patterns.json";
const STAKE = 100;

const STRONG_MONTHS = new Set([4, 6, 8, 12]);

if (!existsSync(DB_PATH)) {
  console.error(`[weak-patterns] DB not found: ${DB_PATH}`);
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
  headCourse: number;
  result: string;
  hit: boolean;
  currentOdds: number;
  windMps: number | null;
  waveCm: number | null;
  weatherPresent: boolean;
  partsCount: number | null;
  partsPresent: boolean;
  headExSt: number | null;
  exhibitionPresent: boolean;
  headFlyingCount: number | null;
  fPresent: boolean;
  // derived
  isParts0: boolean;
  isPartsAny: boolean;
  isPartsMissing: boolean;
  isHeadFZero: boolean;
  isHeadFAny: boolean;
  isWindGte3: boolean;
  isExStSafe: boolean;
  isExStRisky: boolean;
  isStrongMonth: boolean;
  isIsBase: boolean;
  isOddsGte80: boolean;
  isOdds50to80: boolean;
  isOdds30to50: boolean;
  isOddsLt30: boolean;
};

type PatternResult = {
  label: string;
  condition: string;
  n: number;
  hits: number;
  hitRate: number;
  roi: number;
  roiExMaxHit: number;
  roiExMax3Hits: number;
  maxHitOdds: number;
  avgOdds: number;
  classification: "NO_BUY_CANDIDATE" | "PAPER_ONLY" | "WATCH" | "DO_NOT_TOUCH" | "OK";
  explanation: string;
  warning: string;
};

type WeakPatternReport = {
  generatedAt: string;
  dbPath: string;
  totalRows: number;
  baseline: ReturnType<typeof calcMetric>;
  patterns: PatternResult[];
  noBuyCandidates: PatternResult[];
  paperOnlyCandidates: PatternResult[];
  doNotTouch: PatternResult[];
  watchList: PatternResult[];
  summaryText: string[];
};

// ───────────────── Load ─────────────────

function loadRows(): Row[] {
  const raw = db.prepare(`
    SELECT
      dh.id, dh.race_id, dh.date, dh.venue, dh.race_no, dh.selection,
      dh.current_odds, dh.result,
      CAST(substr(dh.selection,1,instr(dh.selection,'-')-1) AS INT) AS head_course,
      rw.wind_speed_mps, rw.wave_height_cm,
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
    selection: string; current_odds: number; result: string | null; head_course: number;
    wind_speed_mps: number | null; wave_height_cm: number | null;
    parts_changed_count: number | null; head_ex_st: number | null;
    head_flying_count: number | null;
  }>;

  return raw.map((r) => {
    const hit = r.result != null && r.result === r.selection;
    const month = Number(r.date.slice(5, 7));
    const partsPresent = r.parts_changed_count != null;
    const isParts0 = partsPresent && r.parts_changed_count === 0;
    const isHeadFZero = r.head_flying_count != null && r.head_flying_count === 0;
    const isWindGte3 = r.wind_speed_mps != null && r.wind_speed_mps >= 3;
    const exSt = r.head_ex_st;
    const isExStSafe = exSt == null || !(exSt >= 0.10 && exSt < 0.15);
    const isExStRisky = exSt != null && exSt >= 0.10 && exSt < 0.15;
    const isStrongMonth = STRONG_MONTHS.has(month);
    const isIsBase =
      isStrongMonth && isParts0 &&
      r.race_no < 10 && r.venue !== "戸田" && r.venue !== "多摩川" &&
      isWindGte3 && (r.head_flying_count == null || r.head_flying_count === 0) && isExStSafe;

    return {
      id: r.id, raceId: r.race_id, date: r.date, ym: r.date.slice(0, 7),
      month, venue: r.venue, raceNo: r.race_no, selection: r.selection,
      headCourse: r.head_course, result: r.result ?? "", hit,
      currentOdds: r.current_odds,
      windMps: r.wind_speed_mps, waveCm: r.wave_height_cm,
      weatherPresent: r.wind_speed_mps != null,
      partsCount: r.parts_changed_count, partsPresent,
      headExSt: exSt, exhibitionPresent: exSt != null,
      headFlyingCount: r.head_flying_count, fPresent: r.head_flying_count != null,
      isParts0, isPartsAny: partsPresent && !isParts0,
      isPartsMissing: !partsPresent,
      isHeadFZero, isHeadFAny: r.head_flying_count != null && r.head_flying_count > 0,
      isWindGte3, isExStSafe, isExStRisky, isStrongMonth, isIsBase,
      isOddsGte80: r.current_odds >= 80,
      isOdds50to80: r.current_odds >= 50 && r.current_odds < 80,
      isOdds30to50: r.current_odds >= 30 && r.current_odds < 50,
      isOddsLt30: r.current_odds < 30,
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
    n, hits, hitRate: hits / n, avgOdds,
    roi: (total / n) * 100,
    roiExMaxHit: (ex1 / n) * 100,
    roiExMax3Hits: (ex3 / n) * 100,
    maxHitOdds: hitOdds[0] ?? 0,
  };
}

function classify(roi: number, roiExMaxHit: number, n: number, baselineRoi: number): PatternResult["classification"] {
  if (n < 10) return "WATCH";
  // ROI<50% and clearly below baseline
  if (roi < 50 && baselineRoi - roi > 50) return "DO_NOT_TOUCH";
  if (roi < 70) return "NO_BUY_CANDIDATE";
  if (roi < 90 || roiExMaxHit < 70) return "PAPER_ONLY";
  if (roi < 110) return "WATCH";
  return "OK";
}

function buildPattern(
  label: string,
  condition: string,
  rows: Row[],
  baselineRoi: number,
  explanation: string,
): PatternResult {
  const m = calcMetric(rows);
  const cl = classify(m.roi, m.roiExMaxHit, m.n, baselineRoi);
  const warning =
    cl === "DO_NOT_TOUCH" ? `⛔ ROI${pct(m.roi / 100)} — 基準比${num(baselineRoi - m.roi)}pp低下` :
    cl === "NO_BUY_CANDIDATE" ? `❌ ROI${pct(m.roi / 100)} — NO_BUY推奨` :
    cl === "PAPER_ONLY" ? `⚠️ ROI${pct(m.roi / 100)} — PAPER_ONLYで様子見` :
    cl === "WATCH" ? `△ ROI${pct(m.roi / 100)} — 観察中` : `✓ ROI${pct(m.roi / 100)}`;
  return {
    label, condition,
    n: m.n, hits: m.hits, hitRate: m.hitRate, roi: m.roi,
    roiExMaxHit: m.roiExMaxHit, roiExMax3Hits: m.roiExMax3Hits,
    maxHitOdds: m.maxHitOdds, avgOdds: m.avgOdds,
    classification: cl, explanation, warning,
  };
}

// ───────────────── Analysis ─────────────────

function analyzeWeakPatterns(rows: Row[]): WeakPatternReport {
  const baseline = calcMetric(rows);
  const br = baseline.roi;

  const patterns: PatternResult[] = [];

  // ── 月別弱条件 ──
  for (let m = 1; m <= 12; m++) {
    const rs = rows.filter((r) => r.month === m);
    if (rs.length < 10) continue;
    const met = calcMetric(rs);
    if (met.roi >= 110 && !STRONG_MONTHS.has(m)) continue; // skip OK months
    const cl = classify(met.roi, met.roiExMaxHit, met.n, br);
    if (cl === "OK") continue;
    patterns.push({
      label: `月${m}`, condition: `month=${m}`,
      n: met.n, hits: met.hits, hitRate: met.hitRate, roi: met.roi,
      roiExMaxHit: met.roiExMaxHit, roiExMax3Hits: met.roiExMax3Hits,
      maxHitOdds: met.maxHitOdds, avgOdds: met.avgOdds,
      classification: cl,
      explanation: `月${m}のBUY全体ROI。弱月は条件フィルターとの掛け合わせで改善できる場合があるが、単独では弱い。`,
      warning: cl === "NO_BUY_CANDIDATE" ? `❌ ROI低: NO_BUY_CANDIDATE` : cl === "DO_NOT_TOUCH" ? `⛔ DO_NOT_TOUCH` : `⚠️ ${cl}`,
    });
  }

  // ── parts条件 ──
  patterns.push(buildPattern(
    "partsあり (parts>=1)", "parts_changed_count>=1",
    rows.filter((r) => r.isPartsAny), br,
    "部品交換あり。機力評価にノイズが入り予測安定性が下がる可能性。特に強月でも除外検討。",
  ));
  patterns.push(buildPattern(
    "parts欠損 (equipmentなし)", "parts_changed_count IS NULL",
    rows.filter((r) => r.isPartsMissing), br,
    "parts情報が取得できていない。isBase条件の信頼性低下。欠損率が高い月は条件全体の有効性に注意。",
  ));

  // ── F歴条件 ──
  patterns.push(buildPattern(
    "headFあり (flyingCount>=1)", "head_flying_count>=1",
    rows.filter((r) => r.isHeadFAny), br,
    "頭艇にF歴あり。スタートリスクが上がり、1艇固定ロジックの前提が崩れやすい。",
  ));

  // ── 展示ST条件 ──
  patterns.push(buildPattern(
    "exSt危険帯 (0.10-0.15)", "head_ex_st BETWEEN 0.10 AND 0.149",
    rows.filter((r) => r.isExStRisky), br,
    "展示ST 0.10-0.15の帯域。スタート踏み込みが曖昧で再現性が低い。isBase条件では除外対象。",
  ));

  // ── 風条件 ──
  patterns.push(buildPattern(
    "wind<3 (弱風)", "wind_speed_mps<3 (OR NULL)",
    rows.filter((r) => r.weatherPresent && !r.isWindGte3), br,
    "風速3m/s未満。強風による市場歪みが発生しにくく、odds帯の優位性が出にくい可能性。",
  ));

  // ── 高オッズ条件 ──
  patterns.push(buildPattern(
    "odds>=80 (一発依存)", "current_odds>=80",
    rows.filter((r) => r.isOddsGte80), br,
    "高配当一発依存。roiExMaxHitで崩れる場合、実運用では資金リスクが高い。基本はDO_NOT_TOUCH推奨。",
  ));

  // ── レースNo別 ──
  for (const raceNoGroup of [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]) {
    const rs = rows.filter((r) => raceNoGroup.includes(r.raceNo));
    const label = `レースNo${raceNoGroup[0]}-${raceNoGroup[raceNoGroup.length - 1]}`;
    const met = calcMetric(rs);
    const cl = classify(met.roi, met.roiExMaxHit, met.n, br);
    if (cl === "OK") continue;
    patterns.push({
      label, condition: `race_no IN (${raceNoGroup.join(",")})`,
      n: met.n, hits: met.hits, hitRate: met.hitRate, roi: met.roi,
      roiExMaxHit: met.roiExMaxHit, roiExMax3Hits: met.roiExMax3Hits,
      maxHitOdds: met.maxHitOdds, avgOdds: met.avgOdds,
      classification: cl,
      explanation: `レースNo${raceNoGroup[0]}-${raceNoGroup[raceNoGroup.length - 1]}のROI。後半レースは番組差が出やすい。`,
      warning: `${cl}: ROI=${pct(met.roi / 100)}`,
    });
  }

  // ── 会場別弱条件 ──
  const byVenue = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byVenue.has(r.venue)) byVenue.set(r.venue, []);
    byVenue.get(r.venue)!.push(r);
  }
  const weakVenues: PatternResult[] = [];
  for (const [venue, rs] of byVenue) {
    if (rs.length < 15) continue;
    const met = calcMetric(rs);
    const cl = classify(met.roi, met.roiExMaxHit, met.n, br);
    if (cl === "OK" || cl === "WATCH") continue;
    weakVenues.push({
      label: `会場: ${venue}`, condition: `venue='${venue}'`,
      n: met.n, hits: met.hits, hitRate: met.hitRate, roi: met.roi,
      roiExMaxHit: met.roiExMaxHit, roiExMax3Hits: met.roiExMax3Hits,
      maxHitOdds: met.maxHitOdds, avgOdds: met.avgOdds,
      classification: cl,
      explanation: `会場${venue}のROI。会場固有の特性（水面・風向き等）が影響する可能性。`,
      warning: `${cl}: ROI=${pct(met.roi / 100)}`,
    });
  }
  weakVenues.sort((a, b) => a.roi - b.roi);
  patterns.push(...weakVenues.slice(0, 8));

  // ── 複合弱条件 ──
  patterns.push(buildPattern(
    "partsあり×強月", "strong_month AND parts>=1",
    rows.filter((r) => r.isStrongMonth && r.isPartsAny), br,
    "強月内でも部品交換ありは除外対象。parts=0との差を確認することで月効果 vs parts効果を分離できる。",
  ));
  patterns.push(buildPattern(
    "headFあり×強月", "strong_month AND head_flying>=1",
    rows.filter((r) => r.isStrongMonth && r.isHeadFAny), br,
    "強月内でもF歴あり頭艇はリスク。isBase条件では除外済みだが、単独ではどの程度影響するか確認。",
  ));
  patterns.push(buildPattern(
    "odds>=80×isBase条件", "isBase AND odds>=80",
    rows.filter((r) => r.isIsBase && r.isOddsGte80), br,
    "isBase条件通過でも高配当帯は一発依存リスクが残る。",
  ));

  // 分類別グループ
  const noBuyCandidates = patterns.filter((p) => p.classification === "NO_BUY_CANDIDATE");
  const paperOnly = patterns.filter((p) => p.classification === "PAPER_ONLY");
  const doNotTouch = patterns.filter((p) => p.classification === "DO_NOT_TOUCH");
  const watchList = patterns.filter((p) => p.classification === "WATCH");

  // サマリー文
  const summaryText: string[] = [
    `全体baseline ROI: ${pct(br / 100)} (n=${baseline.n})`,
    `NO_BUY_CANDIDATE: ${noBuyCandidates.length}件`,
    `PAPER_ONLY: ${paperOnly.length}件`,
    `DO_NOT_TOUCH: ${doNotTouch.length}件`,
    `WATCH: ${watchList.length}件`,
    "",
    "主要な弱条件:",
    ...doNotTouch.map((p) => `  ⛔ ${p.label}: ROI=${pct(p.roi / 100)}`),
    ...noBuyCandidates.map((p) => `  ❌ ${p.label}: ROI=${pct(p.roi / 100)}`),
  ];

  return {
    generatedAt: new Date().toISOString(),
    dbPath: DB_PATH,
    totalRows: rows.length,
    baseline,
    patterns,
    noBuyCandidates,
    paperOnlyCandidates: paperOnly,
    doNotTouch,
    watchList,
    summaryText,
  };
}

// ───────────────── Render ─────────────────

function renderMd(r: WeakPatternReport): string {
  const lines: string[] = [];
  lines.push("# ROI Weak Patterns Analysis", "");
  lines.push(`生成: ${r.generatedAt} / DB: ${r.dbPath}`, "");
  lines.push(`対象: historical-backfill BUY n=${r.totalRows}`, "");
  lines.push(`baseline ROI: ${pct(r.baseline.roi / 100)} (n=${r.baseline.n} / hits=${r.baseline.hits})`, "");
  lines.push("");

  // サマリー
  lines.push("## サマリー", "");
  for (const s of r.summaryText) lines.push(s);
  lines.push("");

  // DO_NOT_TOUCH
  if (r.doNotTouch.length > 0) {
    lines.push("## ⛔ DO_NOT_TOUCH", "");
    renderPatternTable(lines, r.doNotTouch);
    lines.push("");
  }

  // NO_BUY_CANDIDATE
  if (r.noBuyCandidates.length > 0) {
    lines.push("## ❌ NO_BUY_CANDIDATE", "");
    renderPatternTable(lines, r.noBuyCandidates);
    lines.push("");
  }

  // PAPER_ONLY
  if (r.paperOnlyCandidates.length > 0) {
    lines.push("## ⚠️ PAPER_ONLY", "");
    renderPatternTable(lines, r.paperOnlyCandidates);
    lines.push("");
  }

  // WATCH
  if (r.watchList.length > 0) {
    lines.push("## △ WATCH", "");
    renderPatternTable(lines, r.watchList);
    lines.push("");
  }

  // 全パターン詳細
  lines.push("## 全パターン詳細", "");
  lines.push("| 分類 | 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | avgOdds |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const p of r.patterns) {
    const icon = p.classification === "DO_NOT_TOUCH" ? "⛔" : p.classification === "NO_BUY_CANDIDATE" ? "❌" : p.classification === "PAPER_ONLY" ? "⚠️" : p.classification === "WATCH" ? "△" : "✓";
    lines.push(`| ${icon} ${p.classification} | ${esc(p.label)} | ${p.n} | ${p.hits} | ${pct(p.hitRate)} | ${pct(p.roi / 100)} | ${pct(p.roiExMaxHit / 100)} | ${num(p.maxHitOdds)} | ${num(p.avgOdds)} |`);
  }
  lines.push("");

  // 解説
  lines.push("## 各条件の解説", "");
  for (const p of r.patterns) {
    lines.push(`### ${p.label} — ${p.classification}`, "");
    lines.push(`**条件**: \`${p.condition}\``, "");
    lines.push(`**解説**: ${p.explanation}`, "");
    lines.push(`**警告**: ${p.warning}`, "");
    lines.push(`n=${p.n} / ROI=${pct(p.roi / 100)} / roiExMaxHit=${pct(p.roiExMaxHit / 100)} / maxHitOdds=${num(p.maxHitOdds)}`, "");
    lines.push("");
  }

  lines.push("---");
  lines.push(`*生成: ${r.generatedAt} / DB: ${r.dbPath}*`);
  return lines.join("\n");
}

function renderPatternTable(lines: string[], patterns: PatternResult[]) {
  lines.push("| 条件 | n | hits | hitRate | ROI | roiExMaxHit | maxHitOdds | 警告 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
  for (const p of patterns) {
    lines.push(`| ${esc(p.label)} | ${p.n} | ${p.hits} | ${pct(p.hitRate)} | ${pct(p.roi / 100)} | ${pct(p.roiExMaxHit / 100)} | ${num(p.maxHitOdds)} | ${p.warning} |`);
  }
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

function esc(s: string): string {
  return s.replaceAll("|", "\\|");
}

// ───────────────── Main ─────────────────

console.log("[weak-patterns] loading rows...");
const rows = loadRows();
console.log(`[weak-patterns] loaded ${rows.length} rows`);

const report = analyzeWeakPatterns(rows);

if (!existsSync("reports")) mkdirSync("reports", { recursive: true });
writeFileSync(OUT_MD, renderMd(report), "utf8");
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

console.log(`[weak-patterns] done → ${OUT_MD} / ${OUT_JSON}`);
console.log(`  DO_NOT_TOUCH: ${report.doNotTouch.map((p) => p.label).join(", ") || "なし"}`);
console.log(`  NO_BUY_CANDIDATE: ${report.noBuyCandidates.map((p) => p.label).join(", ") || "なし"}`);
