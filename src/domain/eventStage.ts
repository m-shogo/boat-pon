function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function parseEventStartDate(href: string): string | null {
  const match = href.match(/resultRace-(\d{4})(\d{2})(\d{2})\.html/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isCalendarDate(date) ? date : null;
}

export function eventDayIndex(raceDate: string, startDate: string | null): number | null {
  if (!startDate || !isCalendarDate(raceDate) || !isCalendarDate(startDate)) return null;
  const race = Date.parse(`${raceDate}T00:00:00Z`);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const index = Math.floor((race - start) / 86_400_000) + 1;
  return index >= 1 && index <= 10 ? index : null;
}
