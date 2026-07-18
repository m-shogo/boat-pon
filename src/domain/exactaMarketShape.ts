export type ExactaOdds = { combination: string; odds: number };

export type ExactaMarketShape = {
  probabilities: Map<string, number>;
  ranks: Map<string, number>;
  firstCourseMass: Map<string, number>;
  effectiveSelections: number;
  overround: number;
};

/** 全30通りのclosing oddsを同一レース内で比較する研究用market shape。 */
export function buildExactaMarketShape(rows: ExactaOdds[]): ExactaMarketShape | null {
  const valid = rows.filter((row) => /^([1-6])-([1-6])$/.test(row.combination) && row.odds > 0 && Number.isFinite(row.odds));
  if (valid.length !== 30 || new Set(valid.map((row) => row.combination)).size !== 30) return null;
  const overround = valid.reduce((sum, row) => sum + 1 / row.odds, 0);
  if (!(overround > 0)) return null;
  const probabilities = new Map(valid.map((row) => [row.combination, (1 / row.odds) / overround]));
  const sorted = [...probabilities].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const ranks = new Map(sorted.map(([combination], index) => [combination, index + 1]));
  const firstCourseMass = new Map<string, number>();
  for (const [combination, probability] of probabilities) {
    const first = combination[0];
    firstCourseMass.set(first, (firstCourseMass.get(first) ?? 0) + probability);
  }
  const hhi = [...probabilities.values()].reduce((sum, probability) => sum + probability ** 2, 0);
  return { probabilities, ranks, firstCourseMass, effectiveSelections: 1 / hhi, overround };
}

/** 同じ1着艇の隣接する2着艇に対する、対象買い目の正規化確率比。 */
export function adjacentSecondRatio(shape: ExactaMarketShape, combination: string): number | null {
  const [first, secondText] = combination.split("-");
  const second = Number(secondText);
  const current = shape.probabilities.get(combination);
  if (!first || current == null || !Number.isInteger(second)) return null;
  const neighbors = [second - 1, second + 1]
    .filter((course) => course >= 1 && course <= 6 && course !== Number(first))
    .map((course) => shape.probabilities.get(`${first}-${course}`))
    .filter((value): value is number => value != null);
  if (!neighbors.length) return null;
  return current / (neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length);
}
