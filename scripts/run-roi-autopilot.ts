import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * End-to-end ROI review autopilot.
 *
 * This script intentionally keeps running through all available read-only ROI analyses
 * and writes a final GO / PAPER / NO-GO decision report.
 *
 * Safety:
 * - does not write DB
 * - does not change app_settings
 * - does not touch production decision logic
 * - does not perform betting/login/site operations
 */

const OUT_JSON = "reports/roi-autopilot-decision.json";
const OUT_MD = "reports/roi-autopilot-decision.md";

type Metric = {
  n?: number;
  hits?: number;
  roi?: number;
  roiExMaxHit?: number;
  hitRate?: number;
};

type Candidate = {
  label: string;
  judgement?: string;
  count?: number;
  sOrA?: number;
  bestImprovement?: number;
  worstWarnings?: number;
  cases?: string[];
  removed?: Metric;
  remaining?: Metric;
  improvement?: number;
  trainRoi?: number;
  validationRoi?: number;
  testRoi?: number;
  warnings?: string[];
};

type MatrixReport = {
  generatedAt: string;
  results: Array<{
    case: { name: string; minRemoved: number; minRemaining: number };
    baseline: Metric;
    topStability: Candidate[];
    topImprovement: Candidate[];
    risky: Candidate[];
  }>;
  consensus: Candidate[];
};

type HypothesisReport = {
  baseline?: Metric;
  results?: Array<{
    name: string;
    intent?: string;
    removed?: Metric;
    remaining?: Metric;
    improvement?: number;
    judgement?: string;
    warnings?: string[];
  }>;
};

type CommitReview = {
  overall?: Metric;
  finalJudgement?: unknown;
  reportedRoi?: Record<string, number>;
};

type Decision = "GO" | "PAPER" | "NO-GO";

const commands = [
  ["pnpm", ["typecheck:scripts"]],
  ["pnpm", ["analyze:roi-commit"]],
  ["pnpm", ["analyze:bet-strategies"]],
  ["pnpm", ["analyze:roi-hypotheses"]],
  ["pnpm", ["search:roi-matrix"]],
] as const;

const executed: Array<{ command: string; ok: boolean; error?: string }> = [];
for (const [bin, args] of commands) {
  const commandText = `${bin} ${args.join(" ")}`;
  console.log(`[roi-autopilot] ${commandText}`);
  try {
    execFileSync(bin, args, { stdio: "inherit" });
    executed.push({ command: commandText, ok: true });
  } catch (error) {
    executed.push({ command: commandText, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const matrix = readJson<MatrixReport>("reports/roi-search-matrix.json");
const hypotheses = readOptionalJson<HypothesisReport>("reports/roi-hypothesis-sets.json");
const commitReview = readOptionalJson<CommitReview>("reports/roi-commit-review.json");

const baseline = matrix.results[0]?.baseline ?? hypotheses?.baseline ?? commitReview?.overall ?? {};
const consensus = matrix.consensus ?? [];
const topConsensus = consensus[0];
const stableConsensus = consensus.filter((x) => isStableConsensus(x));
const paperConsensus = consensus.filter((x) => isPaperConsensus(x));
const riskyLabels = collectRiskyLabels(matrix);
const hypothesisTop = [...(hypotheses?.results ?? [])]
  .sort((a, b) => Number(b.remaining?.roi ?? 0) - Number(a.remaining?.roi ?? 0))
  .slice(0, 10);

const decision = decide(stableConsensus, paperConsensus, riskyLabels, baseline);
const reasons = buildReasons(decision, stableConsensus, paperConsensus, riskyLabels, baseline);
const nextActions = buildNextActions(decision);

const report = {
  generatedAt: new Date().toISOString(),
  safety: {
    writesDb: false,
    changesSettings: false,
    changesProductionDecisionLogic: false,
    autoBetting: false,
  },
  executed,
  baseline,
  decision,
  reasons,
  topConsensus,
  stableConsensus: stableConsensus.slice(0, 20),
  paperConsensus: paperConsensus.slice(0, 20),
  riskyLabels: riskyLabels.slice(0, 30),
  hypothesisTop,
  nextActions,
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMarkdown(report));
console.log(`[roi-autopilot] decision=${decision}`);
console.log(`[roi-autopilot] wrote ${OUT_JSON}`);
console.log(`[roi-autopilot] wrote ${OUT_MD}`);

function decide(stable: Candidate[], paper: Candidate[], risky: string[], base: Metric): Decision {
  const baselineRoi = Number(base.roi ?? 0);
  const best = stable[0];
  if (
    best &&
    Number(best.sOrA ?? 0) >= 3 &&
    Number(best.count ?? 0) >= 3 &&
    Number(best.bestImprovement ?? 0) >= 0.03 &&
    Number(best.worstWarnings ?? 99) <= 1 &&
    !risky.includes(best.label) &&
    baselineRoi > 0
  ) {
    return "GO";
  }
  if (paper.length > 0 || stable.length > 0) return "PAPER";
  return "NO-GO";
}

function isStableConsensus(candidate: Candidate) {
  return (
    Number(candidate.sOrA ?? 0) >= 3 &&
    Number(candidate.count ?? 0) >= 3 &&
    Number(candidate.bestImprovement ?? 0) >= 0.02 &&
    Number(candidate.worstWarnings ?? 99) <= 2
  );
}

function isPaperConsensus(candidate: Candidate) {
  return (
    Number(candidate.sOrA ?? 0) >= 1 &&
    Number(candidate.count ?? 0) >= 2 &&
    Number(candidate.bestImprovement ?? 0) > 0
  );
}

function collectRiskyLabels(matrixReport: MatrixReport) {
  const labels = new Set<string>();
  for (const result of matrixReport.results) {
    for (const candidate of result.risky ?? []) {
      labels.add(candidate.label);
    }
  }
  return [...labels];
}

function buildReasons(decision: Decision, stable: Candidate[], paper: Candidate[], risky: string[], base: Metric) {
  const baseText = `baseline ROI=${pct(Number(base.roi ?? 0))}, n=${base.n ?? "unknown"}`;
  if (decision === "GO") {
    return [
      `GO条件を満たす安定候補あり: ${stable[0]?.label}`,
      baseText,
      "複数matrix caseでS/A候補として再出現",
      "warning数が少なく、ROI改善が複数閾値で残った",
    ];
  }
  if (decision === "PAPER") {
    return [
      "本番反映にはまだ弱いが、paper検証候補はある",
      baseText,
      `stable候補=${stable.length}, paper候補=${paper.length}, risky候補=${risky.length}`,
      "app_settings変更前に、paper検証または再生成A/Bが必要",
    ];
  }
  return [
    "安定候補なし",
    baseText,
    "ROI改善がn不足・高配当依存・test悪化・過学習疑いで落ちた",
    "本番反映候補なし",
  ];
}

function buildNextActions(decision: Decision) {
  if (decision === "GO") {
    return [
      "GO候補をapp_settingsに直接入れず、まずpaper modeで1〜2週間検証する",
      "同じ条件でdecision再生成A/Bを実施する",
      "live判断には購入指示ではなくNO BUY警告として出す",
    ];
  }
  if (decision === "PAPER") {
    return [
      "paperConsensus上位だけを対象にpaper検証ログを作る",
      "maxMotorTop2Rateのvenue/national参照先を修正・明文化する",
      "loadMotorBoatStatsMapの全件ロードを対象race_id/date範囲ロードに直す",
      "app_settings変更はまだしない",
    ];
  }
  return [
    "app_settings変更はしない",
    "特徴量追加より、現行BUYの弱い理由DBを増やす",
    "再生成A/B基盤を作り、保存済みdecision依存の限界を外す",
  ];
}

function renderMarkdown(report: {
  generatedAt: string;
  baseline: Metric;
  decision: Decision;
  reasons: string[];
  topConsensus?: Candidate;
  stableConsensus: Candidate[];
  paperConsensus: Candidate[];
  riskyLabels: string[];
  hypothesisTop: Array<{ name: string; intent?: string; removed?: Metric; remaining?: Metric; improvement?: number; warnings?: string[] }>;
  nextActions: string[];
  executed: Array<{ command: string; ok: boolean; error?: string }>;
}) {
  return `# ROI Autopilot Decision

Generated: ${report.generatedAt}

## Final Decision: ${report.decision}

${report.reasons.map((x) => `- ${x}`).join("\n")}

## Safety

- DB write: no
- app_settings change: no
- production decision logic change: no
- auto betting/login/site operation: no

## Executed Commands

| command | result |
|---|---|
${report.executed.map((x) => `| \`${x.command}\` | ${x.ok ? "OK" : `NG: ${md(x.error ?? "error")}`} |`).join("\n")}

## Baseline

| n | hits | ROI | ROI ex max hit |
|---:|---:|---:|---:|
| ${report.baseline.n ?? "unknown"} | ${report.baseline.hits ?? "unknown"} | ${pct(Number(report.baseline.roi ?? 0))} | ${pct(Number(report.baseline.roiExMaxHit ?? 0))} |

## Stable Consensus

${consensusTable(report.stableConsensus)}

## Paper Consensus

${consensusTable(report.paperConsensus)}

## Hypothesis Top

${hypothesisTable(report.hypothesisTop)}

## Risky Labels / Do Not Ship

${report.riskyLabels.length ? report.riskyLabels.slice(0, 50).map((x) => `- ${md(x)}`).join("\n") : "None"}

## Next Actions

${report.nextActions.map((x) => `- ${x}`).join("\n")}
`;
}

function consensusTable(items: Candidate[]) {
  if (!items.length) return "None\n";
  return `| label | appeared | S/A | best improvement | worst warnings | cases |\n|---|---:|---:|---:|---:|---|\n${items.map((x) => `| ${md(x.label)} | ${x.count ?? 0} | ${x.sOrA ?? 0} | ${pct(Number(x.bestImprovement ?? 0))} | ${x.worstWarnings ?? 0} | ${(x.cases ?? []).map(md).join(", ")} |`).join("\n")}`;
}

function hypothesisTable(items: Array<{ name: string; intent?: string; removed?: Metric; remaining?: Metric; improvement?: number; warnings?: string[] }>) {
  if (!items.length) return "None\n";
  return `| name | removed n | removed ROI | remaining n | remaining ROI | improvement | warnings |\n|---|---:|---:|---:|---:|---:|---|\n${items.map((x) => `| ${md(x.name)} | ${x.removed?.n ?? 0} | ${pct(Number(x.removed?.roi ?? 0))} | ${x.remaining?.n ?? 0} | ${pct(Number(x.remaining?.roi ?? 0))} | ${pct(Number(x.improvement ?? 0))} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptionalJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function md(value: string) {
  return value.replaceAll("|", "\\|");
}
