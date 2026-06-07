import type { LabRule } from "./types.js";
import { headFixedFlow, oddsFiltered, reverseSecondThird, top3Box } from "./bet-selector.js";

const noBuy = (label: string, family: string, predicate: LabRule["predicate"]): LabRule => ({
  label,
  family,
  action: "NO_BUY",
  predicate,
  tickets: (row) => [row.selection],
});

const strategy = (
  label: string,
  family: string,
  action: LabRule["action"],
  predicate: LabRule["predicate"],
  tickets: LabRule["tickets"],
): LabRule => ({ label, family, action, predicate, tickets });

export function buildLabRules(): LabRule[] {
  return [
    noBuy("odds >= 50", "market", (row) => row.odds >= 50),
    noBuy("odds >= 80", "market", (row) => row.odds >= 80),
    noBuy("low confidence high odds", "market", (row) => (row.confidence ?? 1) < 0.06 && row.odds >= 50),
    noBuy("thin edge", "market", (row) => (row.edge ?? 99) < 0.02),
    noBuy("thin edge high odds", "market", (row) => (row.edge ?? 99) < 0.05 && row.odds >= 50),
    noBuy("head not 1 high odds", "head-market", (row) => row.boats[0] !== 1 && row.odds >= 50),
    noBuy("outer head high odds", "head-market", (row) => row.boats[0] >= 4 && row.odds >= 30),
    noBuy("race F >= 2", "f-risk", (row) => row.raceFCount >= 2),
    noBuy("head F", "f-risk", (row) => row.headF > 0),
    noBuy("selected F >= 1", "f-risk", (row) => row.selectedF >= 1),
    noBuy("selected F >= 2", "f-risk", (row) => row.selectedF >= 2),
    noBuy("head F and exhibition ST slow", "f-exhibition", (row) => row.headF > 0 && (row.headExSt ?? -1) >= 0.15),
    noBuy("race F >= 2 and wind >= 5", "f-weather", (row) => row.raceFCount >= 2 && (row.wind ?? -1) >= 5),
    noBuy("motor high exhibition low", "motor-exhibition", (row) => (row.headMotor ?? -1) >= 50 && (row.headExRank ?? 99) >= 4),
    noBuy("motor high high odds", "motor-market", (row) => (row.headMotor ?? -1) >= 50 && row.odds >= 50),
    noBuy("motor low high odds", "motor-market", (row) => row.headMotor != null && row.headMotor < 25 && row.odds >= 30),
    noBuy("head exhibition rank >= 4", "exhibition", (row) => (row.headExRank ?? 99) >= 4),
    noBuy("selected exhibition top3 overlap <= 1", "exhibition", (row) => row.selectedExTop3Overlap <= 1),
    noBuy("selected exhibition order uncertain high odds", "exhibition-market", (row) => row.selectedExRankSpread != null && row.selectedExRankSpread <= 2 && row.odds >= 50),
    noBuy("wind >= 5", "weather", (row) => (row.wind ?? -1) >= 5),
    noBuy("wave >= 5", "weather", (row) => (row.wave ?? -1) >= 5),
    noBuy("wind >= 5 and wave >= 5", "weather", (row) => (row.wind ?? -1) >= 5 && (row.wave ?? -1) >= 5),
    noBuy("weather missing", "data-quality", (row) => !row.weatherPresent),
    noBuy("10R", "race-no", (row) => row.raceNo === 10),
    noBuy("11R", "race-no", (row) => row.raceNo === 11),
    noBuy("10R or 11R", "race-no", (row) => row.raceNo === 10 || row.raceNo === 11),
    strategy("reverse second-third when order uncertain", "bet-selector", "REVERSE", (row) => row.selectedExRankSpread != null && row.selectedExRankSpread <= 2 && row.odds >= 20, (row) => reverseSecondThird(row)),
    strategy("reverse second-third high odds", "bet-selector", "REVERSE", (row) => row.odds >= 40, (row) => reverseSecondThird(row)),
    strategy("head fixed limited flow", "bet-selector", "FLOW", (row) => (row.headExRank ?? 99) <= 2 && (row.confidence ?? 0) >= 0.06 && row.odds >= 30, (row, raceOdds) => oddsFiltered(headFixedFlow(row, 6), raceOdds, row.selection, row.odds, 5)),
    strategy("head fixed limited flow odds>=8", "bet-selector", "FLOW", (row) => (row.headExRank ?? 99) <= 2 && row.odds >= 30, (row, raceOdds) => oddsFiltered(headFixedFlow(row, 6), raceOdds, row.selection, row.odds, 8)),
    strategy("top3 box order mismatch", "bet-selector", "BOX", (row) => row.selectedExTop3Overlap >= 3 && row.selectedExRankSpread != null && row.selectedExRankSpread <= 2 && row.odds >= 30, (row) => top3Box(row)),
    strategy("paper only high risk signal", "paper", "PAPER_ONLY", (row) => ((row.edge ?? 99) < 0.02 || row.selectedF >= 1) && row.odds >= 50, (row) => [row.selection]),
  ];
}
