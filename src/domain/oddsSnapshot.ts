export type OddsSnapshot = {
  raceId: string;
  selection: string;
  odds: number;
  popularity: number | null;
  source: "manual" | "official" | "official-early" | "kyotei24" | "import";
  capturedAt: string;
  isFinalLike: boolean;
};

export function latestOddsByRaceId(snapshots: OddsSnapshot[]): Map<string, number> {
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const map = new Map<string, number>();
  for (const row of sorted) map.set(row.raceId, row.odds);
  return map;
}

export function mergeOddsMaps(base: Map<string, number>, snapshots: OddsSnapshot[]): Map<string, number> {
  const merged = new Map(base);
  for (const [raceId, odds] of latestOddsByRaceId(snapshots)) {
    if (!merged.has(raceId)) merged.set(raceId, odds);
  }
  return merged;
}

export function filterCandidateSnapshots(snapshots: OddsSnapshot[], raceIds: Set<string>) {
  return snapshots.filter((row) => raceIds.has(row.raceId));
}
