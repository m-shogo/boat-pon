import type { BuyLearningSummary } from "./buyLearningSummary";

const TAIL_STATUSES = new Set([
  "INSUFFICIENT_SUPPORT",
  "PERSISTENT_TAIL_DEPENDENCE",
  "RECENT_TAIL_DEPENDENCE",
  "PRIOR_TAIL_DEPENDENCE",
  "NO_TAIL_DEPENDENCE_SIGNAL",
]);

export type BuyTailPublicSignal = {
  schemaVersion: "buy-tail-dependence-public-v1";
  generatedAt: string;
  status: "INSUFFICIENT_SUPPORT" | "PERSISTENT_TAIL_DEPENDENCE" | "RECENT_TAIL_DEPENDENCE" | "PRIOR_TAIL_DEPENDENCE" | "NO_TAIL_DEPENDENCE_SIGNAL";
  windowSize: number;
  minimumTailGap: number;
  totalSettled: number;
  support: { recentSettled: number; priorSettled: number; missingSettledToCompare: number };
  recent: TailWindow;
  prior: TailWindow;
  productionChangeAllowed: false;
};

type TailWindow = {
  settled: number;
  hits: number;
  roi: number | null;
  roiExMax: number | null;
  tailGap: number | null;
  tailDependent: boolean;
};

export function validateBuyTailPublicSignal(value: unknown): BuyTailPublicSignal {
  if (!isRecord(value)) throw new Error("invalid BUY tail public signal");
  exactKeys(value, new Set(["schemaVersion", "generatedAt", "status", "windowSize", "minimumTailGap", "totalSettled", "support", "recent", "prior", "productionChangeAllowed"]), "tail");
  if (value.schemaVersion !== "buy-tail-dependence-public-v1") throw new Error("invalid BUY tail schemaVersion");
  if (typeof value.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error("invalid BUY tail generatedAt");
  if (!TAIL_STATUSES.has(String(value.status))) throw new Error("invalid BUY tail status");
  if (!isInt(value.windowSize, 10, 200)) throw new Error("invalid BUY tail windowSize");
  if (!isFiniteBetween(value.minimumTailGap, 0.05, 2)) throw new Error("invalid BUY tail minimumTailGap");
  if (!isCount(value.totalSettled)) throw new Error("invalid BUY tail totalSettled");
  if (value.productionChangeAllowed !== false) throw new Error("BUY tail signal cannot allow production change");

  const windowSize = Number(value.windowSize);
  const minimumTailGap = Number(value.minimumTailGap);
  const support = validateSupport(value.support, windowSize);
  const recent = validateWindow(value.recent, windowSize, "recent");
  const prior = validateWindow(value.prior, windowSize, "prior");
  assertWindowMetrics(recent, windowSize, minimumTailGap, "recent");
  assertWindowMetrics(prior, windowSize, minimumTailGap, "prior");
  if (support.recentSettled !== recent.settled || support.priorSettled !== prior.settled) throw new Error("BUY tail support/window mismatch");
  if (support.recentSettled + support.priorSettled > Number(value.totalSettled)) throw new Error("BUY tail support exceeds total settled");
  const expectedMissing = Math.max(0, windowSize * 2 - support.recentSettled - support.priorSettled);
  if (support.missingSettledToCompare !== expectedMissing) throw new Error("BUY tail missing support mismatch");
  const fullySupported = support.recentSettled === windowSize && support.priorSettled === windowSize;
  if ((value.status === "INSUFFICIENT_SUPPORT") === fullySupported) throw new Error("BUY tail support/status mismatch");
  if (fullySupported) {
    const expected = recent.tailDependent && prior.tailDependent
      ? "PERSISTENT_TAIL_DEPENDENCE"
      : recent.tailDependent
        ? "RECENT_TAIL_DEPENDENCE"
        : prior.tailDependent
          ? "PRIOR_TAIL_DEPENDENCE"
          : "NO_TAIL_DEPENDENCE_SIGNAL";
    if (value.status !== expected) throw new Error("BUY tail classification mismatch");
  }

  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["selection", "currentodds", "requiredodds", "recommendedamount", "stake", "raceid", "decisionid", "segmentkey", "/users/", "/home/"]) {
    if (serialized.includes(forbidden)) throw new Error(`private BUY tail field/value: ${forbidden}`);
  }
  return value as unknown as BuyTailPublicSignal;
}

export function mergeBuyTailLearning(summary: BuyLearningSummary, rawTail: unknown): BuyLearningSummary {
  const tail = validateBuyTailPublicSignal(rawTail);
  if (summary.status !== "AVAILABLE") return summary;
  if (summary.performance.settled !== tail.totalSettled) throw new Error("BUY tail/learning settled count mismatch");
  if (tail.status === "INSUFFICIENT_SUPPORT") return summary;

  const learnings = [...summary.learnings];
  let candidates = [...summary.researchCandidates];
  const evidenceCount = tail.windowSize * 2;

  if (tail.status === "PERSISTENT_TAIL_DEPENDENCE") {
    learnings.push({
      id: "TAIL_DEPENDENCE_PERSISTS",
      severity: "ACTION",
      title: "最大hit依存が独立windowでも継続",
      summary: `非重複の${tail.windowSize} BUY×2 windowで最大1件除外後のROI低下がともに閾値以上です。production条件は変更せず、払戻tail依存の再現性を追加検証します。`,
      evidenceCount,
    });
    candidates = replaceCandidate(candidates, {
      id: "RESEARCH-TAIL-DEPENDENCE",
      title: "最大hit依存性の時系列検証",
      reason: `非重複${tail.windowSize} BUY×2 windowの双方で最大hit依存を観測`,
      status: "PROPOSED",
      productionChangeAllowed: false,
    });
  } else if (tail.status === "RECENT_TAIL_DEPENDENCE") {
    learnings.push({
      id: "TAIL_DEPENDENCE_RECENT_ONLY",
      severity: "WATCH",
      title: "最大hit依存が直近windowで出現",
      summary: `直近${tail.windowSize} BUYだけで最大hit依存が観測されました。regime変化か偶然かを分離するまでproductionへ反映しません。`,
      evidenceCount,
    });
    candidates.push({ id: "RESEARCH-TAIL-REGIME-SHIFT", title: "最大hit依存のregime変化検証", reason: "最大hit依存が直近windowのみに出現", status: "PROPOSED", productionChangeAllowed: false });
  } else if (tail.status === "PRIOR_TAIL_DEPENDENCE") {
    learnings.push({
      id: "TAIL_DEPENDENCE_PRIOR_ONLY",
      severity: "INFO",
      title: "最大hit依存は直近windowで未再現",
      summary: `以前の${tail.windowSize} BUYでは最大hit依存がありましたが、直近${tail.windowSize} BUYでは同じ判定を満たしていません。改善・regime差・標本変動を継続観測します。`,
      evidenceCount,
    });
    candidates.push({ id: "RESEARCH-TAIL-REGIME-SHIFT", title: "最大hit依存のregime変化検証", reason: "過去windowの最大hit依存が直近windowでは未再現", status: "PROPOSED", productionChangeAllowed: false });
  } else {
    learnings.push({
      id: "TAIL_DEPENDENCE_NOT_REPEATED",
      severity: "INFO",
      title: "最大hit依存は独立windowで反復せず",
      summary: `非重複の${tail.windowSize} BUY×2 windowでは最大hit依存が反復していません。全期間集計だけでtail依存を断定せず観測を続けます。`,
      evidenceCount,
    });
  }

  return {
    ...summary,
    learnings: dedupe(learnings).slice(0, 6),
    researchCandidates: dedupe(candidates).slice(0, 6),
  };
}

function validateSupport(value: unknown, windowSize: number) {
  if (!isRecord(value)) throw new Error("invalid BUY tail support");
  exactKeys(value, new Set(["recentSettled", "priorSettled", "missingSettledToCompare"]), "tail.support");
  if (!isInt(value.recentSettled, 0, windowSize) || !isInt(value.priorSettled, 0, windowSize) || !isCount(value.missingSettledToCompare)) throw new Error("invalid BUY tail support values");
  return value as unknown as BuyTailPublicSignal["support"];
}

function validateWindow(value: unknown, windowSize: number, name: string): TailWindow {
  if (!isRecord(value)) throw new Error(`invalid BUY tail ${name} window`);
  exactKeys(value, new Set(["settled", "hits", "roi", "roiExMax", "tailGap", "tailDependent"]), `tail.${name}`);
  if (!isInt(value.settled, 0, windowSize) || !isInt(value.hits, 0, Number(value.settled))) throw new Error(`invalid BUY tail ${name} counts`);
  for (const key of ["roi", "roiExMax", "tailGap"] as const) if (!(value[key] === null || isFiniteBetween(value[key], -100, 100))) throw new Error(`invalid BUY tail ${name}.${key}`);
  if (typeof value.tailDependent !== "boolean") throw new Error(`invalid BUY tail ${name}.tailDependent`);
  return value as unknown as TailWindow;
}

function assertWindowMetrics(window: TailWindow, windowSize: number, minimumTailGap: number, name: string) {
  const expectedGap = window.roi === null || window.roiExMax === null ? null : round4(window.roi - window.roiExMax);
  if (expectedGap !== window.tailGap) throw new Error(`BUY tail ${name} gap mismatch`);
  const expectedDependent = window.settled === windowSize && window.tailGap !== null && window.tailGap >= minimumTailGap;
  if (window.tailDependent !== expectedDependent) throw new Error(`BUY tail ${name} dependence mismatch`);
}
function replaceCandidate(items: BuyLearningSummary["researchCandidates"], replacement: BuyLearningSummary["researchCandidates"][number]) {
  return [...items.filter((item) => item.id !== replacement.id), replacement];
}
function dedupe<T extends { id: string }>(items: T[]) { return [...new Map(items.map((item) => [item.id, item])).values()]; }
function exactKeys(value: Record<string, unknown>, allowed: Set<string>, path: string) { for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}.${key}: unknown key`); for (const key of allowed) if (!(key in value)) throw new Error(`${path}.${key}: required`); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCount(value: unknown) { return Number.isInteger(value) && Number(value) >= 0; }
function isInt(value: unknown, min: number, max: number) { return Number.isInteger(value) && Number(value) >= min && Number(value) <= max; }
function isFiniteBetween(value: unknown, min: number, max: number) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function round4(value: number) { return Math.round(value * 10000) / 10000; }
