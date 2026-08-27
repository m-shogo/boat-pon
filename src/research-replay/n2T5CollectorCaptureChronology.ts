import { canonicalUtcTimestamp } from "./canonical";
import { n2T5CollectorCloseTime } from "./n2T5CollectorCloseTime";

export type N2T5CollectorCaptureTimingRow = {
  race_id: string;
  date: string;
  close_at: string;
  captured_at: string;
  minutes_before_close: number;
};

export function validateN2T5CollectorCaptureChronology(
  rows: readonly N2T5CollectorCaptureTimingRow[],
): void {
  for (const row of rows) {
    if (!Number.isInteger(row.minutes_before_close) || row.minutes_before_close < 0 || row.minutes_before_close > 10) {
      throw new Error(`N2_T5_COLLECTOR_CAPTURE_TIMING_INVALID:${row.race_id}`);
    }

    let capturedAt: Date;
    try {
      capturedAt = new Date(canonicalUtcTimestamp(row.captured_at));
    } catch {
      throw new Error(`N2_T5_COLLECTOR_CAPTURE_AT_INVALID:${row.race_id}`);
    }
    const closeAt = n2T5CollectorCloseTime(row.date, row.close_at);
    const actualMinutesBeforeClose = (closeAt.getTime() - capturedAt.getTime()) / 60_000;
    if (
      actualMinutesBeforeClose < 0
      || actualMinutesBeforeClose > 10
      || Math.round(actualMinutesBeforeClose) !== row.minutes_before_close
    ) {
      throw new Error(`N2_T5_COLLECTOR_CAPTURE_CHRONOLOGY_MISMATCH:${row.race_id}`);
    }
  }
}
