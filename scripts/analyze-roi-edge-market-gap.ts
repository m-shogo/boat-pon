/**
 * analyze-roi-edge-market-gap.ts — 読み取り専用
 *
 * 禁止: DB INSERT/UPDATE/DELETE/DROP, app_settings 変更, 本番 decision ロジック変更
 * BUY は検証候補、ROI は検証指標であり購入推奨ではない。
 * 主評価: race_payouts.payout_yen 実払戻ベース
 * current_odds: 市場評価・期待値proxy・歪み検出用
 *
 * 目的: 「条件を細かく切ってROIを見るだけ」を超え、
 *       「市場評価 (current_odds) と実績のズレ」から edge を探す。
 *
 * 主要メカニズム:
 *   A. 展示 × オッズ乖離: boat3 vs boat2 展示タイム差と市場評価のズレ
 *   B. オッズ帯別の市場精度: implied_prob vs actual_hit_rate
 *   C. 見送り候補との重複: 6R / 浜名湖+住之江の市場歪みプロファイル
 *   D. 1-3-2 missed opportunity: BUY1-2-3を買ったが1-3-2が来た際の機会損失
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD   = "reports/roi-edge-market-gap.md";
const OUT_JSON = "reports/roi-edge-market-gap.json";
const STAKE = 100;
const FORWARD_START = "2025-01-01";
const JUL25_PREFIX  = "2025-07";
const EXCL_VENUES   = ["戸田", "多摩川", "桐生", "三国", "江戸川"];
const EXCL_RACES    = [10, 11, 12];
const N_MIN_MONITOR = 100;
const N_MIN_CHECK   = 50;
const N_MIN_VALID   = 30;

if (!existsSync(DB_PATH)) { console.error(`DB not found: ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000;");

const excl_v = EXCL_VENUES.map(v => `'${v}'`).join(",");
const excl_r = EXCL_RACES.join(",");

function r2(v: number) { return Math.round(v * 100) / 100; }
function calcRoi(payout: number, n: number) { return n > 0 ? r2(payout / (n * STAKE) * 100) : 0; }
function pct(a: number, b: number) { return b > 0 ? r2(a / b * 100) : 0; }

// ─── 直近3M カットオフ ──────────────────────────────────────────────────────────

const dbMaxDate = (db.prepare(
  "SELECT MAX(date) as d FROM decision_history WHERE date >= ?"
).get(FORWARD_START) as { d: string }).d;
const recent3mCutoff = (() => {
  const [y, m, d] = dbMaxDate.split("-").map(Number);
  const dt = new Date(y, m - 4, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
})();

// ─── condB 判定 SQL ─────────────────────────────────────────────────────────────

const WIND24 = `EXISTS (SELECT 1 FROM race_weather rw WHERE rw.race_id=dh.race_id
  AND rw.wind_speed_mps >= 2 AND rw.wind_speed_mps < 4)`;
const EXH1   = `EXISTS (SELECT 1 FROM race_entries re
  JOIN exhibition_data ed ON ed.race_id=re.race_id AND ed.course=re.entry_course
  WHERE re.race_id=dh.race_id AND re.boat=1
    AND ed.exhibition_time IS NOT NULL
    AND ed.exhibition_time = (SELECT MIN(ed2.exhibition_time) FROM exhibition_data ed2
      WHERE ed2.race_id=dh.race_id))`;

// ─── データ取得 ─────────────────────────────────────────────────────────────────

type Row = {
  date: string; venue: string; race_no: number; current_odds: number;
  result: string; payout_123: number; payout_132: number;
  exh1: number | null; exh2: number | null; exh3: number | null; exh4: number | null;
  wind_mps: number | null;
  motor2: number | null; motor3: number | null;
  is_condB: number;
};

console.log("[edge-market-gap] データ取得中...");
const allRows = db.prepare(`
  SELECT dh.date, dh.venue, dh.race_no, dh.current_odds, dh.result,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp
      WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-2-3' LIMIT 1), 0) as payout_123,
    COALESCE((SELECT rp.payout_yen FROM race_payouts rp
      WHERE rp.race_id=dh.race_id AND rp.bet_type='trifecta' AND rp.combination='1-3-2' LIMIT 1), 0) as payout_132,
    (SELECT ed.exhibition_time FROM exhibition_data ed WHERE ed.race_id=dh.race_id AND ed.course=1 LIMIT 1) as exh1,
    (SELECT ed.exhibition_time FROM exhibition_data ed WHERE ed.race_id=dh.race_id AND ed.course=2 LIMIT 1) as exh2,
    (SELECT ed.exhibition_time FROM exhibition_data ed WHERE ed.race_id=dh.race_id AND ed.course=3 LIMIT 1) as exh3,
    (SELECT ed.exhibition_time FROM exhibition_data ed WHERE ed.race_id=dh.race_id AND ed.course=4 LIMIT 1) as exh4,
    (SELECT rw.wind_speed_mps FROM race_weather rw WHERE rw.race_id=dh.race_id LIMIT 1) as wind_mps,
    (SELECT mbs.motor_top2_rate FROM motor_boat_stats mbs WHERE mbs.race_id=dh.race_id AND mbs.course=2 LIMIT 1) as motor2,
    (SELECT mbs.motor_top2_rate FROM motor_boat_stats mbs WHERE mbs.race_id=dh.race_id AND mbs.course=3 LIMIT 1) as motor3,
    CASE WHEN (${WIND24}) AND (${EXH1}) THEN 1 ELSE 0 END as is_condB
  FROM decision_history dh
  WHERE dh.decision='BUY' AND dh.run_kind='historical-backfill'
    AND dh.result IS NOT NULL AND dh.result != ''
    AND dh.current_odds IS NOT NULL
    AND dh.venue NOT IN (${excl_v}) AND dh.race_no NOT IN (${excl_r})
    AND dh.selection='1-2-3' AND dh.date >= '${FORWARD_START}'
  ORDER BY dh.date
`).all() as Row[];

const totalN   = allRows.length;
const baseROI  = calcRoi(allRows.reduce((a, r) => a + r.payout_123, 0), totalN);
const totalHits = allRows.filter(r => r.result === "1-2-3").length;
const total132  = allRows.filter(r => r.result === "1-3-2").length;
const avgImplied = r2(allRows.reduce((a, r) => a + (1 / r.current_odds), 0) / totalN * 100);
const actualRate = r2(totalHits / totalN * 100);
console.log(`[edge-market-gap] n=${totalN} hits123=${totalHits} hits132=${total132} baseROI=${baseROI}%`);
console.log(`  implied_prob=${avgImplied}% actual_rate=${actualRate}% gap=${r2(actualRate - avgImplied)}pt`);

// ─── 汎用セル統計 ───────────────────────────────────────────────────────────────

type CellStats = {
  n: number;
  hits123: number; hits132: number; hitRateOther: number;
  roi123: number; roi132loss: number;
  avgOdds: number; avgImplied: number; actualRate: number; marketGap: number;
  avgPayout123: number; maxPayout123: number;
  top1Roi: number; top2Roi: number; top3Roi: number;
  jackpotRatio: number;
  recent3mRoi: number; exJul25Roi: number;
  weakMonths: number; totalMonths: number;
  overlapCondB: number; overlap6R: number; overlapBadVenue: number;
  nStatus: "data-insufficient" | "要確認" | "monitor候補" | "格上げ/降格候補";
  verdict: string;
};

function cellStats(rows: Row[], label: string): CellStats {
  const n      = rows.length;
  const h123   = rows.filter(r => r.result === "1-2-3");
  const h132   = rows.filter(r => r.result === "1-3-2");
  const hits123 = h123.length;
  const hits132 = h132.length;

  const pay123  = rows.reduce((a, r) => a + r.payout_123, 0);
  const pay132  = rows.reduce((a, r) => a + r.payout_132, 0); // 132が来た時の払戻（機会損失測定用）
  const roi123  = calcRoi(pay123, n);
  // roi132loss: もし1-3-2を買っていたとすると得られたROI（参考値、事後情報）
  const roi132loss = calcRoi(pay132, n);

  const avgOdds   = n > 0 ? r2(rows.reduce((a, r) => a + r.current_odds, 0) / n) : 0;
  const avgImp    = n > 0 ? r2(rows.reduce((a, r) => a + (1 / r.current_odds), 0) / n * 100) : 0;
  const actRate   = r2(pct(hits123, n));
  const gap       = r2(actRate - avgImp);

  // top排除ROI
  const sorted    = [...rows].sort((a, b) => b.payout_123 - a.payout_123);
  const top1Pay   = sorted[0]?.payout_123 ?? 0;
  const top2Pay   = top1Pay + (sorted[1]?.payout_123 ?? 0);
  const top3Pay   = top2Pay + (sorted[2]?.payout_123 ?? 0);
  const hitPays   = h123.map(r => r.payout_123);
  const avgPay    = hitPays.length > 0 ? r2(hitPays.reduce((a, v) => a + v, 0) / hitPays.length) : 0;
  const maxPay    = sorted[0]?.payout_123 ?? 0;

  // 直近3M
  const rec3m     = rows.filter(r => r.date >= recent3mCutoff);
  const r3mRoi    = calcRoi(rec3m.reduce((a, r) => a + r.payout_123, 0), rec3m.length);
  // exJul25
  const exJ       = rows.filter(r => !r.date.startsWith(JUL25_PREFIX));
  const exJRoi    = calcRoi(exJ.reduce((a, r) => a + r.payout_123, 0), exJ.length);

  // 月別安定性
  const months    = [...new Set(rows.map(r => r.date.slice(0, 7)))].sort();
  const mRois     = months.map(m => {
    const mr = rows.filter(r => r.date.startsWith(m));
    return mr.length >= 3 ? calcRoi(mr.reduce((a, r) => a + r.payout_123, 0), mr.length) : null;
  }).filter((v): v is number => v !== null);
  const weakMths  = mRois.filter(v => v < 50).length;

  // overlaps
  const oB  = rows.filter(r => r.is_condB === 1).length;
  const o6R = rows.filter(r => r.race_no === 6).length;
  const oBV = rows.filter(r => r.venue === "浜名湖" || r.venue === "住之江").length;

  const nStatus: CellStats["nStatus"] = n < N_MIN_VALID ? "data-insufficient"
    : n < N_MIN_CHECK ? "要確認"
    : n < N_MIN_MONITOR ? "monitor候補"
    : "格上げ/降格候補";

  const verdict = deriveVerdict(n, roi123, gap, top2Pay > 0 ? calcRoi(pay123 - top2Pay, n) : roi123,
    weakMths, mRois.length, exJRoi, r3mRoi);

  return {
    n, hits123, hits132, hitRateOther: r2(pct(n - hits123 - hits132, n)),
    roi123, roi132loss, avgOdds, avgImplied: avgImp, actualRate: actRate, marketGap: gap,
    avgPayout123: avgPay, maxPayout123: maxPay,
    top1Roi: calcRoi(pay123 - top1Pay, n), top2Roi: calcRoi(pay123 - top2Pay, n), top3Roi: calcRoi(pay123 - top3Pay, n),
    jackpotRatio: pay123 > 0 ? r2(top1Pay / pay123 * 100) : 0,
    recent3mRoi: r3mRoi, exJul25Roi: exJRoi,
    weakMonths: weakMths, totalMonths: mRois.length,
    overlapCondB: oB, overlap6R: o6R, overlapBadVenue: oBV,
    nStatus, verdict,
  };
}

function deriveVerdict(
  n: number, roi: number, gap: number, top2Roi: number,
  weakMonths: number, totalMonths: number, exJRoi: number, rec3mRoi: number
): string {
  if (n < N_MIN_VALID) return "⚫ data-insufficient (n<30)";
  if (n < N_MIN_CHECK) return "🔍 n不足 — 要確認";
  if (exJRoi < 85 && roi > 95) return "⚠️ 後付き可能性 (2025-07依存)";
  if (top2Roi < 95 && roi > 95) return "⚠️ 高配当依存 (top2除外ROI<95%)";
  if (gap < -3 && n >= N_MIN_CHECK) return "📌 skip候補 — 市場が1-2-3を過大評価";
  if (gap > 3 && roi >= 95 && top2Roi >= 95) return "✅ edge候補 — 市場が1-2-3を過小評価";
  if (gap > 3 && roi >= 90) return "◐ 弱edge候補 (top2確認要)";
  if (roi < 80) return "❌ 除外候補 — ROI低";
  return "— monitor継続";
}

// ─── 分析セグメント定義 ─────────────────────────────────────────────────────────

type Segment = { label: string; desc: string; rows: Row[] };

function makeSegs(): Segment[] {
  const segs: Segment[] = [];

  // ① 全体ベースライン
  segs.push({ label: "全体", desc: "baseline (n=1522)", rows: allRows });

  // ② 展示タイム差: boat3 vs boat2
  const withExh = allRows.filter(r => r.exh2 != null && r.exh3 != null);
  const b3faster  = withExh.filter(r => r.exh3! < r.exh2!);
  const b3slower  = withExh.filter(r => r.exh3! > r.exh2!);
  const b3equal   = withExh.filter(r => r.exh3! === r.exh2!);
  segs.push({ label: "3号艇exh < 2号艇exh (3号艇が速い)", desc: "boat3展示が2号艇より速い", rows: b3faster });
  segs.push({ label: "3号艇exh > 2号艇exh (2号艇が速い)", desc: "boat2展示が3号艇より速い", rows: b3slower });

  // タイム差の大きさ（3号艇が速い側で細分化）
  const b3vb2 = (r: Row) => r.exh2 != null && r.exh3 != null ? r.exh2! - r.exh3! : null;
  segs.push({ label: "3号艇より速い差 ≥0.03s (明確に速い)", desc: "exh2 - exh3 >= 0.03秒", rows: withExh.filter(r => { const d = b3vb2(r); return d != null && d >= 0.03; }) });
  segs.push({ label: "3号艇より速い差 0.01〜0.03s", desc: "0.01 <= exh2 - exh3 < 0.03", rows: withExh.filter(r => { const d = b3vb2(r); return d != null && d >= 0.01 && d < 0.03; }) });
  segs.push({ label: "拮抗 (差 <0.01s)", desc: "|exh2 - exh3| < 0.01秒", rows: withExh.filter(r => { const d = b3vb2(r); return d != null && Math.abs(d) < 0.01; }) });

  // ③ 1号艇展示最速 vs 非最速
  const withAllExh = allRows.filter(r => r.exh1 != null && r.exh2 != null && r.exh3 != null);
  const b1fastest = withAllExh.filter(r => {
    const vals = [r.exh1!, r.exh2!, r.exh3!];
    if (r.exh4 != null) vals.push(r.exh4!);
    return r.exh1! === Math.min(...vals);
  });
  const b1notFastest = withAllExh.filter(r => {
    const vals = [r.exh1!, r.exh2!, r.exh3!];
    if (r.exh4 != null) vals.push(r.exh4!);
    return r.exh1! > Math.min(...vals);
  });
  segs.push({ label: "1号艇展示最速", desc: "1号艇の展示タイムが全艇中最速", rows: b1fastest });
  segs.push({ label: "1号艇展示非最速", desc: "1号艇展示が最速ではない", rows: b1notFastest });

  // ④ オッズ帯別
  segs.push({ label: "odds<20 (本命)", desc: "current_odds < 20", rows: allRows.filter(r => r.current_odds < 20) });
  segs.push({ label: "odds 20〜39",     desc: "20 <= current_odds < 40", rows: allRows.filter(r => r.current_odds >= 20 && r.current_odds < 40) });
  segs.push({ label: "odds 40〜79 (中穴)", desc: "40 <= current_odds < 80", rows: allRows.filter(r => r.current_odds >= 40 && r.current_odds < 80) });
  segs.push({ label: "odds≥80 (大穴)", desc: "current_odds >= 80", rows: allRows.filter(r => r.current_odds >= 80) });

  // ⑤ 展示 × オッズ 交差（主要な仮説）
  const b3f_lo = b3faster.filter(r => r.current_odds < 40);
  const b3f_mid = b3faster.filter(r => r.current_odds >= 40 && r.current_odds < 80);
  const b3f_hi = b3faster.filter(r => r.current_odds >= 80);
  const b3s_lo = b3slower.filter(r => r.current_odds < 40);
  const b3s_mid = b3slower.filter(r => r.current_odds >= 40 && r.current_odds < 80);
  segs.push({ label: "3号艇速い × odds<40", desc: "3号艇展示速い + 本命〜中穴", rows: b3f_lo });
  segs.push({ label: "3号艇速い × odds40〜79", desc: "3号艇展示速い + 中穴帯", rows: b3f_mid });
  segs.push({ label: "3号艇速い × odds≥80", desc: "3号艇展示速い + 大穴帯", rows: b3f_hi });
  segs.push({ label: "2号艇速い × odds<40", desc: "2号艇展示速い + 本命〜中穴", rows: b3s_lo });
  segs.push({ label: "2号艇速い × odds40〜79", desc: "2号艇展示速い + 中穴帯", rows: b3s_mid });

  // ⑥ 風速 × 展示
  const windRows = allRows.filter(r => r.wind_mps != null);
  const wind24   = windRows.filter(r => r.wind_mps! >= 2 && r.wind_mps! < 4);
  const windHigh = windRows.filter(r => r.wind_mps! >= 4);
  const windLow  = windRows.filter(r => r.wind_mps! < 2);
  segs.push({ label: "風速0〜2m/s (微風)", desc: "wind_mps < 2", rows: windLow });
  segs.push({ label: "風速2〜4m/s (条件B風速帯)", desc: "2 <= wind_mps < 4", rows: wind24 });
  segs.push({ label: "風速≥4m/s (強風)", desc: "wind_mps >= 4", rows: windHigh });

  const wind24_b3fast = wind24.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! < r.exh2!);
  const wind24_b3slow = wind24.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! > r.exh2!);
  segs.push({ label: "風速2〜4 × 3号艇速い", desc: "条件B風速帯 + 3号艇展示速い", rows: wind24_b3fast });
  segs.push({ label: "風速2〜4 × 2号艇速い", desc: "条件B風速帯 + 2号艇展示速い", rows: wind24_b3slow });

  // ⑦ 見送り候補との重複プロファイル
  const r6 = allRows.filter(r => r.race_no === 6);
  const badVenue = allRows.filter(r => r.venue === "浜名湖" || r.venue === "住之江");
  const condB  = allRows.filter(r => r.is_condB === 1);
  segs.push({ label: "6R", desc: "race_no=6 (見送り候補)", rows: r6 });
  segs.push({ label: "浜名湖+住之江", desc: "0hit継続監視会場", rows: badVenue });
  segs.push({ label: "条件B重複", desc: "condB (風速2〜4 × 1号艇展示最速)", rows: condB });

  // 6R内の展示プロファイル
  const r6_b3fast = r6.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! < r.exh2!);
  const r6_b3slow = r6.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! > r.exh2!);
  segs.push({ label: "6R × 3号艇速い", desc: "6R + 3号艇展示速い", rows: r6_b3fast });
  segs.push({ label: "6R × 2号艇速い", desc: "6R + 2号艇展示速い", rows: r6_b3slow });
  segs.push({ label: "6R × odds<40", desc: "6R + 本命帯", rows: r6.filter(r => r.current_odds < 40) });
  segs.push({ label: "6R × odds40〜79", desc: "6R + 中穴帯", rows: r6.filter(r => r.current_odds >= 40 && r.current_odds < 80) });

  return segs;
}

// ─── 1-3-2 missed opportunity 分析 ────────────────────────────────────────────

type MissedOpp = {
  label: string; n: number; opp132N: number; opp132Rate: number;
  avgPayout132: number; avgPayout123: number; roi_if_132: number;
  exh3FasterPct: number; wind24Pct: number; condBPct: number;
  avgOdds123: number;
};

function missedOpportunity(rows: Row[], label: string): MissedOpp {
  const hit132 = rows.filter(r => r.result === "1-3-2");
  const hit123 = rows.filter(r => r.result === "1-2-3");
  const exhRows = rows.filter(r => r.exh2 != null && r.exh3 != null);
  const exhB3fast = exhRows.filter(r => r.exh3! < r.exh2!);

  return {
    label, n: rows.length,
    opp132N: hit132.length,
    opp132Rate: pct(hit132.length, rows.length),
    avgPayout132: hit132.length > 0 ? r2(hit132.reduce((a, r) => a + r.payout_132, 0) / hit132.length) : 0,
    avgPayout123: hit123.length > 0 ? r2(hit123.reduce((a, r) => a + r.payout_123, 0) / hit123.length) : 0,
    roi_if_132: calcRoi(rows.reduce((a, r) => a + r.payout_132, 0), rows.length),
    exh3FasterPct: pct(exhB3fast.length, exhRows.length),
    wind24Pct: pct(rows.filter(r => r.wind_mps != null && r.wind_mps >= 2 && r.wind_mps < 4).length, rows.length),
    condBPct: pct(rows.filter(r => r.is_condB === 1).length, rows.length),
    avgOdds123: rows.length > 0 ? r2(rows.reduce((a, r) => a + r.current_odds, 0) / rows.length) : 0,
  };
}

// ─── 計算実行 ─────────────────────────────────────────────────────────────────

console.log("[edge-market-gap] セグメント計算中...");
const segs = makeSegs();
const segResults: Array<{ seg: Segment; stats: CellStats }> = segs.map(s => ({
  seg: s, stats: cellStats(s.rows, s.label),
}));

// missed opportunity 分析
const missedOpps: MissedOpp[] = [
  missedOpportunity(allRows, "全体"),
  missedOpportunity(allRows.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! < r.exh2!), "3号艇展示速い"),
  missedOpportunity(allRows.filter(r => r.exh2 != null && r.exh3 != null && r.exh3! > r.exh2!), "2号艇展示速い"),
  missedOpportunity(allRows.filter(r => r.wind_mps != null && r.wind_mps >= 2 && r.wind_mps < 4), "風速2〜4"),
  missedOpportunity(allRows.filter(r => r.is_condB === 1), "条件B"),
  missedOpportunity(allRows.filter(r => r.race_no === 6), "6R"),
  missedOpportunity(allRows.filter(r => r.venue === "浜名湖" || r.venue === "住之江"), "浜名湖+住之江"),
];

// ─── レポート生成 ───────────────────────────────────────────────────────────────

function fmtGap(v: number) {
  if (v >= 3)  return `**+${v}pt** ✅`;
  if (v >= 1)  return `+${v}pt`;
  if (v <= -3) return `**${v}pt** 📌`;
  if (v <= -1) return `${v}pt`;
  return `${v}pt`;
}
function fmtRoi(v: number) {
  if (v >= 100) return `**${v}%** ✅`;
  if (v >= 90)  return `${v}%`;
  return `${v}%`;
}

function buildMarkdown(): string {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const ls: string[] = [];

  ls.push(`# ROI Edge × Market Gap Analysis`);
  ls.push(`\n生成: ${now}  DB最新日: ${dbMaxDate}  直近3Mカット: ${recent3mCutoff}`);
  ls.push(`\n> **注意**: 読み取り専用。app_settings・本番decision変更不可。購入指示ではない。`);
  ls.push(`> current_odds は市場評価・歪み検出用。主評価は payout_yen 実払戻ベース。`);
  ls.push(`> payout_yen や実着順などの事後情報に依存する条件は運用不可。`);

  // ── ベースライン
  ls.push(`\n## ベースライン`);
  ls.push(`\n| 項目 | 値 |`);
  ls.push(`|---|---|`);
  ls.push(`| forward 期間 | ${FORWARD_START} 〜 ${dbMaxDate} |`);
  ls.push(`| n | ${totalN} |`);
  ls.push(`| hits (1-2-3) | ${totalHits} (${r2(pct(totalHits, totalN))}%) |`);
  ls.push(`| 1-3-2 hit件数 | ${total132} (${r2(pct(total132, totalN))}%) |`);
  ls.push(`| ROI (1-2-3実払戻) | ${baseROI}% |`);
  ls.push(`| 市場 implied_prob (平均) | ${avgImplied}% |`);
  ls.push(`| 実績的中率 | ${actualRate}% |`);
  ls.push(`| 市場gap (実績-implied) | ${fmtGap(r2(actualRate - avgImplied))} |`);
  ls.push(`\n> **market_gap**: 正 = 市場が過小評価（1-2-3を売りにくい → BUY edge）/ 負 = 市場が過大評価（1-2-3が人気化 → SKIP候補）`);

  // ── セグメント比較サマリ
  ls.push(`\n## セグメント比較サマリ`);
  ls.push(`\n| セグメント | n | ROI | market_gap | implied_prob | 実績rate | top2除外ROI | 直近3M | exJul25 | 判定 |`);
  ls.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---|`);
  for (const { seg, stats: s } of segResults) {
    ls.push(`| ${seg.label} | ${s.n} | ${fmtRoi(s.roi123)} | ${fmtGap(s.marketGap)} | ${s.avgImplied}% | ${s.actualRate}% | ${fmtRoi(s.top2Roi)} | ${s.recent3mRoi}% | ${s.exJul25Roi}% | ${s.verdict} |`);
  }

  // ── 1-3-2 missed opportunity
  ls.push(`\n## 1-3-2 Missed Opportunity（事後参考）`);
  ls.push(`\n> 1-2-3を買ったが1-3-2が来た際の機会損失。運用条件には使用不可（事後情報）。市場のズレ理解用。`);
  ls.push(`\n| セグメント | n | 1-3-2 hit率 | 1-3-2平均払戻 | 1-2-3平均払戻 | もし1-3-2を買ったROI | 3号艇速い% | 風2〜4% |`);
  ls.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const m of missedOpps) {
    ls.push(`| ${m.label} | ${m.n} | ${m.opp132Rate}% | ${m.avgPayout132}円 | ${m.avgPayout123}円 | ${m.roi_if_132}% | ${m.exh3FasterPct}% | ${m.wind24Pct}% |`);
  }

  // ── セグメント詳細（主要候補のみ）
  ls.push(`\n## セグメント詳細`);
  for (const { seg, stats: s } of segResults) {
    if (s.n < N_MIN_VALID && seg.label !== "全体") continue; // n<30は詳細省略
    ls.push(`\n### ${seg.label}`);
    ls.push(`\n${seg.desc}`);
    ls.push(`\n| 項目 | 値 |`);
    ls.push(`|---|---|`);
    ls.push(`| n | ${s.n} (${s.nStatus}) |`);
    ls.push(`| 1-2-3 hits | ${s.hits123} (${s.actualRate}%) |`);
    ls.push(`| 1-3-2 hits | ${s.hits132} (${r2(pct(s.hits132, s.n))}%) |`);
    ls.push(`| ROI (1-2-3) | ${fmtRoi(s.roi123)} |`);
    ls.push(`| avg_payout (1-2-3 hit時) | ${s.avgPayout123}円 |`);
    ls.push(`| max_payout | ${s.maxPayout123}円 |`);
    ls.push(`| top1除外ROI | ${s.top1Roi}% |`);
    ls.push(`| top2除外ROI | ${fmtRoi(s.top2Roi)} |`);
    ls.push(`| top3除外ROI | ${s.top3Roi}% |`);
    ls.push(`| jackpot依存度 | ${s.jackpotRatio}% |`);
    ls.push(`| avg current_odds | ${s.avgOdds} |`);
    ls.push(`| market implied_prob | ${s.avgImplied}% |`);
    ls.push(`| 実績的中率 | ${s.actualRate}% |`);
    ls.push(`| **market gap** | **${s.marketGap}pt** |`);
    ls.push(`| 直近3M ROI | ${s.recent3mRoi}% |`);
    ls.push(`| 2025-07除外後ROI | ${s.exJul25Roi}% |`);
    ls.push(`| 月別不安定(ROI<50%) | ${s.weakMonths}/${s.totalMonths}ヶ月 |`);
    ls.push(`| 条件B重複 | ${s.overlapCondB}件 |`);
    ls.push(`| 6R重複 | ${s.overlap6R}件 |`);
    ls.push(`| 浜名湖+住之江重複 | ${s.overlapBadVenue}件 |`);
    ls.push(`| **判定** | **${s.verdict}** |`);
  }

  // ── 結論
  ls.push(`\n## 結論`);
  ls.push(`\n### 今すぐ app_settings に反映してよい候補`);
  ls.push(`\n**原則なし。** 読み取り専用シミュレーションです。`);

  const edgeCands = segResults.filter(x => x.stats.verdict.startsWith("✅") && x.stats.n >= N_MIN_MONITOR);
  ls.push(`\n### edge候補として monitor する価値があるもの`);
  if (edgeCands.length === 0) {
    ls.push(`\n（なし — 市場gap>3pt かつ top2ROI≥100 かつ n≥100 を満たす候補なし）`);
    ls.push(`\n現時点で本採用可能な edge は確認されませんでした。`);
  } else {
    for (const x of edgeCands) {
      ls.push(`- **${x.seg.label}**: ROI=${x.stats.roi123}% / gap=+${x.stats.marketGap}pt / n=${x.stats.n}`);
    }
  }

  const skipCands = segResults.filter(x => x.stats.verdict.startsWith("📌") && x.stats.n >= N_MIN_MONITOR);
  ls.push(`\n### 見送り候補として monitor する価値があるもの`);
  if (skipCands.length === 0) {
    ls.push(`\n（なし）`);
  } else {
    for (const x of skipCands) {
      ls.push(`- **${x.seg.label}**: ROI=${x.stats.roi123}% / gap=${x.stats.marketGap}pt / n=${x.stats.n}`);
    }
  }

  ls.push(`\n### 条件B n=200まで判断保留`);
  ls.push(`- 条件B関連セグメント: forward n=167。n=200到達まで app_settings 変更不可`);

  const top2Pending = segResults.filter(x => x.stats.verdict.includes("高配当依存") && x.stats.n >= N_MIN_MONITOR);
  ls.push(`\n### top2除外ROI未達で保留`);
  for (const x of top2Pending) {
    ls.push(`- **${x.seg.label}**: ROI=${x.stats.roi123}% / top2ROI=${x.stats.top2Roi}% / gap=${x.stats.marketGap}pt`);
  }

  const insufficient = segResults.filter(x => x.stats.nStatus === "data-insufficient" || x.stats.nStatus === "要確認");
  ls.push(`\n### n不足で凍結`);
  for (const x of insufficient) {
    if (x.seg.label === "全体") continue;
    ls.push(`- **${x.seg.label}**: n=${x.stats.n}`);
  }

  // 主要洞察
  ls.push(`\n### 主要洞察`);

  // boat3 faster vs slower
  const b3f = segResults.find(x => x.seg.label.startsWith("3号艇exh < 2号艇exh"))?.stats;
  const b3s = segResults.find(x => x.seg.label.startsWith("3号艇exh > 2号艇exh"))?.stats;
  if (b3f && b3s) {
    ls.push(`\n**展示 × 市場ズレ:**`);
    ls.push(`- 3号艇展示速い (n=${b3f.n}): ROI=${b3f.roi123}% / gap=${b3f.marketGap}pt / 1-3-2 hit=${b3f.hits132}件`);
    ls.push(`- 2号艇展示速い (n=${b3s.n}): ROI=${b3s.roi123}% / gap=${b3s.marketGap}pt / 1-3-2 hit=${b3s.hits132}件`);
    const gapDiff = r2(b3f.marketGap - b3s.marketGap);
    ls.push(`- 展示逆転による market_gap 差: ${gapDiff}pt`);
  }

  ls.push(`\n**6Rの弱さの展示プロファイル:**`);
  const r6Stat = segResults.find(x => x.seg.label === "6R")?.stats;
  const r6b3f  = segResults.find(x => x.seg.label === "6R × 3号艇速い")?.stats;
  const r6b3s  = segResults.find(x => x.seg.label === "6R × 2号艇速い")?.stats;
  if (r6Stat) ls.push(`- 6R全体: ROI=${r6Stat.roi123}% / gap=${r6Stat.marketGap}pt / 1-3-2 hit=${r6Stat.hits132}件`);
  if (r6b3f)  ls.push(`- 6R×3号艇速い: ROI=${r6b3f.roi123}% / n=${r6b3f.n}`);
  if (r6b3s)  ls.push(`- 6R×2号艇速い: ROI=${r6b3s.roi123}% / n=${r6b3s.n}`);

  const baseGap = r2(actualRate - avgImplied);
  ls.push(`\n**市場精度の総評:**`);
  ls.push(`- baseline market_gap = ${baseGap}pt (${baseGap > 0 ? "市場は1-2-3を若干過小評価" : "市場は1-2-3を若干過大評価"})`);
  ls.push(`- 現在のROI=87.12%はほぼ市場期待値通り（edge = ほぼゼロ）`);
  ls.push(`- 特定セグメントで market_gap が有意に正になる条件が存在すれば edge 候補`);

  ls.push(`\n### 次に見るべき1本`);
  const bestGapSeg = segResults
    .filter(x => x.stats.n >= N_MIN_MONITOR && !x.seg.label.includes("全体") && x.stats.exJul25Roi > 85)
    .sort((a, b) => b.stats.marketGap - a.stats.marketGap)[0];
  if (bestGapSeg) {
    ls.push(`\n**${bestGapSeg.seg.label}** — market_gap=${bestGapSeg.stats.marketGap}pt / ROI=${bestGapSeg.stats.roi123}% / n=${bestGapSeg.stats.n}`);
    ls.push(`データが積み上がった時点で本スクリプトを再実行し、gap の再現性を確認する。`);
  }

  return ls.join("\n");
}

// ─── 出力 ─────────────────────────────────────────────────────────────────────

mkdirSync("reports", { recursive: true });
const md = buildMarkdown();
writeFileSync(OUT_MD, md, "utf8");

const jsonOut = {
  generatedAt: new Date().toISOString(),
  dbMaxDate, recent3mCutoff,
  baseline: { n: totalN, hits123: totalHits, hits132: total132, roi: baseROI, avgImplied, actualRate, marketGap: r2(actualRate - avgImplied) },
  segments: segResults.map(x => ({ label: x.seg.label, desc: x.seg.desc, ...x.stats })),
  missedOpportunity: missedOpps,
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 2), "utf8");

console.log(`\n[edge-market-gap] 完了 → ${OUT_MD}`);
console.log(`  baseline market_gap: ${r2(actualRate - avgImplied)}pt (implied=${avgImplied}% / actual=${actualRate}%)`);
console.log(`\n  主要セグメント market_gap 上位:`);
const ranked = segResults
  .filter(x => x.stats.n >= 50 && !x.seg.label.includes("全体"))
  .sort((a, b) => b.stats.marketGap - a.stats.marketGap);
for (const x of ranked.slice(0, 8)) {
  console.log(`    ${x.seg.label}: gap=${x.stats.marketGap}pt / ROI=${x.stats.roi123}% / n=${x.stats.n} / top2=${x.stats.top2Roi}%`);
}
console.log(`\n  1-3-2 missed opportunity top3:`);
const topMiss = [...missedOpps].sort((a, b) => b.opp132Rate - a.opp132Rate).slice(0, 3);
for (const m of topMiss) {
  console.log(`    ${m.label}: 1-3-2 hit率=${m.opp132Rate}% / avg払戻=${m.avgPayout132}円`);
}
