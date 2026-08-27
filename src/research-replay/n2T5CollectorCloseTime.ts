export function n2T5CollectorCloseTime(date: string, closeAt: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(closeAt);
  if (!dateMatch || !timeMatch) {
    throw new Error(`N2_T5_COLLECTOR_CLOSE_AT_INVALID:${date}:${closeAt}`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    throw new Error(`N2_T5_COLLECTOR_CLOSE_AT_INVALID:${date}:${closeAt}`);
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`N2_T5_COLLECTOR_CLOSE_AT_INVALID:${date}:${closeAt}`);
  }

  const parsed = new Date(`${date}T${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3] ?? "00"}+09:00`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`N2_T5_COLLECTOR_CLOSE_AT_INVALID:${date}:${closeAt}`);
  }
  return parsed;
}
