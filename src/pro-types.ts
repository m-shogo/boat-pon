// alpha-pon Pro視点の構造化型
// 注意: 買い推奨ではなく、調査品質・保留判断・反証管理のための型。

export type ProFinalLabel = "調査候補" | "保留" | "証拠不足" | "避ける";

export type BuffettQualitySnapshot = {
  code: string;
  name: string;
  asOf: string;
  roe5yAvg: number | null;
  roic5yAvg: number | null;
  operatingMargin5yAvg: number | null;
  operatingMarginStability: "stable" | "volatile" | "unknown";
  fcfPositiveYears5y: number | null;
  fcfMargin5yAvg: number | null;
  equityRatio: number | null;
  netDebtToEbitda: number | null;
  dilutionRisk: "low" | "middle" | "high" | "unknown";
  pricingPowerEvidence: string[];
  moatEvidence: string[];
  qualityLabel: "compounder" | "good_business" | "cyclical_quality" | "fragile" | "unknown";
  missingData: string[];
};

export type ValuationSnapshot = {
  code: string;
  name: string;
  asOf: string;
  per: number | null;
  pbr: number | null;
  psr: number | null;
  evEbitda: number | null;
  dividendYield: number | null;
  perPercentile5y: number | null;
  pbrPercentile5y: number | null;
  peerPerMedian: number | null;
  peerPbrMedian: number | null;
  growthAdjustedValuation: "reasonable" | "expensive_but_growth" | "too_expensive" | "cheap_but_reason" | "unknown";
  valuationRisks: string[];
  missingData: string[];
};

export type IrEventEvidence = {
  code: string;
  name: string;
  eventType:
    | "earnings"
    | "guidance_revision"
    | "buyback"
    | "dividend"
    | "capital_policy"
    | "shareholder_meeting"
    | "medium_term_plan"
    | "offering"
    | "tob"
    | "risk_disclosure"
    | "unknown";
  title: string;
  publishedAt: string | null;
  eventDate: string | null;
  sourceUrl: string | null;
  sourceStatus: "confirmed" | "official_check_required" | "missing";
  impact: "positive" | "neutral" | "negative" | "unknown";
  confidence: number;
  notes: string[];
};

export type MissReason =
  | "already_priced_in"
  | "theme_right_company_wrong"
  | "theme_right_timing_wrong"
  | "profit_not_connected"
  | "valuation_too_high"
  | "liquidity_bad"
  | "earnings_miss"
  | "guidance_weak"
  | "macro_headwind"
  | "better_peer_exists"
  | "data_quality_bad";

export type AgentVerdict = {
  agentId: string;
  label: string;
  stance: ProFinalLabel;
  confidence: number;
  positiveEvidence: string[];
  negativeEvidence: string[];
  missingEvidence: string[];
  blockerReasons: string[];
  scoreContribution: {
    businessQuality?: number;
    valuation?: number;
    timing?: number;
    evidenceQuality?: number;
    riskPenalty?: number;
  };
};

export type StockProScore = {
  code: string;
  name: string;
  businessQualityScore: number;
  valuationScore: number;
  timingScore: number;
  evidenceQualityScore: number;
  riskPenalty: number;
  finalScore: number;
  finalLabel: ProFinalLabel;
  blockers: string[];
  missingEvidence: string[];
};

export type CommitteeDecision = {
  code: string;
  name: string;
  finalLabel: ProFinalLabel;
  finalScore: number;
  proScore: StockProScore;
  verdicts: AgentVerdict[];
  nextActions: string[];
  blockers: string[];
  missingEvidence: string[];
};
