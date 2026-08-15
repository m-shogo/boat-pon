import type { BuyOutcomePattern, PublicOutcomePatternSignal } from "./buyOutcomePatternMiner";

export type BuyPatternReplicationStatus =
  | "INSUFFICIENT_WINDOW_SUPPORT"
  | "NO_REPLICATED_SIGNAL"
  | "REPLICATED_SIGNALS";

export type BuyPatternReplicationResult = {
  status: BuyPatternReplicationStatus;
  totalSettled: number;
  windowSize: number;
  requiredSettled: number;
  missingSettledToCompare: number;
  discoveryPatternCount: number;
  confirmationPatternCount: number;
  replicatedPatternCount: number;
  signals: PublicOutcomePatternSignal[];
  productionChangeAllowed: false;
};

/**
 * Fail-closed temporal confirmation gate for exploratory BUY outcome patterns.
 *
 * A private segment must clear the same screening contract in two independent,
 * non-overlapping windows with the same direction before it becomes a learning
 * signal. This protects the outcome-learning path from promoting one-window
 * discoveries produced by scanning many segment cells.
 */
export function replicateBuyOutcomePatterns(input: {
  totalSettled: number;
  windowSize: number;
  discovery: BuyOutcomePattern[];
  confirmation: BuyOutcomePattern[];
  limit?: number;
}): BuyPatternReplicationResult {
  const { totalSettled, windowSize, discovery, confirmation } = input;
  const limit = input.limit ?? 6;
  if (!Number.isInteger(totalSettled) || totalSettled < 0) throw new Error("invalid BUY replication totalSettled");
  if (!Number.isInteger(windowSize) || windowSize < 2) throw new Error("invalid BUY replication windowSize");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("invalid BUY replication limit");
  discovery.forEach(validatePattern);
  confirmation.forEach(validatePattern);

  const requiredSettled = windowSize * 2;
  const missingSettledToCompare = Math.max(0, requiredSettled - totalSettled);
  if (missingSettledToCompare > 0) {
    return {
      status: "INSUFFICIENT_WINDOW_SUPPORT",
      totalSettled,
      windowSize,
      requiredSettled,
      missingSettledToCompare,
      discoveryPatternCount: 0,
      confirmationPatternCount: 0,
      replicatedPatternCount: 0,
      signals: [],
      productionChangeAllowed: false,
    };
  }

  const confirmationByIdentity = new Map(
    confirmation.map((pattern) => [identity(pattern), pattern] as const),
  );
  const replicated = discovery.flatMap((pattern) => {
    const matched = confirmationByIdentity.get(identity(pattern));
    if (!matched) return [];
    const conservativeDelta = Math.sign(pattern.roiDelta)
      * Math.min(Math.abs(pattern.roiDelta), Math.abs(matched.roiDelta));
    return [{ discovery: pattern, confirmation: matched, conservativeDelta }];
  }).sort((a, b) => {
    if (a.discovery.confidence !== b.discovery.confidence) return a.discovery.confidence === "STRONG" ? -1 : 1;
    return Math.abs(b.conservativeDelta) - Math.abs(a.conservativeDelta);
  });

  const seenPublic = new Set<string>();
  const signals: PublicOutcomePatternSignal[] = [];
  for (const item of replicated) {
    const publicIdentity = `${item.discovery.direction}:${item.discovery.dimension}`;
    if (seenPublic.has(publicIdentity)) continue;
    seenPublic.add(publicIdentity);
    signals.push({
      id: `PATTERN_${item.discovery.direction}_${item.discovery.dimension}`.toUpperCase(),
      direction: item.discovery.direction,
      dimension: item.discovery.dimension,
      evidenceCount: item.discovery.settled + item.confirmation.settled,
      roiDelta: round4(item.conservativeDelta),
      confidence: item.discovery.confidence === "STRONG" && item.confirmation.confidence === "STRONG" ? "STRONG" : "WATCH",
      productionChangeAllowed: false,
    });
    if (signals.length >= limit) break;
  }

  return {
    status: signals.length ? "REPLICATED_SIGNALS" : "NO_REPLICATED_SIGNAL",
    totalSettled,
    windowSize,
    requiredSettled,
    missingSettledToCompare: 0,
    discoveryPatternCount: discovery.length,
    confirmationPatternCount: confirmation.length,
    replicatedPatternCount: replicated.length,
    signals,
    productionChangeAllowed: false,
  };
}

function identity(pattern: BuyOutcomePattern): string {
  return `${pattern.dimension}\u0000${pattern.segmentKey}\u0000${pattern.direction}`;
}

function validatePattern(pattern: BuyOutcomePattern) {
  if (!pattern || typeof pattern !== "object") throw new Error("invalid BUY replication pattern");
  if (!pattern.segmentKey || !Number.isInteger(pattern.settled) || pattern.settled < 1) throw new Error("invalid BUY replication pattern support");
  if (!Number.isFinite(pattern.roiDelta) || pattern.roiDelta === 0) throw new Error("invalid BUY replication ROI delta");
  if ((pattern.direction === "SUCCESS_EDGE") !== (pattern.roiDelta > 0)) throw new Error("BUY replication direction mismatch");
  if (pattern.productionChangeAllowed !== false) throw new Error("BUY replication cannot allow production change");
}

function round4(value: number): number { return Math.round(value * 10000) / 10000; }
