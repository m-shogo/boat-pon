export type OfficialProgramInventoryRow = {
  date: string;
  venue: string;
  raceNo: number;
};

export type OfficialProgramDayInventory = {
  date: string;
  totalRows: number;
  venueCount: number;
  completeVenueCount: number;
  incompleteVenues: Array<{
    venue: string;
    raceNos: number[];
    missingRaceNos: number[];
  }>;
  structurallyComplete: boolean;
};

export function parseForcedProgramRefreshDates(value: string | undefined): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item)),
  );
}

export function shouldSkipOfficialProgramDate(input: {
  date: string;
  skipExisting: boolean;
  existingDates: ReadonlySet<string>;
  forcedRefreshDates: ReadonlySet<string>;
}): boolean {
  if (input.forcedRefreshDates.has(input.date)) return false;
  return input.skipExisting && input.existingDates.has(input.date);
}

export function summarizeOfficialProgramDayInventory(
  date: string,
  rows: OfficialProgramInventoryRow[],
): OfficialProgramDayInventory {
  const byVenue = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.date !== date || !row.venue.trim()) continue;
    if (!Number.isSafeInteger(row.raceNo) || row.raceNo < 1 || row.raceNo > 12) continue;
    const raceNos = byVenue.get(row.venue) ?? new Set<number>();
    raceNos.add(row.raceNo);
    byVenue.set(row.venue, raceNos);
  }

  const incompleteVenues = [...byVenue.entries()]
    .map(([venue, raceNos]) => {
      const ordered = [...raceNos].sort((a, b) => a - b);
      const missingRaceNos = Array.from({ length: 12 }, (_, index) => index + 1)
        .filter((raceNo) => !raceNos.has(raceNo));
      return { venue, raceNos: ordered, missingRaceNos };
    })
    .filter((entry) => entry.missingRaceNos.length > 0)
    .sort((a, b) => a.venue.localeCompare(b.venue, "ja"));

  return {
    date,
    totalRows: rows.filter((row) => row.date === date).length,
    venueCount: byVenue.size,
    completeVenueCount: byVenue.size - incompleteVenues.length,
    incompleteVenues,
    structurallyComplete: byVenue.size > 0 && incompleteVenues.length === 0,
  };
}
