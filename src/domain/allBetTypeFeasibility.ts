export const ALL_BET_TYPES = [
  "win",
  "place",
  "exacta",
  "quinella",
  "wide",
  "trifecta",
  "trio",
] as const;

export type AllBetType = (typeof ALL_BET_TYPES)[number];
export type FeasibilityDecision = "GO" | "CONDITIONAL" | "BLOCKED" | "UNKNOWN";

export type BetTypeContract = {
  betType: AllBetType;
  japaneseName: string;
  officialOddsPath: "oddstf" | "odds2tf" | "oddsk" | "odds3t" | "odds3f";
  expectedSelectionsForSixBoats: number;
  oddsValueKind: "point" | "range";
};

export const BET_TYPE_CONTRACTS: readonly BetTypeContract[] = [
  { betType: "win", japaneseName: "単勝", officialOddsPath: "oddstf", expectedSelectionsForSixBoats: 6, oddsValueKind: "point" },
  { betType: "place", japaneseName: "複勝", officialOddsPath: "oddstf", expectedSelectionsForSixBoats: 6, oddsValueKind: "range" },
  { betType: "exacta", japaneseName: "2連単", officialOddsPath: "odds2tf", expectedSelectionsForSixBoats: 30, oddsValueKind: "point" },
  { betType: "quinella", japaneseName: "2連複", officialOddsPath: "odds2tf", expectedSelectionsForSixBoats: 15, oddsValueKind: "point" },
  { betType: "wide", japaneseName: "拡連複", officialOddsPath: "oddsk", expectedSelectionsForSixBoats: 15, oddsValueKind: "range" },
  { betType: "trifecta", japaneseName: "3連単", officialOddsPath: "odds3t", expectedSelectionsForSixBoats: 120, oddsValueKind: "point" },
  { betType: "trio", japaneseName: "3連複", officialOddsPath: "odds3f", expectedSelectionsForSixBoats: 20, oddsValueKind: "point" },
] as const;

export type RequestBudgetScenario = {
  name: string;
  racesPerDay: number;
  checkpointsPerRace: number;
  pagesPerCheckpoint: number;
  resultPagesPerRace: number;
  requestsPerDay: number;
  minimumAverageIntervalSeconds: number;
};

export function buildRequestBudgetScenario(input: Omit<RequestBudgetScenario, "requestsPerDay" | "minimumAverageIntervalSeconds">): RequestBudgetScenario {
  for (const [key, value] of Object.entries(input)) {
    if (key === "name") continue;
    if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${key} must be a non-negative integer`);
  }
  const requestsPerDay =
    input.racesPerDay * (input.checkpointsPerRace * input.pagesPerCheckpoint + input.resultPagesPerRace);
  return {
    ...input,
    requestsPerDay,
    minimumAverageIntervalSeconds: requestsPerDay > 0 ? 86_400 / requestsPerDay : 0,
  };
}

export function officialRaceUrl(path: BetTypeContract["officialOddsPath"] | "beforeinfo" | "raceresult", race: {
  date: string;
  venueCode: string;
  raceNo: number;
}): string {
  const hd = race.date.replaceAll("-", "");
  return `https://www.boatrace.jp/owpc/pc/race/${path}?hd=${hd}&jcd=${race.venueCode.padStart(2, "0")}&rno=${race.raceNo}`;
}

/** Phase N0のsource構造監査専用。払戻値をproduction形式へparseしない。 */
export function detectOfficialPayoutLabels(text: string): AllBetType[] {
  const normalized = text.normalize("NFKC");
  return BET_TYPE_CONTRACTS
    .filter((contract) => normalized.includes(contract.japaneseName.normalize("NFKC")))
    .map((contract) => contract.betType);
}
