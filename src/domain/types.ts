export type DecisionStatus = "BUY" | "WATCH" | "SKIP";

export type BetCandidate = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt: string;
  betType: "3連単" | "3連複" | "2連単" | "2連複";
  selection: number[];
  estimatedHitRate: number;
  sampleSize: number;
  currentOdds: number | null;
  targetEv: number;
  suggestedAmount: number;
  source: string;
  fetchedAt: string;
  hasRiskFlag?: boolean;
  notified?: boolean;
  modelVersion?: string;
  raceCategory?: string;
  environmentRiskLevel?: "low" | "medium" | "high";
  environmentRiskReasons?: string[];
};

export type BudgetRule = {
  dailyBudgetYen: number;
  stakePerBetYen: number;
  maxStakePerRaceYen: number;
  maxBuyCountPerDay: number;
  minSampleSize: number;
  minMinutesBeforeClose: number;
  targetEv: number;
};

export type Decision = {
  status: DecisionStatus;
  requiredOdds: number;
  ev: number | null;
  recommendedAmount: number;
  reasons: string[];
};

export type RaceResult = {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  trifecta: string | null;
  payoutYen: number | null;
  popularity: number | null;
  returned: boolean;
  source: string;
  fetchedAt: string;
};
