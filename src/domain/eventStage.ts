export function parseEventStartDate(href: string): string | null {
  const match = href.match(/resultRace-(\d{4})(\d{2})(\d{2})\.html/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function eventDayIndex(raceDate: string, startDate: string | null): number | null {
  if (!startDate) return null;
  const race = Date.parse(`${raceDate}T00:00:00Z`);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(race) || Number.isNaN(start)) return null;
  const index = Math.floor((race - start) / 86_400_000) + 1;
  return index >= 1 && index <= 10 ? index : null;
}
