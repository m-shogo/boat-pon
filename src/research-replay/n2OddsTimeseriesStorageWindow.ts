export type N2OddsTimeseriesStorageWindow = {
  from: string;
  to: string;
  dates: string[];
};

function parseCanonicalDate(value: string, label: "FROM" | "TO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`N2_ODDS_STORAGE_${label}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`N2_ODDS_STORAGE_${label}_INVALID:${value}`);
  }
  return value;
}

function addUtcDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, "0"),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function resolveN2OddsTimeseriesStorageWindow(fromRaw: string, toRaw: string): N2OddsTimeseriesStorageWindow {
  const from = parseCanonicalDate(fromRaw, "FROM");
  const to = parseCanonicalDate(toRaw, "TO");
  if (from > to) throw new Error(`N2_ODDS_STORAGE_WINDOW_REVERSED:${from}:${to}`);

  const dates: string[] = [];
  for (let date = from; ; date = addUtcDay(date)) {
    dates.push(date);
    if (date === to) break;
  }
  return { from, to, dates };
}
