/**
 * Shared v0.2 claimed-instant shape and ordering rules.
 * Extracted unchanged from authority metadata preflight to prevent the
 * standalone untrusted request transcript from drifting on calendar, offset,
 * submillisecond chronology or hour-24 admission. Caller times are claims,
 * not authenticated clock evidence or production/scoring authority.
 */
export function validForwardV02ClaimedInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!m || value.endsWith("-00:00")) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
    hour <= 23 && minute <= 59 && second <= 59 && Number(m[7] ?? 0) <= 23 &&
    Number(m[8] ?? 0) <= 59 && Number.isFinite(Date.parse(value));
}
// Date.parse truncates submilliseconds; retain fractional precision for ordering.
export function compareForwardV02ClaimedInstants(left: string, right: string): number {
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const l = Date.parse(left.replace(fraction, ""));
  const r = Date.parse(right.replace(fraction, ""));
  if (l !== r) return l < r ? -1 : 1;
  const a = fraction.exec(left)?.[1] ?? "";
  const b = fraction.exec(right)?.[1] ?? "";
  const width = Math.max(a.length, b.length);
  const x = a.padEnd(width, "0"), y = b.padEnd(width, "0");
  return x < y ? -1 : x > y ? 1 : 0;
}
