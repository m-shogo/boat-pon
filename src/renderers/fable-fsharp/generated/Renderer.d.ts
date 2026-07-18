export type FableOpportunityView = {
  score: number;
  scoreLabel: string;
  riskLevel: string;
  riskColor: string;
  summary: string;
  warningsCount: number;
};

export type FableHypothesisCard = {
  id: string;
  name: string;
  description: string;
  status: string;
  priority: number;
  adoptionAllowed: boolean;
  adoptionBlockReason?: string;
  nextAction?: string;
  gateStatus?: Record<string, boolean | null>;
  lastKnownMetrics?: Record<string, unknown>;
  dataReadiness?: Record<string, unknown>;
  requiredData?: string[];
  nextReviewTrigger?: string;
  tone: "eligible" | "muted" | "watch" | "research";
};

export type FableHypothesisBoard = {
  cards: FableHypothesisCard[];
  summary: {
    total: number;
    adoptionAllowed: number;
    blocked: number;
    monitoring: number;
    rejected: number;
  };
};

export type FableLiveCandidateHealth = {
  candidateRows: number;
  racePrograms: number;
  rowsPerRace: number;
  hasMultiplicity: boolean;
  tone: "attention" | "ok";
};

export function renderOpportunity(
  opportunity: { score: number; scoreLabel: string; riskLevel: string; summary: string },
  warningsCount: number,
): FableOpportunityView;

export function renderHypothesisBoard(registry: { hypotheses: object[] }): FableHypothesisBoard;
export function renderLiveCandidateHealth(health: { candidateRows: number; racePrograms: number }): FableLiveCandidateHealth;
