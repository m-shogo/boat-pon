import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT_MD = "reports/roi-master-review.md";
const OUT_JSON = "reports/roi-master-review.json";

type AnyObj = Record<string, unknown>;

type Candidate = {
  label?: string;
  strategy?: string;
  action?: string;
  judgement?: string;
  improvement?: number;
  remaining?: { n?: number; roi?: number; roiExMaxHit?: number };
  removed?: { n?: number; roi?: number };
  warnings?: string[];
};

const commands = [
  "pnpm typecheck:scripts",
  "pnpm analyze:bet-strategies",
  "pnpm tsx scripts/run-roi-relentless.ts",
  "pnpm tsx scripts/run-roi-bet-full-review.ts",
] as const;

const executed: Array<{ command: string; ok: boolean; error?: string }> = [];
for (const command of commands) {
  console.log(`[roi-master-review] ${command}`);
  try {
    execFileSync("bash", ["-lc", command], { stdio: "inherit" });
    executed.push({ command, ok: true });
  } catch (error) {
    executed.push({ command, ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const relentless = read("reports/roi-relentless.json");
const betFull = read("reports/roi-bet-full-review.json");
const allFeature = read("reports/roi-all-feature-search.json");
const persona = read("reports/roi-pro-persona-review.json");
const bet = read("reports/bet-strategy-simulation.json");

const noBuy = collectNoBuy(relentless, allFeature, persona);
const betIdeas = collectBetIdeas(betFull, bet);
const finalDecision = decide(noBuy, betIdeas, relentless, betFull);

const report = {
  generatedAt: new Date().toISOString(),
  safety: {
    dbWrites: false,
    appSettingsChanged: false,
    productionLogicChanged: false,
    reportsOnly: true,
  },
  executed,
  finalDecision,
  baseline: {
    noBuy: getPath(allFeature, ["baseline"]),
    bet: getPath(bet, ["original"]),
  },
  noBuyCandidates: noBuy.slice(0, 40),
  betCandidates: betIdeas.slice(0, 40),
  nextActions: nextActions(finalDecision),
};

mkdirSync("reports", { recursive: true });
writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(OUT_MD, renderMd(report));
console.log(`[roi-master-review] finalDecision=${finalDecision}`);
console.log(`[roi-master-review] wrote ${OUT_MD}`);
console.log(`[roi-master-review] wrote ${OUT_JSON}`);

function collectNoBuy(relentless: AnyObj | null, allFeature: AnyObj | null, persona: AnyObj | null): Candidate[] {
  const items = [
    ...arr(getPath(relentless, ["globalConsensus"])),
    ...arr(getPath(allFeature, ["rankings", "stability"])),
    ...arr(getPath(persona, ["consensus"])),
  ] as Candidate[];
  return uniqueBy(items, (x) => x.label ?? JSON.stringify(x)).sort((a, b) => score(b) - score(a));
}

function collectBetIdeas(betFull: AnyObj | null, bet: AnyObj | null): Candidate[] {
  const items = [
    ...arr(getPath(betFull, ["stableStrategies"])),
    ...arr(getPath(betFull, ["groupEdges"])),
    ...arr(getPath(bet, ["summaries"])),
  ] as Candidate[];
  return uniqueBy(items, (x) => x.strategy ?? x.label ?? JSON.stringify(x)).sort((a, b) => score(b) - score(a));
}

function decide(noBuy: Candidate[], betIdeas: Candidate[], relentless: AnyObj | null, betFull: AnyObj | null) {
  const noBuyDecision = String(getPath(relentless, ["finalDecision"]) ?? "NO-GO");
  const betDecision = String(getPath(betFull, ["finalDecision"]) ?? "NO-GO");
  const strongNoBuy = noBuyDecision === "PAPER-STRONG" || noBuy.some((x) => score(x) >= 3);
  const strongBet = betDecision === "PAPER-STRONG" || betIdeas.some((x) => score(x) >= 3);
  if (strongNoBuy && strongBet) return "PAPER-STRONG";
  if (strongNoBuy || strongBet || noBuy.length > 0 || betIdeas.length > 0) return "PAPER";
  return "NO-GO";
}

function score(x: Candidate) {
  const improvement = Number(x.improvement ?? (x as Record<string, unknown>).bestImprovement ?? 0);
  const n = Number(x.remaining?.n ?? (x as Record<string, unknown>).remainingN ?? (x as Record<string, unknown>).maxRemainingN ?? 0);
  const warnings = x.warnings?.length ?? 0;
  const judgementScore = x.judgement === "S" ? 3 : x.judgement === "A" ? 2 : x.judgement === "B" ? 1 : 0;
  return judgementScore + improvement * 100 + Math.min(2, n / 1000) - warnings;
}

function nextActions(decision: string) {
  if (decision === "PAPER-STRONG") {
    return [
      "NO BUY候補と買い方候補を分離してpaper検証する",
      "再生成A/Bを次に作る",
      "app_settings変更はpaper結果後に限定する",
    ];
  }
  if (decision === "PAPER") {
    return [
      "上位候補をpaper検証だけに回す",
      "最大1hit依存・test悪化・欠損率高い買い方を落とす",
      "racer_profiles/F/展示ズレの明示featureを次に足す",
    ];
  }
  return ["設定変更しない", "再生成A/B基盤を優先する", "弱いBUY理由DBを増やす"];
}

function renderMd(report: { generatedAt: string; finalDecision: string; executed: Array<{ command: string; ok: boolean; error?: string }>; noBuyCandidates: Candidate[]; betCandidates: Candidate[]; nextActions: string[] }) {
  return `# ROI Master Review\n\nGenerated: ${report.generatedAt}\n\n## Final Decision: ${report.finalDecision}\n\n## Executed\n\n${report.executed.map((x) => `- ${x.ok ? "OK" : "NG"}: \`${x.command}\`${x.error ? ` - ${x.error}` : ""}`).join("\n")}\n\n## NO BUY Candidates\n\n${table(report.noBuyCandidates)}\n\n## Bet Strategy Candidates\n\n${table(report.betCandidates)}\n\n## Next Actions\n\n${report.nextActions.map((x) => `- ${x}`).join("\n")}\n`;
}

function table(items: Candidate[]) {
  if (!items.length) return "None\n";
  return `| key | judgement | improvement | remainingN | warning |\n|---|---|---:|---:|---|\n${items.slice(0, 30).map((x) => `| ${md(x.label ?? x.strategy ?? x.action ?? "-")} | ${x.judgement ?? "-"} | ${pct(Number(x.improvement ?? (x as Record<string, unknown>).bestImprovement ?? 0))} | ${Number(x.remaining?.n ?? (x as Record<string, unknown>).remainingN ?? (x as Record<string, unknown>).maxRemainingN ?? 0)} | ${md((x.warnings ?? []).join(", ") || "-")} |`).join("\n")}`;
}

function read(path: string): AnyObj | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as AnyObj;
}
function getPath(obj: unknown, path: string[]): unknown {
  return path.reduce((cur, key) => cur && typeof cur === "object" ? (cur as AnyObj)[key] : undefined, obj);
}
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function uniqueBy<T>(items: T[], key: (x: T) => string) { const m = new Map<string, T>(); for (const item of items) if (!m.has(key(item))) m.set(key(item), item); return [...m.values()]; }
function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function md(v: string) { return String(v).replaceAll("|", "\\|"); }
