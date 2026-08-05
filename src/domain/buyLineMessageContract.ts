export const BUY_LINE_MESSAGE_SCHEMA_VERSION = "buy-line-message-v1" as const;

export type BuyLineDataStatus = "complete" | "partial" | "blocked";

export type BuyLineMessageInput = {
  decisionId: string;
  raceId: string;
  venue: string;
  raceNo: number;
  closeAtJst: string;
  observedAt: string;
  betType: string;
  selection: string;
  estimatedHitRate: number;
  requiredOdds: number;
  currentOdds: number | null;
  expectedValue: number | null;
  recommendedStakeYen: number;
  sampleSize: number;
  modelVersion: string;
  runKind: string;
  reasons: string[];
  warnings: string[];
  dataStatus: BuyLineDataStatus;
  officialOddsUrl: string;
  voteUrl?: string | null;
};

export type BuyLineMessage = {
  schemaVersion: typeof BUY_LINE_MESSAGE_SCHEMA_VERSION;
  dedupeKey: string;
  title: string;
  body: string;
  freshness: {
    observedAt: string;
    closeAtJst: string;
  };
};

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} must not be empty`);
  return trimmed;
}

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
}

function formatOdds(value: number | null): string {
  return value == null ? "未取得" : `${value.toFixed(1)}倍`;
}

function formatExpectedValue(value: number | null): string {
  return value == null ? "未算出" : value.toFixed(2);
}

function statusLabel(status: BuyLineDataStatus): string {
  if (status === "complete") return "COMPLETE";
  if (status === "partial") return "PARTIAL";
  return "BLOCKED";
}

export function buildBuyLineMessage(input: BuyLineMessageInput): BuyLineMessage {
  const decisionId = requireNonEmpty(input.decisionId, "decisionId");
  const raceId = requireNonEmpty(input.raceId, "raceId");
  const venue = requireNonEmpty(input.venue, "venue");
  const betType = requireNonEmpty(input.betType, "betType");
  const selection = requireNonEmpty(input.selection, "selection");
  const closeAtJst = requireNonEmpty(input.closeAtJst, "closeAtJst");
  const observedAt = requireNonEmpty(input.observedAt, "observedAt");
  const modelVersion = requireNonEmpty(input.modelVersion, "modelVersion");
  const runKind = requireNonEmpty(input.runKind, "runKind");
  const officialOddsUrl = requireNonEmpty(input.officialOddsUrl, "officialOddsUrl");

  if (!Number.isInteger(input.raceNo) || input.raceNo < 1 || input.raceNo > 12) {
    throw new Error("raceNo must be an integer from 1 to 12");
  }
  requireFinite(input.estimatedHitRate, "estimatedHitRate");
  if (input.estimatedHitRate < 0 || input.estimatedHitRate > 1) {
    throw new Error("estimatedHitRate must be between 0 and 1");
  }
  requireFinite(input.requiredOdds, "requiredOdds");
  if (input.requiredOdds <= 0) throw new Error("requiredOdds must be greater than 0");
  if (input.currentOdds != null) {
    requireFinite(input.currentOdds, "currentOdds");
    if (input.currentOdds <= 0) throw new Error("currentOdds must be greater than 0");
  }
  if (input.expectedValue != null) requireFinite(input.expectedValue, "expectedValue");
  if (!Number.isInteger(input.recommendedStakeYen) || input.recommendedStakeYen < 0) {
    throw new Error("recommendedStakeYen must be a non-negative integer");
  }
  if (!Number.isInteger(input.sampleSize) || input.sampleSize < 0) {
    throw new Error("sampleSize must be a non-negative integer");
  }

  const reasons = input.reasons.map((reason) => reason.trim()).filter(Boolean);
  const warnings = input.warnings.map((warning) => warning.trim()).filter(Boolean);
  const voteUrl = input.voteUrl?.trim() || null;

  const body = [
    `race: ${raceId}`,
    `候補: ${selection}（${betType}）`,
    `締切: ${closeAtJst}`,
    `観測時刻: ${observedAt}`,
    `取得オッズ: ${formatOdds(input.currentOdds)}`,
    `必要オッズ: ${input.requiredOdds.toFixed(1)}倍以上`,
    `推定的中率: ${(input.estimatedHitRate * 100).toFixed(1)}%`,
    `EV: ${formatExpectedValue(input.expectedValue)}`,
    `推奨stake: ${input.recommendedStakeYen}円`,
    `sample: n=${input.sampleSize}`,
    `data: ${statusLabel(input.dataStatus)}`,
    `model: ${modelVersion} / ${runKind}`,
    reasons.length > 0 ? `理由: ${reasons.join(" / ")}` : "理由: なし",
    warnings.length > 0 ? `警告: ${warnings.join(" / ")}` : "警告: なし",
    `公式オッズ: ${officialOddsUrl}`,
    voteUrl ? `投票サイト: ${voteUrl}` : null,
    "",
    "※paper検証候補。自動投票なし。公式オッズと締切を確認して手動で判断してください。",
  ].filter((line): line is string => line != null).join("\n");

  return {
    schemaVersion: BUY_LINE_MESSAGE_SCHEMA_VERSION,
    dedupeKey: `buy:${decisionId}`,
    title: `🎯 BUY候補: ${venue} ${input.raceNo}R`,
    body,
    freshness: { observedAt, closeAtJst },
  };
}
