import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Runs ROI pattern search repeatedly with different guardrail thresholds.
 *
 * Safety:
 * - This script does not write DB/app_settings.
 * - It only runs search:roi-patterns, which opens SQLite readOnly/query_only.
 * - Outputs archived reports under reports/roi-search-matrix/.
 */

const OUT_DIR = "reports/roi-search-matrix";
const SOURCE_JSON = "reports/roi-pattern-search.json";
const SOURCE_MD = "reports/roi-pattern-search.md";
const SUMMARY_JSON = "reports/roi-search-matrix.json";
const SUMMARY_MD = "reports/roi-search-matrix.md";

type MatrixCase = {
  name: string;
  minRemoved: number;
  minRemaining: number;
};

type Candidate = {
  label: string;
  judgement: string;
  family?: string;
  removed?: { n?: number; roi?: number };
  remaining?: { n?: number; roi?: number; roiExMaxHit?: number };
  improvement?: number;
  trainRoi?: number;
  validationRoi?: number;
  testRoi?: number;
  warnings?: string[];
};

type SearchReport = {
  generatedAt: string;
  dbPath: string;
  baseline: { n: number; hits: number; roi: number; roiExMaxHit: number };
  counts: Record<string, number>;
  rankings: {
    stability?: Candidate[];
    improvement?: Candidate[];
    noBuyEffect?: Candidate[];
    risky?: Candidate[];
  };
};

type MatrixResult = {
  case: MatrixCase;
  baseline: SearchReport["baseline"];
  counts: Record<string, number>;
  topStability: Candidate[];
  topImprovement: Candidate[];
  risky: Candidate[];
  archivedJson: string;
  archivedMd: string;
};

const cases: MatrixCase[] = [
  { name: "strict_n1000", minRemoved: 100, minRemaining: 1000 },
  { name: "balanced_n500", minRemoved: 80, minRemaining: 500 },
  { name: "wide_n300", minRemoved: 40, minRemaining: 300 },
  { name: "stable_n1500", minRemoved: 150, minRemaining: 1500 },
  { name: "small_signal_n300", minRemoved: 50, minRemaining: 300 },
];

mkdirSync(OUT_DIR, { recursive: true });

const results: MatrixResult[] = [];
for (const [index, matrixCase] of cases.entries()) {
  console.log(`[run-roi-search-matrix] ${index + 1}/${cases.length} ${matrixCase.name}`);
  execFileSync("pnpm", ["search:roi-patterns"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ROI_SEARCH_MIN_REMOVED: String(matrixCase.minRemoved),
      ROI_SEARCH_MIN_REMAINING: String(matrixCase.minRemaining),
    },
  });

  if (!existsSync(SOURCE_JSON)) throw new Error(`${SOURCE_JSON} was not generated`);
  if (!existsSync(SOURCE_MD)) throw new Error(`${SOURCE_MD} was not generated`);

  const archivedJson = join(OUT_DIR, `${index + 1}-${matrixCase.name}.json`);
  const archivedMd = join(OUT_DIR, `${index + 1}-${matrixCase.name}.md`);
  copyFileSync(SOURCE_JSON, archivedJson);
  copyFileSync(SOURCE_MD, archivedMd);

  const report = JSON.parse(readFileSync(SOURCE_JSON, "utf8")) as SearchReport;
  results.push({
    case: matrixCase,
    baseline: report.baseline,
    counts: report.counts,
    topStability: (report.rankings.stability ?? []).slice(0, 10),
    topImprovement: (report.rankings.improvement ?? []).slice(0, 10),
    risky: (report.rankings.risky ?? []).slice(0, 10),
    archivedJson,
    archivedMd,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  safety: {
    writesDb: false,
    changesSettings: false,
    autoBetting: false,
    generatedReportsOnly: true,
  },
  cases,
  results,
  consensus: buildConsensus(results),
};

writeFileSync(SUMMARY_JSON, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(SUMMARY_MD, renderMarkdown(summary));
console.log(`[run-roi-search-matrix] wrote ${SUMMARY_JSON}`);
console.log(`[run-roi-search-matrix] wrote ${SUMMARY_MD}`);

function buildConsensus(matrixResults: MatrixResult[]) {
  const map = new Map<string, { label: string; count: number; sOrA: number; bestImprovement: number; worstWarnings: number; cases: string[] }>();
  for (const result of matrixResults) {
    for (const candidate of result.topStability) {
      const current = map.get(candidate.label) ?? {
        label: candidate.label,
        count: 0,
        sOrA: 0,
        bestImprovement: Number.NEGATIVE_INFINITY,
        worstWarnings: 0,
        cases: [],
      };
      current.count += 1;
      if (candidate.judgement === "S" || candidate.judgement === "A") current.sOrA += 1;
      current.bestImprovement = Math.max(current.bestImprovement, candidate.improvement ?? 0);
      current.worstWarnings = Math.max(current.worstWarnings, candidate.warnings?.length ?? 0);
      current.cases.push(result.case.name);
      map.set(candidate.label, current);
    }
  }
  return [...map.values()].sort((a, b) => b.sOrA - a.sOrA || b.count - a.count || b.bestImprovement - a.bestImprovement);
}

function renderMarkdown(summary: { generatedAt: string; cases: MatrixCase[]; results: MatrixResult[]; consensus: ReturnType<typeof buildConsensus> }) {
  return `# ROI Search Matrix

Generated: ${summary.generatedAt}

## Safety

- DB write: no
- app_settings change: no
- production decision logic change: no
- auto betting/login/site operation: no
- Output only: reports

## Matrix Cases

| case | minRemoved | minRemaining |
|---|---:|---:|
${summary.cases.map((x) => `| ${x.name} | ${x.minRemoved} | ${x.minRemaining} |`).join("\n")}

## Consensus Stability Candidates

${summary.consensus.length ? `| label | appeared | S/A count | best improvement | worst warning count | cases |\n|---|---:|---:|---:|---:|---|\n${summary.consensus.slice(0, 30).map((x) => `| ${md(x.label)} | ${x.count} | ${x.sOrA} | ${pct(x.bestImprovement)} | ${x.worstWarnings} | ${x.cases.join(", ")} |`).join("\n")}` : "No consensus candidates."}

## Per Case Top Stability

${summary.results.map((result) => `### ${result.case.name}\n\nBaseline ROI: ${pct(result.baseline.roi)} / n=${result.baseline.n}\n\n${candidateTable(result.topStability)}\n\nArchived: \`${result.archivedMd}\``).join("\n\n")}

## Per Case Risky / Do Not Ship

${summary.results.map((result) => `### ${result.case.name}\n\n${candidateTable(result.risky)}`).join("\n\n")}
`;
}

function candidateTable(items: Candidate[]) {
  if (!items.length) return "No candidates.\n";
  return `| judgement | label | removedN | removedROI | remainingN | remainingROI | improvement | test | warnings |\n|---|---|---:|---:|---:|---:|---:|---:|---|\n${items.map((x) => `| ${x.judgement} | ${md(x.label)} | ${x.removed?.n ?? 0} | ${pct(x.removed?.roi ?? 0)} | ${x.remaining?.n ?? 0} | ${pct(x.remaining?.roi ?? 0)} | ${pct(x.improvement ?? 0)} | ${pct(x.testRoi ?? 0)} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function md(value: string) {
  return value.replaceAll("|", "\\|");
}
