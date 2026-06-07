import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const OUT_DIR = "reports/roi-pro-loop";
const OUT_JSON = "reports/roi-pro-loop.json";
const OUT_MD = "reports/roi-pro-loop.md";
const ALL_JSON = "reports/roi-all-feature-search.json";
const PERSONA_JSON = "reports/roi-pro-persona-review.json";

type Candidate = {
  label: string;
  feature?: string;
  judgement?: string;
  removed?: { n?: number; roi?: number };
  remaining?: { n?: number; roi?: number; roiExMaxHit?: number };
  improvement?: number;
  trainRoi?: number;
  validationRoi?: number;
  testRoi?: number;
  warnings?: string[];
};

type AllReport = {
  baseline?: { n?: number; roi?: number; roiExMaxHit?: number };
  rankings?: Record<string, Candidate[]>;
  counts?: Record<string, number>;
};

type PersonaReport = {
  finalDecision?: string;
  consensus?: Array<{ label: string; personas?: number; bestImprovement?: number; remainingN?: number; bestRoi?: number; warnings?: string[] }>;
};

const cases = [
  { name: "wide", minN: 40, minRemaining: 300, maxRules: 5000 },
  { name: "balanced", minN: 80, minRemaining: 500, maxRules: 5000 },
  { name: "strict", minN: 120, minRemaining: 1000, maxRules: 5000 },
  { name: "very_strict", minN: 200, minRemaining: 1500, maxRules: 5000 },
  { name: "small_signal", minN: 50, minRemaining: 300, maxRules: 9000 },
];

const personas = [
  { name: "weather-pro", re: /(weather|wind|wave|天気|風|波)/i },
  { name: "racer-f-pro", re: /(racer|registration|flying|f_count|accident|rank|class|st|F持ち)/i },
  { name: "exhibition-pro", re: /(exhibition|展示|start_timing|ranking|time)/i },
  { name: "motor-boat-pro", re: /(motor|boat|top2|モーター|ボート)/i },
  { name: "market-pro", re: /(odds|ev|required|confidence|popularity|edge)/i },
  { name: "venue-race-pro", re: /(venue|race_no|raceNo|derived_race|会場)/i },
];

mkdirSync(OUT_DIR, { recursive: true });
const runs = [];

for (const [index, c] of cases.entries()) {
  console.log(`[roi-pro-loop] ${index + 1}/${cases.length} ${c.name}`);
  execFileSync("pnpm", ["tsx", "scripts/search-roi-all-features-lite.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      ROI_ALL_MIN_N: String(c.minN),
      ROI_ALL_MIN_REMAINING: String(c.minRemaining),
      ROI_ALL_MAX_RULES: String(c.maxRules),
    },
  });
  execFileSync("pnpm", ["tsx", "scripts/roi-pro-persona-review.ts"], { stdio: "inherit" });

  const allArchive = join(OUT_DIR, `${index + 1}-${c.name}-all.json`);
  const personaArchive = join(OUT_DIR, `${index + 1}-${c.name}-persona.json`);
  copyFileSync(ALL_JSON, allArchive);
  copyFileSync(PERSONA_JSON, personaArchive);

  const all = JSON.parse(readFileSync(ALL_JSON, "utf8")) as AllReport;
  const persona = JSON.parse(readFileSync(PERSONA_JSON, "utf8")) as PersonaReport;
  runs.push({
    case: c,
    baseline: all.baseline,
    counts: all.counts,
    topStable: all.rankings?.stability?.slice(0, 20) ?? [],
    topImprovement: all.rankings?.improvement?.slice(0, 20) ?? [],
    personaDecision: persona.finalDecision,
    personaConsensus: persona.consensus?.slice(0, 20) ?? [],
    allArchive,
    personaArchive,
  });
}

const consensus = buildConsensus(runs.flatMap((r) => r.topStable));
const personaConsensus = buildPersonaConsensus(runs.flatMap((r) => r.personaConsensus));
const finalDecision = decide(consensus, personaConsensus);

const report = {
  generatedAt: new Date().toISOString(),
  finalDecision,
  cases,
  runs,
  consensus,
  personaConsensus,
  nextActions: nextActions(finalDecision),
};

writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMd(report));
console.log(`[roi-pro-loop] finalDecision=${finalDecision}`);
console.log(`[roi-pro-loop] wrote ${OUT_MD}`);
console.log(`[roi-pro-loop] wrote ${OUT_JSON}`);

function buildConsensus(items: Candidate[]) {
  const map = new Map<string, { label: string; count: number; sOrA: number; bestRoi: number; bestImprovement: number; maxRemainingN: number; warnings: string[]; personas: string[] }>();
  for (const item of items) {
    const current = map.get(item.label) ?? { label: item.label, count: 0, sOrA: 0, bestRoi: 0, bestImprovement: 0, maxRemainingN: 0, warnings: [], personas: [] };
    current.count += 1;
    if (item.judgement === "S" || item.judgement === "A") current.sOrA += 1;
    current.bestRoi = Math.max(current.bestRoi, Number(item.remaining?.roi ?? 0));
    current.bestImprovement = Math.max(current.bestImprovement, Number(item.improvement ?? 0));
    current.maxRemainingN = Math.max(current.maxRemainingN, Number(item.remaining?.n ?? 0));
    current.warnings = [...new Set([...current.warnings, ...(item.warnings ?? [])])];
    current.personas = [...new Set([...current.personas, ...matchPersonas(item)])];
    map.set(item.label, current);
  }
  return [...map.values()].sort((a, b) => b.sOrA - a.sOrA || b.count - a.count || b.bestImprovement - a.bestImprovement);
}

function buildPersonaConsensus(items: Array<{ label: string; personas?: number; bestImprovement?: number; remainingN?: number; bestRoi?: number; warnings?: string[] }>) {
  const map = new Map<string, { label: string; count: number; personas: number; bestImprovement: number; maxRemainingN: number; bestRoi: number; warnings: string[] }>();
  for (const item of items) {
    const current = map.get(item.label) ?? { label: item.label, count: 0, personas: 0, bestImprovement: 0, maxRemainingN: 0, bestRoi: 0, warnings: [] };
    current.count += 1;
    current.personas = Math.max(current.personas, Number(item.personas ?? 0));
    current.bestImprovement = Math.max(current.bestImprovement, Number(item.bestImprovement ?? 0));
    current.maxRemainingN = Math.max(current.maxRemainingN, Number(item.remainingN ?? 0));
    current.bestRoi = Math.max(current.bestRoi, Number(item.bestRoi ?? 0));
    current.warnings = [...new Set([...current.warnings, ...(item.warnings ?? [])])];
    map.set(item.label, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.personas - a.personas || b.bestImprovement - a.bestImprovement);
}

function decide(consensus: ReturnType<typeof buildConsensus>, personaConsensus: ReturnType<typeof buildPersonaConsensus>) {
  const strong = consensus.some((x) => x.sOrA >= 3 && x.count >= 3 && x.bestImprovement >= 0.03 && x.maxRemainingN >= 1000 && x.warnings.length <= 2);
  const proStrong = personaConsensus.some((x) => x.count >= 2 && x.personas >= 2 && x.bestImprovement >= 0.03 && x.maxRemainingN >= 1000 && x.warnings.length <= 2);
  if (strong && proStrong) return "PAPER-STRONG";
  if (strong || proStrong || consensus.length > 0 || personaConsensus.length > 0) return "PAPER";
  return "NO-GO";
}

function nextActions(decision: string) {
  if (decision === "PAPER-STRONG") {
    return [
      "上位候補をpaper検証に固定する",
      "保存済みdecisionではなく再生成A/Bで同条件を再確認する",
      "liveでは購入指示ではなくNO BUY警告としてだけ使う",
      "app_settingsはpaper後まで変更しない",
    ];
  }
  if (decision === "PAPER") {
    return [
      "候補は本番ではなくpaper検証へ回す",
      "test悪化・最大1hit依存・n不足を落とす",
      "選手/天気/F/展示/motor/marketの複合条件を再生成A/Bで確認する",
    ];
  }
  return ["app_settingsは変えない", "再生成A/B基盤を優先する", "弱いBUY理由DBを増やす"];
}

function matchPersonas(item: Candidate) {
  const text = `${item.label} ${item.feature ?? ""}`;
  return personas.filter((p) => p.re.test(text)).map((p) => p.name);
}

function renderMd(report: { generatedAt: string; finalDecision: string; consensus: ReturnType<typeof buildConsensus>; personaConsensus: ReturnType<typeof buildPersonaConsensus>; runs: typeof runs; nextActions: string[] }) {
  return `# ROI Pro Loop\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\n## Cross-run Consensus\n\n${consensusTable(report.consensus)}\n\n## Persona Consensus\n\n${personaTable(report.personaConsensus)}\n\n## Runs\n\n${report.runs.map((r) => `### ${r.case.name}\n\nBaseline ROI: ${pct(Number(r.baseline?.roi ?? 0))}\nPersona decision: ${r.personaDecision ?? "-"}\n\n${candidateTable(r.topStable.slice(0, 10))}`).join("\n\n")}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function consensusTable(items: ReturnType<typeof buildConsensus>) {
  if (!items.length) return "None\n";
  return `| label | count | S/A | personas | remainingN | bestROI | bestImprovement | warnings |\n|---|---:|---:|---|---:|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${md(x.label)} | ${x.count} | ${x.sOrA} | ${x.personas.join("+") || "-"} | ${x.maxRemainingN} | ${pct(x.bestRoi)} | ${pct(x.bestImprovement)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}`;
}

function personaTable(items: ReturnType<typeof buildPersonaConsensus>) {
  if (!items.length) return "None\n";
  return `| label | count | personas | remainingN | bestROI | bestImprovement | warnings |\n|---|---:|---:|---:|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${md(x.label)} | ${x.count} | ${x.personas} | ${x.maxRemainingN} | ${pct(x.bestRoi)} | ${pct(x.bestImprovement)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}`;
}

function candidateTable(items: Candidate[]) {
  if (!items.length) return "None\n";
  return `| judgement | label | remainingN | remainingROI | improvement | test | warnings |\n|---|---|---:|---:|---:|---:|---|\n${items.map((x) => `| ${x.judgement ?? "-"} | ${md(x.label)} | ${x.remaining?.n ?? 0} | ${pct(Number(x.remaining?.roi ?? 0))} | ${pct(Number(x.improvement ?? 0))} | ${pct(Number(x.testRoi ?? 0))} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
