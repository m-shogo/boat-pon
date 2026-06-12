/**
 * check-point-in-time-safety.ts — 静的スキャン（読み取り専用）
 *
 * 許可リスト方式で、racer_profiles / racer_course_stats / live-only特徴量 の
 * 直接参照が許可されていないファイルに残っていないかを確認する。
 *
 * 違反: 上記以外のファイルで以下のパターンが見つかった場合
 *   - SQL: racer_profiles / racer_course_stats の JOIN/FROM（coverage以外の参照）
 *   - TS: courseAvgSt / courseTop3Rate / exhibitionStResidual の直接代入（値注入）
 *
 * 警告基準値 (WARNING_BASELINE):
 *   2026-06-13 時点の既知警告数。新規ファイルで超えたら exit 1。
 *   既知警告はすべて「ROI評価非使用の診断レポート」でレビュー済み。
 *   新規追加する場合は ALLOW_LIST に理由・リスク・レビュー日を記載した上で
 *   WARNING_BASELINE を更新すること。
 *
 * 終了コード:
 *   0 = クリーン（または既知警告のみ）
 *   1 = error あり、または警告が基準値超
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// ── 警告基準値 ─────────────────────────────────────────────────────────────────
// この値を変える場合は ALLOW_LIST に対応するエントリを追加し理由を記録すること
const WARNING_BASELINE = 15;

// ── パターン定義 ─────────────────────────────────────────────────────────────

const DANGER_PATTERNS: Array<{
  regex: RegExp;
  description: string;
  severity: "error" | "warning";
}> = [
  {
    // SQL JOIN / FROM で racer_profiles を直接使う（coverage/鮮度確認以外）
    regex: /JOIN\s+racer_profiles|FROM\s+racer_profiles/i,
    description: "racer_profiles への直接 SQL JOIN/FROM（現在値スナップショット）",
    severity: "warning",
  },
  {
    // SQL JOIN / FROM で racer_course_stats を直接使う
    regex: /JOIN\s+racer_course_stats|FROM\s+racer_course_stats/i,
    description: "racer_course_stats への直接 SQL JOIN/FROM（現在値スナップショット）",
    severity: "warning",
  },
  {
    // courseAvgSt に値を直接代入（型定義・TS型注釈を除く）
    regex: /courseAvgSt\s*:\s*(?!number|null(?:\s*[;,\}])|undefined|never|\?)(?!null\b)[^;,\n]/,
    description: "courseAvgSt への値代入（live-only特徴量注入の疑い）",
    severity: "error",
  },
  {
    // courseTop3Rate に値を直接代入（型定義除く）
    regex: /courseTop3Rate\s*:\s*(?!number|null(?:\s*[;,\}])|undefined|never|\?)(?!null\b)[^;,\n]/,
    description: "courseTop3Rate への値代入（live-only特徴量注入の疑い）",
    severity: "error",
  },
  {
    // exhibitionStResidual に stat?.avgSt を使って計算代入（liveの enrich 実装パターン）
    regex: /exhibitionStResidual\s*[=:]\s*stat[\?\.]avgSt/,
    description: "exhibitionStResidual への stat（racer_course_stats由来）を使った計算代入",
    severity: "error",
  },
];

// ── 許可リスト（メタデータ付き） ──────────────────────────────────────────────
//
// risk:
//   "none"      = live-only 特徴量を ProgramFeatureSnapshot に注入しない（完全安全）
//   "read-only" = JOIN しているが decision path に繋がらない診断専用（現在値スナップショット）
//   "gated"     = mode ガード付きで、historical path では注入しない
//
// notUsedForDecision:
//   true  = BUY判定・候補スコアリング・decision_history の生成には使わない
//   false = decision path に繋がる（要 mode ガード）
//
// lastReviewed: このエントリをレビューした日付（YYYY-MM-DD）

type AllowEntry = {
  pattern: RegExp;
  reason: string;
  risk: "none" | "read-only" | "gated";
  notUsedForDecision: boolean;
  lastReviewed: string;
};

const ALLOW_LIST: AllowEntry[] = [
  {
    pattern: /^server\/db\.ts$/,
    reason: "enrichFeatures の実装本体。mode='historical*' では live-only 特徴量を注入しない",
    risk: "gated",
    notUsedForDecision: false,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^src\/domain\/programFeatureSafety\.ts$/,
    reason: "LIVE_ONLY_FEATURE_KEYS などの safety utility。注入はしない",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^src\/domain\/programFeatures\.ts$/,
    reason: "型定義・補正係数の参照のみ。注入しない",
    risk: "none",
    notUsedForDecision: false,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/bulk-fetch-racer-stats\.ts$/,
    reason: "racer_profiles/racer_course_stats の取得スクリプト。DB書き込みのみ、decision評価なし",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/check-racer-stats-coverage\.ts$/,
    reason: "充足率チェック（集計のみ）。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/report-racer-data-freshness\.ts$/,
    reason: "鮮度確認レポート（fetched_at集計のみ）。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/report-racer-ability-audit\.ts$/,
    reason: "coverage / point-in-time 監査レポート。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/validate-data\.ts$/,
    reason: "DB健全性チェック（鮮度確認のみ）。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/report-daily\.ts$/,
    reason: "日次レポートの鮮度警告のみ。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/report-data-coverage\.ts$/,
    reason: "データ件数確認レポート。ROI評価なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/analyze-roi-candidates\.ts$/,
    reason: "ROI候補分析（診断専用: current snapshot diagnostic only）。enrichFeatures 未使用。ProgramFeatureSnapshot 注入なし",
    risk: "read-only",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^scripts\/check-point-in-time-safety\.ts$/,
    reason: "このスクリプト自体",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /\.test\.ts$/,
    reason: "テストファイル（live-only 特徴量の動作確認テスト）",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^docs\//,
    reason: "ドキュメント",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
  {
    pattern: /^reports\//,
    reason: "生成済みレポート",
    risk: "none",
    notUsedForDecision: true,
    lastReviewed: "2026-06-13",
  },
];

function isAllowed(relPath: string): boolean {
  return ALLOW_LIST.some((e) => e.pattern.test(relPath));
}

// ── ファイル収集 ──────────────────────────────────────────────────────────────

function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTs(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── スキャン実行 ─────────────────────────────────────────────────────────────

const files = collectTs(ROOT);
const findings: Array<{
  file: string;
  line: number;
  pattern: string;
  severity: "error" | "warning";
  text: string;
}> = [];

for (const abs of files) {
  const relPath = relative(ROOT, abs);
  if (isAllowed(relPath)) continue;
  const content = readFileSync(abs, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, description, severity } of DANGER_PATTERNS) {
      if (regex.test(line)) {
        findings.push({
          file: relPath,
          line: i + 1,
          pattern: description,
          severity,
          text: line.trim(),
        });
      }
    }
  }
}

// ── 結果表示 ─────────────────────────────────────────────────────────────────

const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
const warningCountExceeded = warnings.length > WARNING_BASELINE;

if (findings.length === 0) {
  console.log("[check-point-in-time-safety] ✅ clean — no unsafe racer snapshot injections found");
  process.exit(0);
}

if (warnings.length > 0) {
  const marker = warningCountExceeded ? "🚨" : "⚠️ ";
  console.log(`\n[check-point-in-time-safety] ${marker} WARNINGS (${warnings.length} / baseline=${WARNING_BASELINE}):`);
  for (const w of warnings) {
    console.log(`  ${w.file}:${w.line} — ${w.pattern}`);
    console.log(`    > ${w.text}`);
  }
  console.log("");
  if (warningCountExceeded) {
    console.log(`  ❌ 警告件数が基準値 (${WARNING_BASELINE}) を超えました (${warnings.length})。`);
    console.log("  新規ファイルで racer_profiles/racer_course_stats への直接 JOIN を追加した場合は:");
    console.log("  1. ALLOW_LIST に reason/risk/notUsedForDecision/lastReviewed を記載して追加");
    console.log("  2. WARNING_BASELINE を更新する");
  } else {
    console.log("  警告の意味: 許可リスト外のファイルで racer_profiles/racer_course_stats へ直接アクセスしている。");
    console.log("  診断用途（ROI評価なし）なら ALLOW_LIST にメタデータを記載して追加する。");
    console.log("  historical 検証に使うなら snapshot_date <= race_date を保証するスナップショット設計が必要。");
  }
}

if (errors.length > 0) {
  console.log(`\n[check-point-in-time-safety] ❌ ERRORS (${errors.length}):`);
  for (const e of errors) {
    console.log(`  ${e.file}:${e.line} — ${e.pattern}`);
    console.log(`    > ${e.text}`);
  }
  console.log("");
  console.log("  エラーの意味: live-only特徴量（courseAvgSt/courseTop3Rate/exhibitionStResidual）の直接注入が許可リスト外のファイルで見つかった。");
  console.log("  historical-backfill / historical-readonly では stripLiveOnlyRacerFeatures を使うか、server/db.ts の mode 対応 listProgramInputs* を使うこと。");
}

if (errors.length > 0 || warningCountExceeded) {
  process.exit(1);
}

// errors=0 かつ warnings <= baseline なら exit 0
process.exit(0);
