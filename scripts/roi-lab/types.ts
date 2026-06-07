export type BetAction = "NO_BUY" | "SINGLE" | "REVERSE" | "FLOW" | "BOX" | "PAPER_ONLY";

export type LabRow = {
  id: number;
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  selection: string;
  result: string;
  boats: number[];
  resultBoats: number[];
  odds: number;
  hit: boolean;
  confidence: number | null;
  edge: number | null;
  popularity: number | null;
  wind: number | null;
  wave: number | null;
  weatherPresent: boolean;
  headMotor: number | null;
  headBoat: number | null;
  headExRank: number | null;
  headExSt: number | null;
  raceFCount: number;
  headF: number;
  selectedF: number;
  selectedParts: number;
  selectedExRankSpread: number | null;
  selectedExTop3Overlap: number;
};

export type TicketResult = {
  stake: number;
  ret: number;
  hit: boolean;
  hitOdds: number;
};

export type Metric = {
  n: number;
  hits: number;
  hitRate: number;
  stake: number;
  ret: number;
  roi: number;
  maxHitOdds: number;
  roiExMaxHit: number;
};

export type LabRule = {
  label: string;
  family: string;
  action: BetAction;
  predicate: (row: LabRow) => boolean;
  tickets: (row: LabRow, raceOdds: Map<string, number>) => string[];
};

export type LabEvaluation = {
  label: string;
  family: string;
  action: BetAction;
  baseline: Metric;
  after: Metric;
  removed: Metric;
  improvement: number;
  train: Metric;
  validation: Metric;
  test: Metric;
  warnings: string[];
  judgement: "S" | "A" | "B" | "C" | "D";
};
