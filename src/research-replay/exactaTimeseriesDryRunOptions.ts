export const EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5", "ad-hoc"] as const;
export type ExactaTimeseriesDryRunCheckpoint = typeof EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS[number];

export type ExactaTimeseriesDryRunOptions = {
  date: string;
  venue: string;
  raceNo: number;
  checkpoint: ExactaTimeseriesDryRunCheckpoint;
  minutesBeforeClose: number | null;
};

const OPTION_NAMES = ["--date", "--venue", "--race", "--checkpoint", "--minutes-before-close"] as const;
type OptionName = typeof OPTION_NAMES[number];

function parseValues(argv: readonly string[]): Map<OptionName, string> {
  const allowed: ReadonlySet<string> = new Set(OPTION_NAMES);
  const normalized = argv.filter((value) => value !== "--");
  const values = new Map<OptionName, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    if (!allowed.has(name)) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_INVALID:${name}`);
    const optionName = name as OptionName;
    if (values.has(optionName)) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_DUPLICATE:${name}`);
    const value = normalized[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`EXACTA_TIMESERIES_DRY_RUN_ARGUMENT_MISSING:${name}`);
    }
    values.set(optionName, value);
  }
  return values;
}

function requireCanonicalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_DATE_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`EXACTA_TIMESERIES_DRY_RUN_DATE_INVALID:${value}`);
  }
  return value;
}

function requireRaceNo(value: string): number {
  if (!/^(?:[1-9]|1[0-2])$/u.test(value)) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_RACE_INVALID:${value}`);
  return Number(value);
}

function parseMinutes(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (value.trim() !== value || value === "") throw new Error(`EXACTA_TIMESERIES_DRY_RUN_MINUTES_INVALID:${value}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_MINUTES_INVALID:${value}`);
  return parsed;
}

export function parseExactaTimeseriesDryRunOptions(
  argv: readonly string[],
  allowedVenues: ReadonlySet<string>,
): ExactaTimeseriesDryRunOptions {
  const values = parseValues(argv);
  const rawDate = values.get("--date");
  if (rawDate === undefined) throw new Error("EXACTA_TIMESERIES_DRY_RUN_DATE_REQUIRED");
  const date = requireCanonicalDate(rawDate);

  const venue = values.get("--venue");
  if (venue === undefined) throw new Error("EXACTA_TIMESERIES_DRY_RUN_VENUE_REQUIRED");
  if (!allowedVenues.has(venue)) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_VENUE_INVALID:${venue}`);

  const rawRaceNo = values.get("--race");
  if (rawRaceNo === undefined) throw new Error("EXACTA_TIMESERIES_DRY_RUN_RACE_REQUIRED");
  const raceNo = requireRaceNo(rawRaceNo);

  const checkpointRaw = values.get("--checkpoint") ?? "ad-hoc";
  const allowedCheckpoints: ReadonlySet<string> = new Set(EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS);
  if (!allowedCheckpoints.has(checkpointRaw)) {
    throw new Error(`EXACTA_TIMESERIES_DRY_RUN_CHECKPOINT_INVALID:${checkpointRaw}`);
  }

  const minutesBeforeClose = parseMinutes(values.get("--minutes-before-close"));
  return {
    date,
    venue,
    raceNo,
    checkpoint: checkpointRaw as ExactaTimeseriesDryRunCheckpoint,
    minutesBeforeClose,
  };
}
