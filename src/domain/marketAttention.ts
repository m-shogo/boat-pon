export type ScheduledRace = { raceId: string; venue: string; raceNo: number; closeAt: string };

export function parseCloseMinute(closeAt: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(closeAt);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

/** parserの会場切替誤認を避けるため、1〜12Rと時刻単調増加を要求する。 */
export function isCompleteVenueDay(rows: ScheduledRace[]): boolean {
  if (rows.length !== 12 || new Set(rows.map((row) => row.raceNo)).size !== 12) return false;
  const sorted = [...rows].sort((a, b) => a.raceNo - b.raceNo);
  if (sorted.some((row, index) => row.raceNo !== index + 1)) return false;
  const minutes = sorted.map((row) => parseCloseMinute(row.closeAt));
  return minutes.every((minute): minute is number => minute != null) && minutes.every((minute, index) => index === 0 || minute > minutes[index - 1]!);
}

export function attentionContext(target: ScheduledRace, validDayRows: ScheduledRace[]) {
  const minute = parseCloseMinute(target.closeAt);
  if (minute == null) return null;
  const others = validDayRows.filter((row) => row.raceId !== target.raceId).map((row) => ({ row, minute: parseCloseMinute(row.closeAt) })).filter((x): x is {row:ScheduledRace;minute:number} => x.minute != null);
  const gaps = others.map((x) => Math.abs(x.minute - minute));
  return {
    minute,
    activeVenues: new Set(validDayRows.map((row) => row.venue)).size,
    totalRaces: validDayRows.length,
    otherWithin2: gaps.filter((gap) => gap <= 2).length,
    otherWithin5: gaps.filter((gap) => gap <= 5).length,
    nearestOtherMinutes: gaps.length ? Math.min(...gaps) : null,
    sameRoundWithin5: others.some((x) => x.row.raceNo === target.raceNo && Math.abs(x.minute - minute) <= 5),
  };
}
