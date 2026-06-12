/**
 * check-point-in-time-safety.ts — 静的スキャン（読み取り専用）
 *
 * 許可リスト方式で、racer_profiles / racer_course_stats / live-only特徴量 の
 * 直接参照が許可されていないファイルに残っていないかを確認する。
 *
 * 許可リスト（安全な参照）:
 *   - server/db.ts の mode 付き enrichFeatures 実装
 *   - src/domain/programFeatureSafety.ts の safety utility
 *   - src/domain/programFeatures.ts の型定義・補正係数
 *   - scripts/bulk-fetch-racer-stats.ts の取得スクリプト
 *   - scripts/check-racer-stats-coverage.ts / report-racer-data-freshness.ts の鮮度確認
 *   - scripts/report-racer-ability-audit.ts の coverage 調査
 *   - scripts/validate-data.ts の DB健全性チェック（freshnessのみ、ROI評価なし）
 *   - scripts/report-daily.ts の鮮度警告（freshnessのみ）
 *   - server/db.ts の CRUD（upsert / select）
 *   - docs/ 配下
 *   - テストファイル（*.test.ts）
 *   - このスクリプト自体
 *
 * 違反: 上記以外のファイルで以下のパターンが見つかった場合
 *   - SQL: racer_profiles / racer_course_stats の JOIN/FROM（coverage以外の参照）
 *   - TS: courseAvgSt / courseTop3Rate / exhibitionStResidual の直接代入（値注入）
 *
 * 終了コード:
 *   0 = クリーン（または警告のみ）
 *   1 = 違反あり
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

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
    // 型定義（number | null; など）は除外してキャッシュへのオブジェクト注入を検出
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

// ── 許可リスト ────────────────────────────────────────────────────────────────

const ALLOW_LIST_PATTERNS: Array<RegExp> = [
  // server/db.ts: mode 付き enrichFeatures 実装
  /^server\/db\.ts$/,
  // src/domain/programFeatureSafety.ts: safety utility（LIVE_ONLY_FEATURE_KEYS など）
  /^src\/domain\/programFeatureSafety\.ts$/,
  // src/domain/programFeatures.ts: 型定義・補正係数（コメント参照のみで注入しない）
  /^src\/domain\/programFeatures\.ts$/,
  // 取得・鮮度確認スクリプト（ROI評価なし）
  /^scripts\/bulk-fetch-racer-stats\.ts$/,
  /^scripts\/check-racer-stats-coverage\.ts$/,
  /^scripts\/report-racer-data-freshness\.ts$/,
  /^scripts\/report-racer-ability-audit\.ts$/,
  // DB 健全性チェック（鮮度確認のみ）
  /^scripts\/validate-data\.ts$/,
  // 日次レポート（鮮度警告のみ）
  /^scripts\/report-daily\.ts$/,
  // data coverage レポート（件数確認のみ）
  /^scripts\/report-data-coverage\.ts$/,
  // ROI 候補分析（診断専用: current snapshot diagnostic only。enrichFeatures 未使用）
  /^scripts\/analyze-roi-candidates\.ts$/,
  // このスクリプト自体
  /^scripts\/check-point-in-time-safety\.ts$/,
  // テストファイル
  /\.test\.ts$/,
  // docs
  /^docs\//,
  // reports
  /^reports\//,
];

function isAllowed(relPath: string): boolean {
  return ALLOW_LIST_PATTERNS.some((p) => p.test(relPath));
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

if (findings.length === 0) {
  console.log("[check-point-in-time-safety] ✅ clean — no unsafe racer snapshot injections found");
  process.exit(0);
}

if (warnings.length > 0) {
  console.log(`\n[check-point-in-time-safety] ⚠️  WARNINGS (${warnings.length}):`);
  for (const w of warnings) {
    console.log(`  ${w.file}:${w.line} — ${w.pattern}`);
    console.log(`    > ${w.text}`);
  }
  console.log("");
  console.log("  警告の意味: 許可リスト外のファイルで racer_profiles/racer_course_stats へ直接アクセスしている。");
  console.log("  診断用途（ROI評価なし）なら docs に 'current snapshot diagnostic only' と明記し、このスクリプトの許可リストに追加する。");
  console.log("  historical 検証に使うなら snapshot_date <= race_date を保証するスナップショット設計が必要。");
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
  process.exit(1);
}

// warnings のみなら exit 0
process.exit(0);
