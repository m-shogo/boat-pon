import type { BoatFeature } from "./programFeatures";

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
  featureAdjustment?: number;
  candidateClassName?: string;
  candidateMotorTop2Rate?: number | null;
  candidateBoatTop2Rate?: number | null;
  firstBoatFeature?: BoatFeature;
  secondBoatFeature?: BoatFeature;
  thirdBoatFeature?: BoatFeature;
};

export type BudgetRule = {
  dailyBudgetYen: number;
  stakePerBetYen: number;
  maxStakePerRaceYen: number;
  maxBuyCountPerDay: number;
  minSampleSize: number;
  minMinutesBeforeClose: number;
  targetEv: number;
  maxOdds?: number;
  maxOddsRatio?: number;
  minOddsRatio?: number;
  minRequiredOdds?: number;
  maxRequiredOdds?: number;
  marketBlendWeight?: number;
  calibrationMode?: "none" | "v3-empirical";
  calibrationBasis?: "requiredOdds" | "currentOdds";
  oddsCalibrationFactors?: OddsCalibrationFactor[];
  programFilter?: ProgramFilterRule;
  excludedVenues?: string[];
  excludedRaceNos?: number[];
};

export type OddsCalibrationFactor = {
  maxRequiredOdds: number;
  factor: number;
};

export type ProgramFilterRule = {
  allowedClassNames?: string[];
  maxMotorTop2Rate?: number;
  maxBoatTop2Rate?: number;
  excludedSecondBoatClassNames?: string[];
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
