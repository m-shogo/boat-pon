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
  console.log(`期間分割: train ≤${TRAIN_END}  /  test ${testYear}-01-01〜${TEST_END}  /  live ${LIVE_START}+`);
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
    GROUP BY split
    ORDER BY CASE split WHEN 'train(2024)' THEN 1 WHEN 'test(2025)' THEN 2 ELSE 3 END
  `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;

  console.log("【分割別 BUY 実績】");
  console.log("  split        |  n    | hits | hit% | avg_odds | avg_ev | ROI   | bar");
  console.log("  -------------|-------|------|------|----------|--------|-------|-----");
  for (const r of splits) {
    const roi = Number(r.roi ?? 0);
    const bar = roiBar(roi);
    console.log(
      `  ${String(r.split).padEnd(13)}| ${String(r.n).padStart(5)} | ${String(r.hits).padStart(4)} | ${String(r.hit_rate).padStart(4)}%| ${String(r.avg_odds).padStart(8)} | ${String(r.avg_ev).padStart(6)} | ${String(r.roi).padStart(5)} | ${bar}`
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
  console.log("  ym      |  n   | hits | ROI   | bar");
  console.log("  --------|------|------|-------|-----");
  for (const r of monthly) {
    const roi = Number(r.roi ?? 0);
    const bar = roiBar(roi);
    console.log(`  ${r.ym}  | ${String(r.n).padStart(4)} | ${String(r.hits).padStart(4)} | ${String(r.roi).padStart(5)} | ${bar}`);
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

  // --- 6a. Brierスコア（モデル vs 市場の校正品質） ---
  // Brier = mean((p_est - result)^2)。小さいほど良い。
  const brier = db.prepare(`
    SELECT
      COUNT(*) AS n,
      ROUND(AVG(
        (estimated_hit_rate - CASE WHEN selection=result THEN 1.0 ELSE 0.0 END) *
        (estimated_hit_rate - CASE WHEN selection=result THEN 1.0 ELSE 0.0 END)
      ), 5) AS brier_model,
      ROUND(AVG(
        (1.0/current_odds*0.75 - CASE WHEN selection=result THEN 1.0 ELSE 0.0 END) *
        (1.0/current_odds*0.75 - CASE WHEN selection=result THEN 1.0 ELSE 0.0 END)
      ), 5) AS brier_market
    FROM decision_history
    WHERE decision='BUY' AND result IS NOT NULL AND result!=''
      AND date > ? AND date <= ?
      AND current_odds IS NOT NULL
  `).get(TRAIN_END, TEST_END) as Record<string, unknown>;

  console.log("【Brierスコア: モデル vs 市場の校正品質】（テストセット）");
  console.log("  ※ 小さいほど校正精度高い。market Brier = 1/odds×0.75 基準。");
  const bM = Number(brier.brier_model ?? 0);
  const bMkt = Number(brier.brier_market ?? 0);
  console.log(`  モデルBrier: ${bM.toFixed(5)}   市場Brier: ${bMkt.toFixed(5)}`);
  if (bM > bMkt) {
    console.log(`  → 市場の方が${((bM - bMkt) / bMkt * 100).toFixed(1)}%精度高い。marketBlendWeight > 0 の検討価値あり（現在=0）。`);
  } else {
    console.log("  → モデルの方が校正精度高い。市場に頼らない方針継続。");
  }
  console.log("");

  // --- 6b. ローリング3ヶ月 Walk-Forward ---
  const rollingWindows: [string, string, string][] = [
    ["2025-01-01", "2025-03-31", "Jan-Mar"],
    ["2025-02-01", "2025-04-30", "Feb-Apr"],
    ["2025-03-01", "2025-05-31", "Mar-May"],
    ["2025-04-01", "2025-06-30", "Apr-Jun"],
    ["2025-05-01", "2025-07-31", "May-Jul"],
    ["2025-06-01", "2025-08-31", "Jun-Aug"],
    ["2025-07-01", "2025-09-30", "Jul-Sep"],
    ["2025-08-01", "2025-10-31", "Aug-Oct"],
    ["2025-09-01", "2025-11-30", "Sep-Nov"],
  ];
  const rollingQ = db.prepare(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN selection=result THEN 1 ELSE 0 END) AS hits,
      ROUND(SUM(CASE WHEN selection=result THEN current_odds ELSE 0 END)/COUNT(*), 3) AS roi
    FROM decision_history
    WHERE decision='BUY' AND result IS NOT NULL AND result!=''
      AND date >= ? AND date <= ?
  `);

  console.log("【ローリング3ヶ月 Walk-Forward（テストセット、重複あり）】");
  console.log("  window    |  n   | hits | ROI   | bar");
  console.log("  ----------|------|------|-------|-----");
  let profitableW = 0;
  for (const [s, e, label] of rollingWindows) {
    const r = (rollingQ.all(s, e) as Array<Record<string, unknown>>)[0];
    const roi = Number(r?.roi ?? 0);
    if (roi >= 1.0) profitableW++;
    console.log(`  ${label.padEnd(10)}| ${String(r?.n ?? 0).padStart(4)} | ${String(r?.hits ?? 0).padStart(4)} | ${String(r?.roi ?? 0).padStart(5)} | ${roiBar(roi)}`);
  }
  console.log(`  黒字ウィンドウ: ${profitableW}/${rollingWindows.length}  ${profitableW <= 2 ? "⚠️ 一発性（期間依存）" : profitableW >= 6 ? "✅ 安定" : "→ 要観察"}`);
  console.log("");

  // --- 6c. 人気帯別ROI（selection_popularity カラムから） ---
  // 注: 2025テスト期間はselection_popularityが未収集のため空。2026ライブ以降から蓄積。
  let popularityBands: Array<Record<string, unknown>> = [];
  try {
    popularityBands = db.prepare(`
      SELECT
        CASE
          WHEN selection_popularity <= 5 THEN 'pop 1-5 (本命)'
          WHEN selection_popularity <= 10 THEN 'pop 6-10'
          WHEN selection_popularity <= 20 THEN 'pop11-20 (中穴)'
          ELSE 'pop21+ (大穴)'
        END AS pop_band,
        COUNT(*) AS n,
        SUM(CASE WHEN selection = result THEN 1 ELSE 0 END) AS hits,
        ROUND(100.0*SUM(CASE WHEN selection = result THEN 1 ELSE 0 END)/COUNT(*), 2) AS hit_rate,
        ROUND(AVG(current_odds), 1) AS avg_odds,
        ROUND(SUM(CASE WHEN selection = result THEN current_odds ELSE 0 END)/COUNT(*), 3) AS roi
      FROM decision_history
      WHERE decision='BUY' AND result IS NOT NULL AND result!=''
        AND date > ? AND date <= ?
        AND selection_popularity IS NOT NULL
      GROUP BY pop_band ORDER BY MIN(selection_popularity)
    `).all(TRAIN_END, TEST_END) as Array<Record<string, unknown>>;
  } catch {
    // selection_popularity カラム未追加（初回起動前）
  }

  console.log("【人気帯別ROI（selection_popularityカラム）】");
  console.log("  ※ Favorite-Longshot Bias: 中穴帯(pop6-20)にEdge残存の理論的根拠");
  if (popularityBands.length > 0) {
    console.log("  pop_band           |  n   | hits | hit% | avg_odds | ROI");
    console.log("  -------------------|------|------|------|----------|----");
    for (const r of popularityBands) {
      console.log(
        `  ${String(r.pop_band).padEnd(19)}| ${String(r.n).padStart(4)} | ${String(r.hits).padStart(4)} | ${String(r.hit_rate).padStart(4)}%| ${String(r.avg_odds).padStart(8)} | ${r.roi}`
      );
    }
  } else {
    console.log("  ※ selection_popularity未収集（2026ライブ以降から自動蓄積）");
    console.log("  → 将来: BUY候補の人気順位収集により本命/中穴のEdge分析が可能になる");
  }
  console.log("");

  // --- 6d. 新特徴量のデータカバレッジ ---
  let featureCov: Record<string, unknown> = { total: 0, sharp_n: 0, st_n: 0, pop_n: "-" };
  let liveFeatureCov: Record<string, unknown> = { total: 0, sharp_n: 0, st_n: 0, pop_n: "-" };
  try {
    featureCov = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sharp_signal_drop IS NOT NULL THEN 1 ELSE 0 END) AS sharp_n,
        SUM(CASE WHEN exhibition_st_residual_sum IS NOT NULL THEN 1 ELSE 0 END) AS st_n,
        SUM(CASE WHEN selection_popularity IS NOT NULL THEN 1 ELSE 0 END) AS pop_n
      FROM decision_history
      WHERE decision='BUY' AND result IS NOT NULL AND result!=''
        AND date > ? AND date <= ?
    `).get(TRAIN_END, TEST_END) as Record<string, unknown>;
    liveFeatureCov = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN sharp_signal_drop IS NOT NULL THEN 1 ELSE 0 END) AS sharp_n,
        SUM(CASE WHEN exhibition_st_residual_sum IS NOT NULL THEN 1 ELSE 0 END) AS st_n,
        SUM(CASE WHEN selection_popularity IS NOT NULL THEN 1 ELSE 0 END) AS pop_n
      FROM decision_history
      WHERE decision='BUY' AND date > ?
    `).get(TEST_END) as Record<string, unknown>;
  } catch {
    // selection_popularity カラム未追加（初回起動前）
  }

  console.log("【新特徴量カバレッジ】");
  console.log("  ※ 各特徴量がどれだけのレコードで取得できているか（0=未収集=テスト期間の検証値なし）");
  console.log(`  テストセット(n=${featureCov.total}):`);
  console.log(`    sharp_signal_drop:      ${featureCov.sharp_n}件`);
  console.log(`    exhibition_st_residual: ${featureCov.st_n}件`);
  console.log(`    selection_popularity:   ${featureCov.pop_n}件`);
  console.log(`  ライブ(n=${liveFeatureCov.total}):`);
  console.log(`    sharp_signal_drop:      ${liveFeatureCov.sharp_n}件`);
  console.log(`    exhibition_st_residual: ${liveFeatureCov.st_n}件`);
  console.log(`    selection_popularity:   ${liveFeatureCov.pop_n}件`);
  console.log("  → テストでカバレッジ=0の特徴量は有効性未検証。ライブ蓄積が先。");
  console.log("");

  // --- 7. 推奨アクション ---
  console.log("【推奨アクション】");
  if (testRow && testN > 0) {
    const testRoiVal = Number(testRow.roi);
    const evLow = evBands.find((r) => String(r.ev_band) === "ev<1.5");
    const evMid = evBands.find((r) => String(r.ev_band) === "ev 1.5-2.0");

    // EV<1.5帯だけ黒字の場合 → targetEv下げを推奨
    if (evLow && Number(evLow.roi) > 1.0 && evMid && Number(evMid.roi) < 1.0) {
      console.log("  [A] EV<1.5帯のみROI>1.0 → targetEv を 1.1〜1.2 に引き下げて採用レース数を増やすと改善余地あり");
    }

    // テストROI < 1.0 かつ odds<20 が黒字なら低オッズ特化を推奨
    const calLow = calibration.find((r) => String(r.odds_band) === "odds<20");
    if (testRoiVal < 1.0 && calLow && Number(calLow.roi) > 1.0) {
      console.log("  [B] odds<20帯がROI>1.0 → maxOdds=20 など低オッズ帯に絞ると安定性向上の可能性");
    }

    // trainとtestのROI差が大きい場合
    if (trainRow) {
      const gap2 = Math.abs(Number(trainRow.roi) - testRoiVal);
      if (gap2 >= 0.2) {
        console.log("  [C] train/test乖離が大きい → V4キャリブレーション係数を2025のみで再推定することを検討");
      }
    }

    // テストROI > 1.0 の場合
    if (testRoiVal > 1.0) {
      const p = Number(testRow.hits) / testN;
      const se = Math.sqrt(p * (1 - p) / testN);
      const avgOdds = Number(testRow.avg_odds);
      const roiLower2 = avgOdds * (p - 1.96 * se);
      if (roiLower2 > 1.0) {
        console.log("  [✅] テストセットで統計的優位なエッジ確認 → ライブn=300到達後に購入再検討");
      } else {
        console.log("  [D] ROI>1.0だがn不足 → ライブ観察継続、n=600目標で再評価");
      }
    } else {
      console.log("  [E] テストROI<1.0 → モデル・フィルター・キャリブレーションの再検討が先決");
    }
  }
  console.log("");
}

function roiBar(roi: number): string {
  // ASCII bar: 1.0を中央(|)として左が損失(░)、右が利益(▓)。幅10文字。
  const clamped = Math.min(Math.max(roi, 0), 2.0);
  const filled = Math.round(clamped * 5); // 0.0→0, 1.0→5, 2.0→10
  const loss = "░".repeat(Math.max(0, 5 - filled));
  const gain = "▓".repeat(Math.max(0, filled - 5));
  const bar = loss + "|" + gain;
  return `[${bar.padEnd(10)}]${roi >= 1.0 ? "✅" : ""}`;
}
