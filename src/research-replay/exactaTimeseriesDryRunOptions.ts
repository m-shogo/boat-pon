export const EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS = ["T-30", "T-20", "T-10", "T-5", "ad-hoc"] as const;
export type ExactaTimeseriesDryRunCheckpoint = typeof EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS[number];

export type ExactaTimeseriesDryRunOptions = {
  date: string;
  venue: string;
  raceNo: number;
  checkpoint: ExactaTimeseriesDryRunCheckpoint;
  minutesBeforeClose: number | null;
};

function valueAfter(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
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

function parseMinutes(value: string | null): number | null {
  if (value === null) return null;
  if (value.trim() !== value || value === "") throw new Error(`EXACTA_TIMESERIES_DRY_RUN_MINUTES_INVALID:${value}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_MINUTES_INVALID:${value}`);
  return parsed;
}

export function parseExactaTimeseriesDryRunOptions(
  argv: readonly string[],
  allowedVenues: ReadonlySet<string>,
): ExactaTimeseriesDryRunOptions {
  const rawDate = valueAfter(argv, "--date");
  if (rawDate === null) throw new Error("EXACTA_TIMESERIES_DRY_RUN_DATE_REQUIRED");
  const date = requireCanonicalDate(rawDate);

  const venue = valueAfter(argv, "--venue");
  if (venue === null) throw new Error("EXACTA_TIMESERIES_DRY_RUN_VENUE_REQUIRED");
  if (!allowedVenues.has(venue)) throw new Error(`EXACTA_TIMESERIES_DRY_RUN_VENUE_INVALID:${venue}`);

  const rawRaceNo = valueAfter(argv, "--race");
  if (rawRaceNo === null) throw new Error("EXACTA_TIMESERIES_DRY_RUN_RACE_REQUIRED");
  const raceNo = requireRaceNo(rawRaceNo);

  const checkpointProvided = argv.includes("--checkpoint");
  const checkpointValue = valueAfter(argv, "--checkpoint");
  if (checkpointProvided && checkpointValue === null) {
    throw new Error("EXACTA_TIMESERIES_DRY_RUN_CHECKPOINT_MISSING");
  }
  const checkpointRaw = checkpointValue ?? "ad-hoc";
  const allowedCheckpoints: ReadonlySet<string> = new Set(EXACTA_TIMESERIES_DRY_RUN_CHECKPOINTS);
  if (!allowedCheckpoints.has(checkpointRaw)) {
    throw new Error(`EXACTA_TIMESERIES_DRY_RUN_CHECKPOINT_INVALID:${checkpointRaw}`);
  }

  const minutesProvided = argv.includes("--minutes-before-close");
  const minutesValue = valueAfter(argv, "--minutes-before-close");
  if (minutesProvided && minutesValue === null) {
    throw new Error("EXACTA_TIMESERIES_DRY_RUN_MINUTES_MISSING");
  }
  const minutesBeforeClose = parseMinutes(minutesValue);
  return {
    date,
    venue,
    raceNo,
    checkpoint: checkpointRaw as ExactaTimeseriesDryRunCheckpoint,
    minutesBeforeClose,
  };
}
