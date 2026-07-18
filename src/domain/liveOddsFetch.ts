export type RaceIdentity = { raceId: string };

/** 同一レースの全候補を、オッズHTML取得1回分へ集約する。 */
export function uniqueRaceRows<T extends { candidate: RaceIdentity }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (seen.has(row.candidate.raceId)) return false;
    seen.add(row.candidate.raceId);
    return true;
  });
}

export function isScheduledCollectionHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? -1);
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? -1);
  return hour >= 9 && (hour < 21 || (hour === 21 && minute <= 5));
}
