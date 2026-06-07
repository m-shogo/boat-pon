import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT_MD = "reports/roi-full-review.md";
const OUT_JSON = "reports/roi-full-review.json";

type Metric = { n?: number; hits?: number; roi?: number; roiExMaxHit?: number };
type EvalLike = {
  label?: string;
  judgement?: string;
  removed?: Metric;
  remaining?: Metric;
  improvement?: number;
  trainRoi?: number;
  validationRoi?: number;
  testRoi?: number;
  warnings?: string[];
};
type GenericReport = {
  baseline?: Metric;
  counts?: Record<string, number>;
  rankings?: Record<string, EvalLike[]>;
  decision?: string;
  stableConsensus?: EvalLike[];
  paperConsensus?: EvalLike[];
  riskyLabels?: string[];
};

const commands: Array<[string, string[]]> = [
  ["pnpm", ["typecheck:scripts"]],
  ["pnpm", ["tsx", "scripts/search-roi-all-features-lite.ts"]],
  ["pnpm", ["tsx", "scripts/run-roi-autopilot.ts"]],
];

const executed: Array<{ command: string; ok: boolean; error?: string }> = [];
for (const [bin, args] of commands) {
  const text = `${bin} ${args.join(" ")}`;
  console.log(`[roi-full-review] ${text}`);
  try {
    execFileSync(bin, args, { stdio: "inherit" });
    executed.push({ command: text, ok: true });
  } catch (error) {
    executed.push({ command: text, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const allFeature = readOptional<GenericReport>("reports/roi-all-feature-search.json");
const autopilot = readOptional<GenericReport>("reports/roi-autopilot-decision.json");
const matrix = readOptional<GenericReport>("reports/roi-search-matrix.json");

const baseline = allFeature?.baseline ?? autopilot?.baseline ?? matrix?.baseline ?? {};
const allFeatureStable = allFeature?.rankings?.stability ?? [];
const allFeatureRisky = allFeature?.rankings?.risky ?? [];
const autoStable = autopilot?.stableConsensus ?? [];
const autoPaper = autopilot?.paperConsensus ?? [];

const finalDecision = decide(autopilot?.decision, allFeatureStable, autoStable, autoPaper);
const reasons = buildReasons(finalDecision, baseline, allFeatureStable, autoStable, autoPaper, allFeatureRisky);

const report = {
  generatedAt: new Date().toISOString(),
  safety: {
    writesDb: false,
    changesSettings: false,
    changesProductionDecisionLogic: false,
    reportsOnly: true,
  },
  executed,
  baseline,
  finalDecision,
  reasons,
  allFeatureCounts: allFeature?.counts ?? {},
  allFeatureStable: allFeatureStable.slice(0, 30),
  allFeatureRisky: allFeatureRisky.slice(0, 30),
  autopilotDecision: autopilot?.decision ?? null,
  autoStable: autoStable.slice(0, 30),
  autoPaper: autoPaper.slice(0, 30),
  nextActions: nextActions(finalDecision),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMd(report));
console.log(`[roi-full-review] finalDecision=${finalDecision}`);
console.log(`[roi-full-review] wrote ${OUT_MD}`);
console.log(`[roi-full-review] wrote ${OUT_JSON}`);

function decide(autoDecision: string | undefined, allFeatureStable: EvalLike[], autoStable: EvalLike[], autoPaper: EvalLike[]) {
  const strongAllFeature = allFeatureStable.filter((x) =>
    (x.judgement === "S" || x.judgement === "A") &&
    Number(x.remaining?.n ?? 0) >= 1000 &&
    Number(x.improvement ?? 0) >= 0.03 &&
    Number(x.remaining?.roiExMaxHit ?? 0) > 0,
  );
  if (autoDecision === "GO" && strongAllFeature.length > 0) return "GO";
  if (autoDecision === "PAPER" || autoStable.length > 0 || autoPaper.length > 0 || allFeatureStable.length > 0) return "PAPER";
  return "NO-GO";
}

function buildReasons(decision: string, baseline: Metric, allFeatureStable: EvalLike[], autoStable: EvalLike[], autoPaper: EvalLike[], allFeatureRisky: EvalLike[]) {
  const lines = [`baseline ROI=${pct(Number(baseline.roi ?? 0))}, n=${baseline.n ?? "unknown"}`];
  if (decision === "GO") {
    lines.push("autopilotとall-feature探索の両方で強い候補が残った");
    lines.push("ただし即設定反映ではなくpaper運用から始める");
  } else if (decision === "PAPER") {
    lines.push(`paper候補あり: autopilotStable=${autoStable.length}, autopilotPaper=${autoPaper.length}, allFeatureStable=${allFeatureStable.length}`);
    lines.push("本番反映にはまだ早く、再生成A/Bかpaper検証が必要");
  } else {
    lines.push("安定候補なし");
    lines.push(`危険候補/過学習候補=${allFeatureRisky.length}`);
  }
  return lines;
}

function nextActions(decision: string) {
  if (decision === "GO") {
    return [
      "GO候補をNO BUY警告としてpaper運用する",
      "同条件でdecision再生成A/Bを行う",
      "app_settings反映はpaper結果後に限定的に行う",
    ];
  }
  if (decision === "PAPER") {
    return [
      "上位候補だけpaper検証ログに落とす",
      "venue/national motor参照先のズレを修正確認する",
      "全件ロード箇所を範囲ロードに直す",
      "app_settingsはまだ変えない",
    ];
  }
  return [
    "app_settingsは変えない",
    "保存済みdecision依存をやめるため再生成A/B基盤を作る",
    "弱いBUY理由の記録を増やす",
  ];
}

function renderMd(report: {
  generatedAt: string;
  finalDecision: string;
  reasons: string[];
  executed: Array<{ command: string; ok: boolean; error?: string }>;
  baseline: Metric;
  allFeatureCounts: Record<string, number>;
  allFeatureStable: EvalLike[];
  allFeatureRisky: EvalLike[];
  autopilotDecision: string | null;
  autoStable: EvalLike[];
  autoPaper: EvalLike[];
  nextActions: string[];
}) {
  return `# ROI Full Review\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\n${report.reasons.map((x) => `- ${x}`).join("\n")}\n\n## Executed\n\n| command | result |\n|---|---|\n${report.executed.map((x) => `| \`${x.command}\` | ${x.ok ? "OK" : `NG: ${md(x.error ?? "error")}`} |`).join("\n")}\n\n## Baseline\n\n| n | hits | ROI | ROI ex max hit |\n|---:|---:|---:|---:|\n| ${report.baseline.n ?? "unknown"} | ${report.baseline.hits ?? "unknown"} | ${pct(Number(report.baseline.roi ?? 0))} | ${pct(Number(report.baseline.roiExMaxHit ?? 0))} |\n\n## All Feature Counts\n\n${Object.entries(report.allFeatureCounts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## All Feature Stable\n\n${table(report.allFeatureStable)}\n\n## Autopilot Stable\n\n${table(report.autoStable)}\n\n## Autopilot Paper\n\n${table(report.autoPaper)}\n\n## Risky / Do Not Ship\n\n${table(report.allFeatureRisky)}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function table(items: EvalLike[]) {
  if (!items.length) return "None\n";
  return `| judgement | label | removedN | removedROI | remainingN | remainingROI | improvement | train | validation | test | warnings |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${x.judgement ?? "-"} | ${md(x.label ?? "-")} | ${x.removed?.n ?? 0} | ${pct(Number(x.removed?.roi ?? 0))} | ${x.remaining?.n ?? 0} | ${pct(Number(x.remaining?.roi ?? 0))} | ${pct(Number(x.improvement ?? 0))} | ${pct(Number(x.trainRoi ?? 0))} | ${pct(Number(x.validationRoi ?? 0))} | ${pct(Number(x.testRoi ?? 0))} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function readOptional<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
