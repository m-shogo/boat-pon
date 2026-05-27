import { execFileSync } from "node:child_process";

type Finding = {
  level: "block" | "warn";
  path: string;
  reason: string;
};

const riskyPathRules: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^src\/domain\/decision(\.test)?\.ts$/, reason: "BUY/SKIP/WATCH判定ロジックに影響" },
  { pattern: /^src\/domain\/liveMonitor\.ts$/, reason: "live採用判断・モデルバージョンに影響" },
  { pattern: /^src\/domain\/livePersistence\.ts$/, reason: "live履歴保存条件に影響" },
  { pattern: /^src\/domain\/types\.ts$/, reason: "BudgetRule/候補型の変更により判定条件が増減する可能性" },
  { pattern: /^server\/db\.ts$/, reason: "DB設定・履歴保存に影響" },
  { pattern: /^server\/candidates\.ts$/, reason: "候補生成に影響" },
  { pattern: /^scripts\/generate-decision-history\.ts$/, reason: "decision_history再生成に影響" },
  { pattern: /^scripts\/auto-fetch-odds\.ts$/, reason: "live odds/decision_history保存に影響" },
];

const dataPathRules: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^data\//, reason: "data/ はDB・raw・ログを含むためコミット禁止" },
  { pattern: /^\.env/, reason: "環境変数・秘密情報の可能性" },
];

const riskyDiffPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bDEFAULT_APP_RULE\b/, reason: "現行live設定プリセット変更" },
  { pattern: /\bPAPER_LIVE_VALIDATION_RULE\b/, reason: "live検証プリセット追加/変更" },
  { pattern: /\bjudgeCandidate\b/, reason: "判定関数変更" },
  { pattern: /\bapp_settings\b/, reason: "DB live設定変更" },
  { pattern: /\/api\/settings\b/, reason: "settings API validationに影響" },
  { pattern: /\bupdateSettings\b|\bsetSettings\b/, reason: "設定保存処理変更" },
  { pattern: /\btargetEv\b|\bminSampleSize\b|\bmaxOdds\b|\bmaxOddsRatio\b|\bminOddsRatio\b/, reason: "判定パラメータ変更" },
  { pattern: /\bminRequiredOdds\b|\bmaxRequiredOdds\b|\bmarketBlendWeight\b|\bcalibrationMode\b|\bcalibrationBasis\b/, reason: "判定パラメータ変更" },
  { pattern: /\bexcludedVenues\b|\bexcludedRaceNos\b|\bclassOddsRatioRules\b|\bprogramFilter\b/, reason: "フィルター変更" },
  { pattern: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+decision_history\b/i, reason: "判定履歴の書き込みに影響" },
  { pattern: /\binsertDecisionHistory\b|\bgenerate-decision-history\b|\breplaceRace\b/, reason: "判定履歴の書き込みに影響" },
];

const changedFiles = unique([
  ...gitLines(["diff", "--name-only"]),
  ...gitLines(["diff", "--cached", "--name-only"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
]);

const findings: Finding[] = [];

for (const path of changedFiles) {
  for (const rule of dataPathRules) {
    if (rule.pattern.test(path)) {
      findings.push({ level: "block", path, reason: rule.reason });
    }
  }
  for (const rule of riskyPathRules) {
    if (rule.pattern.test(path)) {
      findings.push({ level: "block", path, reason: rule.reason });
    }
  }
}

const diffInspectedFiles = changedFiles.filter(
  (path) => !path.startsWith("data/") && path !== "scripts/live-change-guard.ts",
);
const diffText = [
  gitText(["diff", "--unified=0", "--", ...diffInspectedFiles]),
  gitText(["diff", "--cached", "--unified=0", "--", ...diffInspectedFiles]),
].join("\n");

for (const rule of riskyDiffPatterns) {
  if (rule.pattern.test(diffText)) {
    findings.push({ level: "block", path: "(diff)", reason: rule.reason });
  }
}

printReport(findings);

if (findings.some((finding) => finding.level === "block")) {
  process.exitCode = 1;
}

function printReport(rows: Finding[]) {
  console.log("=== Boat Pon live change guard ===");
  console.log(`changed_files: ${changedFiles.length}`);
  if (changedFiles.length > 0) {
    for (const path of changedFiles) console.log(`  - ${path}`);
  }
  console.log("");

  if (rows.length === 0) {
    console.log("ok: live判定・設定・data混入に関する危険差分は検出されませんでした。");
    return;
  }

  console.log("block: live観察フェーズでは確認が必要な差分があります。");
  for (const row of dedupeFindings(rows)) {
    console.log(`  ${row.level}\t${row.path}\t${row.reason}`);
  }
  console.log("");
  console.log("対応:");
  console.log("  1. live判定/設定変更として意図した差分か確認する");
  console.log("  2. 現行v3 paper live観察に影響するなら今はコミットしない");
  console.log("  3. 採用する場合は docs/settings-change-gate.md の手順とユーザー承認を先に通す");
  console.log("  4. data/・DB・ログはコミットしない");
}

function gitLines(args: string[]) {
  return gitText(args).split("\n").map((line) => line.trim()).filter(Boolean);
}

function gitText(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function dedupeFindings(rows: Finding[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.level}\t${row.path}\t${row.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
