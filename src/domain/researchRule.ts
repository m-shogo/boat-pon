export type RuleStatus =
  | "candidate"
  | "backtest"
  | "forward"
  | "review"
  | "approved"
  | "production"
  | "deprecated"
  | "archived";

export type ResearchRule = {
  ruleId: string;
  status: RuleStatus;
  createdAt: string;
  updatedAt: string;
  reasonSummary: string;
  warnings: string[];
  title?: string;
};

export type EvaluationMetadata = {
  dataWindowStart: string;
  dataWindowEnd: string;
  evaluationRunAt: string;
  sampleSize: number;
};

export type RuleEvaluationResult = {
  ruleId: string;
  metadata: EvaluationMetadata;
  hitRate: number;
  roi: number;
  confidence: number;
  maxDrawdown: number;
  isForwardTested: boolean;
  isProductionEligible: boolean;
  reasonSummary: string;
  warnings: string[];
};

export type ForwardTestResult = RuleEvaluationResult & {
  isForwardTested: true;
};
