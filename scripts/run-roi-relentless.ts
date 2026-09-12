import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_DIR = "reports/roi-relentless";
const OUT_JSON = "reports/roi-relentless.json";
const OUT_MD = "reports/roi-relentless.md";
const PRO_LOOP_JSON = "reports/roi-pro-loop.json";
const ALL_FEATURE_JSON = "reports/roi-all-feature-search.json";

type Consensus = {
  label: string;
  count?: number;
  sOrA?: number;
  personas?: string[] | number;
  bestRoi?: number;
  bestImprovement?: number;
  maxRemainingN?: number;
  warnings?: string[];
};

type ProLoopReport = {
  finalDecision?: string;
  consensus?: Consensus[];
  personaConsensus?: Consensus[];
};

type AllFeatureReport = {
  baseline?: { n?: number; roi?: number; roiExMaxHit?: number };
  rankings?: { stability?: Array<Record<string, unknown>>; improvement?: Array<Record<string, unknown>>; risky?: Array<Record<string, unknown>> };
};

const passes = [
  { name: "baseline-wide", minN: 40, minRemaining: 300, maxRules: 7000 },
  { name: "baseline-balanced", minN: 70, minRemaining: 500, maxRules: 7000 },
  { name: "baseline-strict", minN: 120, minRemaining: 1000, maxRules: 7000 },
  { name: "large-n", minN: 200, minRemaining: 1500, maxRules: 9000 },
  { name: "small-signal", minN: 50, minRemaining: 300, maxRules: 12000 },
  { name: "very-wide", minN: 30, minRemaining: 250, maxRules: 12000 },
  { name: "very-strict", minN: 300, minRemaining: 2000, maxRules: 12000 },
];

mkdirSync(OUT_DIR, { recursive: true });
const runs = [];
let finalDecision = "NO-GO";

for (const [index, pass] of passes.entries()) {
  console.log(`[roi-relentless] pass ${index + 1}/${passes.length}: ${pass.name}`);
  execFileSync("pnpm", ["tsx", "scripts/run-roi-pro-loop.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ROI_ALL_MIN_N: String(pass.minN),
      ROI_ALL_MIN_REMAINING: String(pass.minRemaining),
      ROI_ALL_MAX_RULES: String(pass.maxRules),
    },
  });

  const proLoop = readOptional<ProLoopReport>(PRO_LOOP_JSON);
  const allFeature = readOptional<AllFeatureReport>(ALL_FEATURE_JSON);
  const archivedPro = join(OUT_DIR, `${index + 1}-${pass.name}-pro-loop.json`);
  const archivedAll = join(OUT_DIR, `${index + 1}-${pass.name}-all-feature.json`);
  if (existsSync(PRO_LOOP_JSON)) {
    archiveVerifiedSource(
      PRO_LOOP_JSON,
      archivedPro,
      "ROI_RELENTLESS_PRO_LOOP_ARCHIVE_SOURCE_IDENTITY_INVALID",
      "ROI_RELENTLESS_PRO_LOOP_ARCHIVE_TEMP_IDENTITY_INVALID",
      "ROI_RELENTLESS_PRO_LOOP_ARCHIVE_DESTINATION_IDENTITY_INVALID",
    );
  }
  if (existsSync(ALL_FEATURE_JSON)) {
    archiveVerifiedSource(
      ALL_FEATURE_JSON,
      archivedAll,
      "ROI_RELENTLESS_ALL_FEATURE_ARCHIVE_SOURCE_IDENTITY_INVALID",
      "ROI_RELENTLESS_ALL_FEATURE_ARCHIVE_TEMP_IDENTITY_INVALID",
      "ROI_RELENTLESS_ALL_FEATURE_ARCHIVE_DESTINATION_IDENTITY_INVALID",
    );
  }

  const strong = isStrong(proLoop);
  const paper = isPaper(proLoop, allFeature);
  runs.push({
    pass,
    decision: proLoop?.finalDecision ?? "unknown",
    strong,
    paper,
    baseline: allFeature?.baseline ?? null,
    topConsensus: (proLoop?.consensus ?? []).slice(0, 15),
    topPersonaConsensus: (proLoop?.personaConsensus ?? []).slice(0, 15),
    archivedPro,
    archivedAll,
  });

  if (strong) {
    finalDecision = "PAPER-STRONG";
    console.log(`[roi-relentless] strong candidate found at ${pass.name}`);
    break;
  }
  if (paper) finalDecision = "PAPER";
}

const globalConsensus = mergeConsensus(runs.flatMap((r) => [...r.topConsensus, ...r.topPersonaConsensus]));
const report = {
  generatedAt: new Date().toISOString(),
  finalDecision,
  exhausted: finalDecision !== "PAPER-STRONG",
  passesTried: runs.length,
  runs,
  globalConsensus,
  nextActions: nextActions(finalDecision),
};

atomicPublish(
  OUT_JSON,
  `${JSON.stringify(report, null, 2)}\n`,
  "ROI_RELENTLESS_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
  "ROI_RELENTLESS_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
);
atomicPublish(
  OUT_MD,
  renderMd(report),
  "ROI_RELENTLESS_MD_PUBLISH_TEMP_IDENTITY_INVALID",
  "ROI_RELENTLESS_MD_PUBLISH_DESTINATION_IDENTITY_INVALID",
);
console.log(`[roi-relentless] finalDecision=${finalDecision}`);
console.log(`[roi-relentless] wrote ${OUT_MD}`);
console.log(`[roi-relentless] wrote ${OUT_JSON}`);

function isStrong(report: ProLoopReport | null) {
  if (!report) return false;
  if (report.finalDecision === "PAPER-STRONG") return true;
  return [...(report.consensus ?? []), ...(report.personaConsensus ?? [])].some((x) =>
    Number(x.count ?? 0) >= 3 &&
    Number(x.bestImprovement ?? 0) >= 0.03 &&
    Number(x.maxRemainingN ?? 0) >= 1000 &&
    (x.warnings ?? []).length <= 2,
  );
}

function isPaper(report: ProLoopReport | null, allFeature: AllFeatureReport | null) {
  if (report?.finalDecision === "PAPER" || report?.finalDecision === "PAPER-STRONG") return true;
  if ((report?.consensus ?? []).length > 0 || (report?.personaConsensus ?? []).length > 0) return true;
  return (allFeature?.rankings?.stability ?? []).length > 0;
}

function mergeConsensus(items: Consensus[]) {
  const map = new Map<string, { label: string; count: number; bestRoi: number; bestImprovement: number; maxRemainingN: number; warnings: string[] }>();
  for (const item of items) {
    const current = map.get(item.label) ?? { label: item.label, count: 0, bestRoi: 0, bestImprovement: 0, maxRemainingN: 0, warnings: [] };
    current.count += Number(item.count ?? 1);
    current.bestRoi = Math.max(current.bestRoi, Number(item.bestRoi ?? 0));
    current.bestImprovement = Math.max(current.bestImprovement, Number(item.bestImprovement ?? 0));
    current.maxRemainingN = Math.max(current.maxRemainingN, Number(item.maxRemainingN ?? 0));
    current.warnings = [...new Set([...current.warnings, ...(item.warnings ?? [])])];
    map.set(item.label, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.bestImprovement - a.bestImprovement || b.maxRemainingN - a.maxRemainingN).slice(0, 50);
}

function nextActions(decision: string) {
  if (decision === "PAPER-STRONG") {
    return [
      "強候補をpaper検証に固定する",
      "同じ条件でdecision再生成A/Bを作る",
      "liveにはNO BUY警告としてだけ表示する",
      "app_settings変更はpaper検証後まで行わない",
    ];
  }
  if (decision === "PAPER") {
    return [
      "候補は出たが本番反映はまだしない",
      "最大1hit依存・test悪化・n不足の候補を除外する",
      "再生成A/Bで保存済みdecision依存を外す",
    ];
  }
  return [
    "現DBからは安定候補なし",
    "app_settingsは変えない",
    "特徴量追加より再生成A/B基盤を優先する",
  ];
}

function renderMd(report: { generatedAt: string; finalDecision: string; exhausted: boolean; passesTried: number; runs: Array<Record<string, unknown>>; globalConsensus: ReturnType<typeof mergeConsensus>; nextActions: string[] }) {
  return `# ROI Relentless Exploration\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\n- passes tried: ${report.passesTried}\n- exhausted search plan: ${report.exhausted ? "yes" : "no"}\n\n## Global Consensus\n\n${consensusTable(report.globalConsensus)}\n\n## Runs\n\n${report.runs.map((r) => `### ${(r.pass as { name: string }).name}\n\n- decision: ${String(r.decision)}\n- strong: ${String(r.strong)}\n- paper: ${String(r.paper)}\n- baseline ROI: ${pct(Number((r.baseline as { roi?: number } | null)?.roi ?? 0))}\n`).join("\n")}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function consensusTable(items: ReturnType<typeof mergeConsensus>) {
  if (!items.length) return "None\n";
  return `| label | count | remainingN | bestROI | bestImprovement | warnings |\n|---|---:|---:|---:|---:|---|\n${items.map((x) => `| ${md(x.label)} | ${x.count} | ${x.maxRemainingN} | ${pct(x.bestRoi)} | ${pct(x.bestImprovement)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}`;
}

function readOptional<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  const verifiedPath = assertCanonicalSingleLinkRegularFile(path, "ROI_RELENTLESS_INPUT_IDENTITY_INVALID");
  return JSON.parse(readFileSync(verifiedPath, "utf8")) as T;
}

function archiveVerifiedSource(
  sourcePath: string,
  destinationPath: string,
  sourceErrorCode: string,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const verifiedSourcePath = assertCanonicalSingleLinkRegularFile(sourcePath, sourceErrorCode);
  atomicPublish(destinationPath, readFileSync(verifiedSourcePath), tempErrorCode, destinationErrorCode);
}

function atomicPublish(
  path: string,
  contents: string | Buffer,
  tempErrorCode: string,
  destinationErrorCode: string,
): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
