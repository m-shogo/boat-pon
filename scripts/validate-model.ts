/**
 * モデル独立検証スクリプト
 *
 * decision_history を時系列で train/test/live に分割し、
 * キャリブレーションの汎化性能・実際のエッジを検証する。
 *
 * usage: npx tsx scripts/validate-model.ts
 */

import { DatabaseSync } from "node:sqlite";

const DB_PATH = "data/boat.sqlite";

// --- 期間設定 ---
const TRAIN_END = "2024-12-31";   // キャリブレーション導出に使った期間
const TEST_END = "2025-12-31";    // 独立テスト期間（未使用データ）
const LIVE_START = "2026-01-01";  // ライブ観察開始

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");

try {
  print();
} finally {
  db.close();
}

function print() {
  console.log("=== Boat Pon モデル検証レポート ===");
  console.log(`生成: ${new Date().toISOString()}`);
  const testYear = String(Number(TRAIN_END.slice(0, 4)) + 1);
  console.log(`期間分割: train≤${TRAIN_END} / test ${testYear}-${TEST_END} / live ${LIVE_START}+`);
  console.log("");

  // --- 1. 全体サマリー（分割別） ---
  const splits = db.prepare(`
    SELECT
      CASE
        WHEN date <= ? THEN 'train(2024)'
        WHEN date <= ? THEN 'test(2025)'
        ELSE 'live(2026+)'
      END AS split,
      COUNT(*) AS n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      ROUND(100.0 * SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) / COUNT(*), 2) AS hit_rate,
      ROUND(AVG(current_odds), 1) AS avg_odds,
      ROUND(AVG(ev), 3) AS avg_ev,
      ROUND(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*), 3) AS roi
    FROM decision_history
    WHERE decision = 'BUY' AND result IS NOT NULL AND result != ''
    GROUP BY split ORDER BY split
  `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;

  console.log("【分割別 BUY 実績】");
  console.log("  split        |  n    | hits | hit% | avg_odds | avg_ev | ROI");
  console.log("  -------------|-------|------|------|----------|--------|----");
  for (const r of splits) {
    console.log(
      `  ${String(r.split).padEnd(13)}| ${String(r.n).padStart(5)} | ${String(r.hits).padStart(4)} | ${String(r.hit_rate).padStart(4)}%| ${String(r.avg_odds).padStart(8)} | ${String(r.avg_ev).padStart(6)} | ${r.roi}`
    );
  }
  console.log("");

  // --- 2. キャリブレーション検証（testセットのみ） ---
  // conservative_hit_rate は後から追加されたカラムのため旧データはNULL。
  // estimated_hit_rate（キャリブレーション後）と actual hit rate を比較する。
  const calibration = db.prepare(`
    SELECT
      CASE
        WHEN current_odds < 20 THEN 'odds<20'
        WHEN current_odds < 30 THEN 'odds 20-30'
        WHEN current_odds < 50 THEN 'odds 30-50'
        WHEN current_odds < 80 THEN 'odds 50-80'
        ELSE 'odds>=80'
      END AS odds_band,
      COUNT(*) AS n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      ROUND(100.0 * SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) / COUNT(*), 2) AS actual_hr,
      ROUND(AVG(estimated_hit_rate) * 100, 2) AS model_hr_calibrated,
      ROUND(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*), 3) AS roi
    FROM decision_history
    WHERE decision = 'BUY' AND result IS NOT NULL AND result != ''
      AND date > ? AND date <= ?
    GROUP BY odds_band ORDER BY odds_band
  `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;

  console.log("【テストセット(2025): オッズ帯別キャリブレーション】");
  console.log("  ※ model_hr = キャリブレーション後の推定ヒット率, actual_hr = 実績");
  console.log("  odds_band  |  n   | hits | actual_hr% | model_hr% | ROI");
  console.log("  -----------|------|------|------------|-----------|----");
  for (const r of calibration) {
    console.log(
      `  ${String(r.odds_band).padEnd(11)}| ${String(r.n).padStart(4)} | ${String(r.hits).padStart(4)} | ${String(r.actual_hr).padStart(10)}%| ${String(r.model_hr_calibrated ?? "-").padStart(9)}%| ${r.roi}`
    );
  }
  console.log("");

  // --- 3. 月次ROI推移（testセット） ---
  const monthly = db.prepare(`
    SELECT
      substr(date, 1, 7) AS ym,
      COUNT(*) AS n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      ROUND(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*), 3) AS roi
    FROM decision_history
    WHERE decision = 'BUY' AND result IS NOT NULL AND result != ''
      AND date > ? AND date <= ?
    GROUP BY ym ORDER BY ym
  `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;

  console.log("【テストセット(2025): 月次ROI推移】");
  console.log("  ym      |  n   | hits | ROI");
  console.log("  --------|------|------|----");
  let cumN = 0; let cumHits = 0; let cumPayout = 0;
  for (const r of monthly) {
    cumN += Number(r.n);
    cumHits += Number(r.hits);
    cumPayout += Number(r.hits) * 1; // 1単位のROI換算
    console.log(`  ${r.ym}  | ${String(r.n).padStart(4)} | ${String(r.hits).padStart(4)} | ${r.roi}`);
  }
  console.log("");

  // --- 4. EV帯別実績（testセット） ---
  const evBands = db.prepare(`
    SELECT
      CASE
        WHEN ev < 1.5 THEN 'ev<1.5'
        WHEN ev < 2.0 THEN 'ev 1.5-2.0'
        WHEN ev < 3.0 THEN 'ev 2.0-3.0'
        ELSE 'ev>=3.0'
      END AS ev_band,
      COUNT(*) AS n,
      SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
      ROUND(100.0 * SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) / COUNT(*), 2) AS hit_rate,
      ROUND(AVG(current_odds), 1) AS avg_odds,
      ROUND(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END) / COUNT(*), 3) AS roi
    FROM decision_history
    WHERE decision = 'BUY' AND result IS NOT NULL AND result != ''
      AND date > ? AND date <= ?
    GROUP BY ev_band ORDER BY ev_band
  `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;

  console.log("【テストセット(2025): EV帯別実績】");
  console.log("  ev_band     |  n   | hits | hit% | avg_odds | ROI");
  console.log("  ------------|------|------|------|----------|----");
  for (const r of evBands) {
    console.log(
      `  ${String(r.ev_band).padEnd(12)}| ${String(r.n).padStart(4)} | ${String(r.hits).padStart(4)} | ${String(r.hit_rate).padStart(4)}%| ${String(r.avg_odds).padStart(8)} | ${r.roi}`
    );
  }
  console.log("");

  // --- 5. 判定 ---
  const testRow = splits.find((r) => String(r.split).startsWith("test"));
  const liveRow = splits.find((r) => String(r.split).startsWith("live"));

  const testRoi = testRow ? Number(testRow.roi) : null;
  const testN = testRow ? Number(testRow.n) : 0;

  console.log("【判定】");
  // 二項検定による95%CI
  if (testRow && testN > 0) {
    const p = Number(testRow.hits) / testN;
    const se = Math.sqrt(p * (1 - p) / testN);
    const avgOdds = Number(testRow.avg_odds);
    const roiLower = avgOdds * (p - 1.96 * se);
    const roiUpper = avgOdds * (p + 1.96 * se);
    console.log(`  テストROI 95%CI: [${roiLower.toFixed(3)}, ${roiUpper.toFixed(3)}]`);
    if (roiLower > 1.0) {
      console.log("  ✅ テストROI下限 > 1.0 → 統計的に有意なエッジあり");
    } else if (testRoi !== null && testRoi > 1.0) {
      console.log("  ⚠️  テストROI > 1.0 だが95%CI下限 < 1.0 → n不足、判断保留");
    } else {
      console.log("  ❌ テストROI < 1.0 → 現時点でエッジ確認できず");
    }
  }

  if (liveRow) {
    const liveN = Number(liveRow.n);
    const liveHits = Number(liveRow.hits);
    const liveRoi = Number(liveRow.roi);
    console.log(`  ライブ(2026): n=${liveN} hits=${liveHits} ROI=${liveRoi} ← n=${300-liveN}件不足`);
  }

  console.log("");
  // EV帯別の逆転現象を検出
  const evLow = evBands.find((r) => String(r.ev_band) === "ev<1.5");
  const evMid = evBands.find((r) => String(r.ev_band) === "ev 1.5-2.0");
  if (evLow && evMid && Number(evLow.roi) > Number(evMid.roi)) {
    console.log("  ⚠️  EV逆転現象: ev<1.5帯(ROI=" + evLow.roi + ") > ev1.5-2.0帯(ROI=" + evMid.roi + ")");
    console.log("     高EVほど市場に対する過大評価リスクが高い可能性。");
    console.log("     → 低オッズ帯のキャリブレーションが相対的に正確。");
  }
  console.log("");

  console.log("【キャリブレーション自己参照リスク】");
  console.log("  V4キャリブレーション係数は2024-2025全データから導出。");
  console.log("  train(2024)ROI と test(2025)ROI の乖離が大きければ過学習の可能性あり。");
  const trainRow = splits.find((r) => String(r.split).startsWith("train"));
  if (trainRow && testRow) {
    const gap = Math.abs(Number(trainRow.roi) - Number(testRow.roi));
    console.log(`  train ROI=${trainRow.roi}  test ROI=${testRow.roi}  乖離=${gap.toFixed(3)}`);
    if (gap < 0.1) console.log("  → 乖離小（過学習リスク低）");
    else if (gap < 0.2) console.log("  → 乖離中（要注意）");
    else console.log("  → 乖離大（過学習の可能性）");
  }
}
