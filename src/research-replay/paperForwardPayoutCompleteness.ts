export type PaperForwardPayoutCompleteness = {
  totalRaces: number;
  coveredRaces: number;
  missingRaces: number;
  coverageRate: number;
  complete: boolean;
};

export function evaluatePaperForwardPayoutCompleteness(
  totalRaces: number,
  coveredRaces: number,
): PaperForwardPayoutCompleteness {
  if (!Number.isInteger(totalRaces) || totalRaces < 0) {
    throw new Error(`invalid totalRaces: ${totalRaces}`);
  }
  if (!Number.isInteger(coveredRaces) || coveredRaces < 0 || coveredRaces > totalRaces) {
    throw new Error(`invalid coveredRaces: ${coveredRaces}`);
  }

  const missingRaces = totalRaces - coveredRaces;
  const coverageRate = totalRaces === 0
    ? 0
    : Math.round((coveredRaces / totalRaces) * 10000) / 100;

  return {
    totalRaces,
    coveredRaces,
    missingRaces,
    coverageRate,
    complete: totalRaces > 0 && missingRaces === 0,
  };
}
