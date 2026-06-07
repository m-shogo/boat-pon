import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BET_JSON = "reports/bet-strategy-simulation.json";
const RELENTLESS_JSON = "reports/roi-relentless.json";
const OUT_MD = "reports/roi-bet-full-review.md";
const OUT_JSON = "reports/roi-bet-full-review.json";

type StrategySummary = {
  strategy: string;
  races: number;
  totalTickets: number;
  missingRate: number;
  avgTicketsPerRace: number;
  hitRate: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

type Split = {
  strategy: string;
  trainRoi: number;
  validationRoi: number;
  testRoi: number;
  judgement?: string;
};

type GroupBest = {
  key: string;
  bestStrategy: string;
  originalRoi: number;
  bestRoi: number;
  n: number;
  comment?: string;
};

type BetReport = {
  original: StrategySummary;
  summaries: StrategySummary[];
  splitValidation: Split[];
  venueBest?: GroupBest[];
  raceNoBest?: GroupBest[];
  oddsBandBest?: GroupBest[];
  headBest?: GroupBest[];
  weatherBest?: GroupBest[];
  exhibitionBest?: GroupBest[];
  fBest?: GroupBest[];
  windBest?: GroupBest[];
  waveBest?: GroupBest[];
  motorBest?: GroupBest[];
  boatBest?: GroupBest[];
  flowConditions?: unknown[];
  boxConditions?: unknown[];
};

type RelentlessReport = {
  finalDecision?: string;
  globalConsensus?: Array<{ label: string; count?: number; bestRoi?: number; bestImprovement?: number; maxRemainingN?: number; warnings?: string[] }>;
};

const commands: Array<[string, string[]]> = [
  ["pnpm", ["analyze:bet-strategies"]],
  ["pnpm", ["tsx", "scripts/run-roi-relentless.ts"]],
];

const executed: Array<{ command: string; ok: boolean; error?: string }> = [];
for (const [bin, args] of commands) {
  const text = `${bin} ${args.join(" ")}`;
  console.log(`[roi-bet-full-review] ${text}`);
  try {
    execFileSync(bin, args, { stdio: "inherit" });
    executed.push({ command: text, ok: true });
  } catch (error) {
    executed.push({ command: text, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const bet = readJson<BetReport>(BET_JSON);
const relentless = readOptional<RelentlessReport>(RELENTLESS_JSON);
const original = bet.original;
const rankedStrategies = bet.summaries
  .map((summary) => ({ ...summary, split: bet.splitValidation.find((s) => s.strategy === summary.strategy) }))
  .sort((a, b) => scoreStrategy(b, original) - scoreStrategy(a, original));
const stableStrategies = rankedStrategies.filter((s) => isStableStrategy(s, original));
const dangerousStrategies = rankedStrategies.filter((s) => isDangerousStrategy(s, original));
const groupEdges = collectGroupEdges(bet);
const finalDecision = decide(stableStrategies, groupEdges, relentless);

const report = {
  generatedAt: new Date().toISOString(),
  safety: {
    writesDb: false,
    changesSettings: false,
    changesProductionDecisionLogic: false,
    autoBetting: false,
  },
  executed,
  finalDecision,
  original,
  stableStrategies: stableStrategies.slice(0, 20),
  rankedStrategies: rankedStrategies.slice(0, 30),
  dangerousStrategies: dangerousStrategies.slice(0, 20),
  groupEdges: groupEdges.slice(0, 50),
  noBuyConsensus: relentless?.globalConsensus?.slice(0, 30) ?? [],
  nextActions: nextActions(finalDecision),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMd(report));
console.log(`[roi-bet-full-review] finalDecision=${finalDecision}`);
console.log(`[roi-bet-full-review] wrote ${OUT_MD}`);
console.log(`[roi-bet-full-review] wrote ${OUT_JSON}`);

function scoreStrategy(summary: StrategySummary & { split?: Split }, base: StrategySummary) {
  const roiGain = summary.roi - base.roi;
  const exGain = summary.roiExMaxHit - base.roiExMaxHit;
  const testGain = (summary.split?.testRoi ?? 0) - (bet.splitValidation.find((s) => s.strategy === base.strategy)?.testRoi ?? 0);
  const missingPenalty = summary.missingRate * 40;
  const ticketPenalty = Math.max(0, summary.avgTicketsPerRace - 1) * 3;
  return roiGain + exGain * 0.6 + testGain * 0.4 - missingPenalty - ticketPenalty;
}

function isStableStrategy(summary: StrategySummary & { split?: Split }, base: StrategySummary) {
  if (summary.strategy === base.strategy) return false;
  if (summary.missingRate > 0.2) return false;
  if (summary.roi <= base.roi) return false;
  if (summary.roiExMaxHit <= base.roiExMaxHit) return false;
  if ((summary.split?.validationRoi ?? 0) < (bet.splitValidation.find((s) => s.strategy === base.strategy)?.validationRoi ?? 0) - 8) return false;
  if ((summary.split?.testRoi ?? 0) < (bet.splitValidation.find((s) => s.strategy === base.strategy)?.testRoi ?? 0) - 8) return false;
  if (summary.avgTicketsPerRace > 8) return false;
  return true;
}

function isDangerousStrategy(summary: StrategySummary & { split?: Split }, base: StrategySummary) {
  if (summary.strategy === base.strategy) return false;
  if (summary.missingRate > 0.2) return true;
  if (summary.roi > base.roi && summary.roiExMaxHit <= base.roiExMaxHit) return true;
  if ((summary.split?.testRoi ?? 0) < (bet.splitValidation.find((s) => s.strategy === base.strategy)?.testRoi ?? 0) - 12) return true;
  if (summary.avgTicketsPerRace > 10) return true;
  return false;
}

function collectGroupEdges(report: BetReport) {
  const groups: Array<{ source: string; key: string; bestStrategy: string; originalRoi: number; bestRoi: number; n: number; improvement: number; comment?: string }> = [];
  const sources: Array<[string, GroupBest[] | undefined]> = [
    ["venue", report.venueBest],
    ["raceNo", report.raceNoBest],
    ["oddsBand", report.oddsBandBest],
    ["head", report.headBest],
    ["weather", report.weatherBest],
    ["exhibition", report.exhibitionBest],
    ["f", report.fBest],
    ["wind", report.windBest],
    ["wave", report.waveBest],
    ["motor", report.motorBest],
    ["boat", report.boatBest],
  ];
  for (const [source, rows] of sources) {
    for (const row of rows ?? []) {
      groups.push({ ...row, source, improvement: row.bestRoi - row.originalRoi });
    }
  }
  return groups
    .filter((x) => x.n >= 50 && x.improvement > 0)
    .sort((a, b) => b.improvement - a.improvement || b.n - a.n);
}

function decide(
  stable: Array<StrategySummary & { split?: Split }>,
  groups: ReturnType<typeof collectGroupEdges>,
  relentless: RelentlessReport | null,
) {
  const noBuyStrong = relentless?.finalDecision === "PAPER-STRONG";
  const strongBet = stable.some((s) => s.roi - original.roi >= 3 && s.roiExMaxHit > original.roiExMaxHit && s.races >= 1000);
  const conditionalBet = groups.some((g) => g.improvement >= 5 && g.n >= 100);
  if (noBuyStrong && (strongBet || conditionalBet)) return "PAPER-STRONG";
  if (stable.length > 0 || groups.length > 0 || noBuyStrong || relentless?.finalDecision === "PAPER") return "PAPER";
  return "NO-GO";
}

function nextActions(decision: string) {
  if (decision === "PAPER-STRONG") {
    return [
      "NO BUY条件と買い方条件を分けてpaper検証する",
      "複数点買いは投資額が増えるため、実運用では上限点数を固定する",
      "本番反映前に再生成A/Bで同じ買い方を再計算する",
      "購入指示ではなく検証候補として扱う",
    ];
  }
  if (decision === "PAPER") {
    return [
      "買い方は本番反映せずpaper検証へ回す",
      "missingRateが高いBOX/流しは採用候補から外す",
      "条件付きでのみ複数点を使う候補を深掘りする",
    ];
  }
  return ["1点買い基準を維持", "買い方変更はしない", "NO BUY削減側を優先する"];
}

function renderMd(report: {
  generatedAt: string;
  finalDecision: string;
  original: StrategySummary;
  stableStrategies: Array<StrategySummary & { split?: Split }>;
  rankedStrategies: Array<StrategySummary & { split?: Split }>;
  dangerousStrategies: Array<StrategySummary & { split?: Split }>;
  groupEdges: ReturnType<typeof collectGroupEdges>;
  noBuyConsensus: NonNullable<RelentlessReport["globalConsensus"]>;
  nextActions: string[];
}) {
  return `# ROI Bet Full Review\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\n## Original Strategy\n\n| strategy | races | hitRate | tickets/race | ROI | ROI ex max hit | missingRate |\n|---|---:|---:|---:|---:|---:|---:|\n| ${report.original.strategy} | ${report.original.races} | ${pct(report.original.hitRate)} | ${num(report.original.avgTicketsPerRace)} | ${pct100(report.original.roi)} | ${pct100(report.original.roiExMaxHit)} | ${pct(report.original.missingRate)} |\n\n## Stable Bet Strategies\n\n${strategyTable(report.stableStrategies)}\n\n## Ranked Strategies\n\n${strategyTable(report.rankedStrategies)}\n\n## Conditional Group Edges\n\n${groupTable(report.groupEdges)}\n\n## Dangerous / Do Not Ship\n\n${strategyTable(report.dangerousStrategies)}\n\n## NO BUY Consensus Linked\n\n${consensusTable(report.noBuyConsensus)}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function strategyTable(items: Array<StrategySummary & { split?: Split }>) {
  if (!items.length) return "None\n";
  return `| strategy | races | hitRate | tickets/race | ROI | ROI ex max hit | train | validation | test | missingRate |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${items.map((x) => `| ${x.strategy} | ${x.races} | ${pct(x.hitRate)} | ${num(x.avgTicketsPerRace)} | ${pct100(x.roi)} | ${pct100(x.roiExMaxHit)} | ${pct100(x.split?.trainRoi ?? 0)} | ${pct100(x.split?.validationRoi ?? 0)} | ${pct100(x.split?.testRoi ?? 0)} | ${pct(x.missingRate)} |`).join("\n")}`;
}

function groupTable(items: ReturnType<typeof collectGroupEdges>) {
  if (!items.length) return "None\n";
  return `| source | key | bestStrategy | n | originalROI | bestROI | improvement |\n|---|---|---|---:|---:|---:|---:|\n${items.slice(0, 50).map((x) => `| ${x.source} | ${md(x.key)} | ${x.bestStrategy} | ${x.n} | ${pct100(x.originalRoi)} | ${pct100(x.bestRoi)} | ${pct100(x.improvement)} |`).join("\n")}`;
}

function consensusTable(items: NonNullable<RelentlessReport["globalConsensus"]>) {
  if (!items.length) return "None\n";
  return `| label | count | remainingN | bestROI | bestImprovement | warnings |\n|---|---:|---:|---:|---:|---|\n${items.map((x) => `| ${md(x.label)} | ${x.count ?? 0} | ${x.maxRemainingN ?? 0} | ${pct(x.bestRoi ?? 0)} | ${pct(x.bestImprovement ?? 0)} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptional<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function pct100(value: number) { return `${value.toFixed(2)}%`; }
function num(value: number) { return value.toFixed(2); }
function md(value: string) { return value.replaceAll("|", "\\|"); }
