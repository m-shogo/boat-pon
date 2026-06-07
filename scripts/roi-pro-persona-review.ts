import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ALL_FEATURE_JSON = "reports/roi-all-feature-search.json";
const OUT_MD = "reports/roi-pro-persona-review.md";
const OUT_JSON = "reports/roi-pro-persona-review.json";

type Metric = { n?: number; hits?: number; roi?: number; roiExMaxHit?: number; hitRate?: number };
type Eval = {
  label: string;
  feature?: string;
  judgement?: string;
  removed?: Metric;
  remaining?: Metric;
  improvement?: number;
  trainRoi?: number;
  validationRoi?: number;
  testRoi?: number;
  warnings?: string[];
  risk?: string;
  score?: number;
};
type AllFeatureReport = {
  generatedAt: string;
  baseline: Metric;
  counts: Record<string, number>;
  rankings: Record<string, Eval[]>;
};

type Persona = {
  name: string;
  role: string;
  patterns: RegExp[];
  warning: string;
};

const personas: Persona[] = [
  {
    name: "weather-pro",
    role: "天気・水面・会場コンディションを見る担当",
    patterns: [/weather/i, /wind/i, /wave/i, /水面/, /波/, /風/],
    warning: "天候は会場・季節・取得欠損と混ざるので、単独採用しない",
  },
  {
    name: "racer-pro",
    role: "選手能力・登録番号・級別・勝率・STを見る担当",
    patterns: [/racer/i, /registration/i, /rank/i, /class/i, /win/i, /place/i, /st/i, /racer_reg/i, /flying/i],
    warning: "選手系は人気に織り込まれやすいので、オッズとの組み合わせで見る",
  },
  {
    name: "f-risk-pro",
    role: "F持ち・事故点・心理リスクを見る担当",
    patterns: [/flying/i, /accident/i, /late/i, /absence/i, /f_count/i, /F持ち/],
    warning: "F持ち複数は説明可能だが、過去期間だけの偏りを確認する",
  },
  {
    name: "exhibition-pro",
    role: "展示タイム・展示順位・展示STを見る担当",
    patterns: [/exhibition/i, /展示/, /start_timing/i, /ranking/i, /time/i],
    warning: "展示は締切直前情報なので、historicalとliveの取得差に注意する",
  },
  {
    name: "motor-boat-pro",
    role: "モーター・ボート・会場別機力を見る担当",
    patterns: [/motor/i, /boat/i, /top2/i, /モーター/, /ボート/],
    warning: "venue/nationalの参照先ズレと全件ロード問題を先に確認する",
  },
  {
    name: "market-odds-pro",
    role: "オッズ・期待値・人気過剰を見る担当",
    patterns: [/odds/i, /ev/i, /required/i, /confidence/i, /popularity/i, /edge/i],
    warning: "高配当1発依存と過去オッズ再現性を最優先で疑う",
  },
  {
    name: "venue-race-pro",
    role: "会場・レース番号・番組傾向を見る担当",
    patterns: [/venue/i, /race_no/i, /raceNo/i, /derived_race/i, /会場/],
    warning: "会場×Rは細かくなりやすく、過学習候補に落とす",
  },
];

if (!existsSync(ALL_FEATURE_JSON)) {
  console.log("[roi-pro-persona-review] all-feature report not found. generating...");
  execFileSync("pnpm", ["tsx", "scripts/search-roi-all-features-lite.ts"], { stdio: "inherit" });
}

const allFeature = JSON.parse(readFileSync(ALL_FEATURE_JSON, "utf8")) as AllFeatureReport;
const allItems = uniqueByLabel([
  ...(allFeature.rankings.stability ?? []),
  ...(allFeature.rankings.improvement ?? []),
  ...(allFeature.rankings.noBuyEffect ?? []),
  ...(allFeature.rankings.risky ?? []),
]);

const personaResults = personas.map((persona) => {
  const matches = allItems
    .filter((item) => persona.patterns.some((p) => p.test(item.label) || p.test(item.feature ?? "")))
    .sort(compare)
    .slice(0, 30);
  const stable = matches.filter((x) => x.judgement === "S" || x.judgement === "A");
  const risky = matches.filter((x) => x.judgement === "D" || (x.warnings ?? []).length >= 2);
  return {
    ...persona,
    matches,
    stable,
    risky,
    verdict: stable.length > 0 ? "PAPER" : matches.length > 0 ? "WATCH" : "NO-SIGNAL",
  };
});

const consensus = buildConsensus(personaResults.flatMap((x) => x.stable));
const finalDecision = consensus.some((x) => x.personas >= 2 && x.bestImprovement >= 0.03 && x.remainingN >= 1000) ? "PAPER-STRONG" : consensus.length > 0 ? "PAPER" : "NO-GO";

const report = {
  generatedAt: new Date().toISOString(),
  baseline: allFeature.baseline,
  finalDecision,
  counts: allFeature.counts,
  personas: personaResults,
  consensus,
  nextActions: nextActions(finalDecision),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMarkdown(report));
console.log(`[roi-pro-persona-review] finalDecision=${finalDecision}`);
console.log(`[roi-pro-persona-review] wrote ${OUT_MD}`);
console.log(`[roi-pro-persona-review] wrote ${OUT_JSON}`);

function buildConsensus(items: Eval[]) {
  const map = new Map<string, { label: string; personas: number; bestImprovement: number; remainingN: number; bestRoi: number; warnings: string[] }>();
  for (const item of items) {
    const current = map.get(item.label) ?? { label: item.label, personas: 0, bestImprovement: Number.NEGATIVE_INFINITY, remainingN: 0, bestRoi: 0, warnings: [] };
    current.personas += 1;
    current.bestImprovement = Math.max(current.bestImprovement, Number(item.improvement ?? 0));
    current.remainingN = Math.max(current.remainingN, Number(item.remaining?.n ?? 0));
    current.bestRoi = Math.max(current.bestRoi, Number(item.remaining?.roi ?? 0));
    current.warnings = [...new Set([...current.warnings, ...(item.warnings ?? [])])];
    map.set(item.label, current);
  }
  return [...map.values()].sort((a, b) => b.personas - a.personas || b.bestImprovement - a.bestImprovement || b.remainingN - a.remainingN);
}

function nextActions(decision: string) {
  if (decision === "PAPER-STRONG") {
    return [
      "強め候補をpaper検証に回す",
      "同条件でdecision再生成A/Bを作る",
      "app_settings変更はまだしない",
      "liveではNO BUY警告表示に留める",
    ];
  }
  if (decision === "PAPER") {
    return [
      "persona別の上位候補をpaper検証候補にする",
      "test悪化・最大1hit依存がある候補は除外する",
      "選手・天気・展示・motorの複合条件を次の探索に増やす",
    ];
  }
  return [
    "安定候補なし",
    "保存済みdecisionではなく再生成A/B基盤を優先する",
    "弱いBUY理由DBを増やす",
  ];
}

function renderMarkdown(report: {
  generatedAt: string;
  baseline: Metric;
  finalDecision: string;
  counts: Record<string, number>;
  personas: Array<Persona & { matches: Eval[]; stable: Eval[]; risky: Eval[]; verdict: string }>;
  consensus: Array<{ label: string; personas: number; bestImprovement: number; remainingN: number; bestRoi: number; warnings: string[] }>;
  nextActions: string[];
}) {
  return `# ROI Pro Persona Review\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\nBaseline ROI: ${pct(Number(report.baseline.roi ?? 0))} / n=${report.baseline.n ?? "unknown"}\n\n## Counts\n\n${Object.entries(report.counts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n## Consensus\n\n${consensusTable(report.consensus)}\n\n## Persona Reviews\n\n${report.personas.map((p) => `### ${p.name}: ${p.verdict}\n\n${p.role}\n\n注意: ${p.warning}\n\n#### Stable / Paper\n\n${table(p.stable)}\n\n#### Risky\n\n${table(p.risky.slice(0, 10))}`).join("\n\n")}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function table(items: Eval[]) {
  if (!items.length) return "None\n";
  return `| judgement | label | removedN | removedROI | remainingN | remainingROI | improvement | test | warnings |\n|---|---|---:|---:|---:|---:|---:|---:|---|\n${items.slice(0, 20).map((x) => `| ${x.judgement ?? "-"} | ${md(x.label)} | ${x.removed?.n ?? 0} | ${pct(Number(x.removed?.roi ?? 0))} | ${x.remaining?.n ?? 0} | ${pct(Number(x.remaining?.roi ?? 0))} | ${pct(Number(x.improvement ?? 0))} | ${pct(Number(x.testRoi ?? 0))} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function consensusTable(items: Array<{ label: string; personas: number; bestImprovement: number; remainingN: number; bestRoi: number; warnings: string[] }>) {
  if (!items.length) return "None\n";
  return `| label | personas | remainingN | bestROI | bestImprovement | warnings |\n|---|---:|---:|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${md(x.label)} | ${x.personas} | ${x.remainingN} | ${pct(x.bestRoi)} | ${pct(x.bestImprovement)} | ${md(x.warnings.join(", ") || "-")} |`).join("\n")}`;
}

function uniqueByLabel(items: Eval[]) {
  const map = new Map<string, Eval>();
  for (const item of items) {
    const old = map.get(item.label);
    if (!old || compare(item, old) < 0) map.set(item.label, item);
  }
  return [...map.values()];
}

function compare(a: Eval, b: Eval) {
  const rank = { S: 5, A: 4, B: 3, C: 1, D: 0 } as Record<string, number>;
  return (rank[b.judgement ?? "D"] ?? 0) - (rank[a.judgement ?? "D"] ?? 0) || Number(b.improvement ?? 0) - Number(a.improvement ?? 0);
}

function pct(value: number) { return `${(value * 100).toFixed(2)}%`; }
function md(value: string) { return value.replaceAll("|", "\\|"); }
