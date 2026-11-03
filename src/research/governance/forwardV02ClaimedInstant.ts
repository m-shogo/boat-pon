/**
 * Shared v0.2 claimed-instant shape and ordering rules.
 * Caller times are claims, not authenticated clock evidence or production/scoring authority.
 * Pin the fixed-pattern/date/string intrinsics before processing caller-controlled
 * metadata: mutable ambient RegExp.exec, Date.parse, Reflect.apply and string
 * helpers must not relabel chronology after this module is initialized.
 */
const BUILTIN_REGEXP_EXEC = RegExp.prototype.exec;
const BUILTIN_REFLECT_APPLY = Reflect.apply;
const BUILTIN_DATE = Date;
const BUILTIN_DATE_PARSE = Date.parse;
const BUILTIN_STRING_SLICE = String.prototype.slice;
const BUILTIN_STRING_ENDS_WITH = String.prototype.endsWith;
const BUILTIN_STRING_PAD_END = String.prototype.padEnd;
const BUILTIN_NUMBER = Number;
const BUILTIN_NUMBER_IS_FINITE = Number.isFinite;

function stableExec(pattern: RegExp, value: string): RegExpExecArray | null {
  return BUILTIN_REFLECT_APPLY(BUILTIN_REGEXP_EXEC, pattern, [value]) as RegExpExecArray | null;
}
function stableDateParse(value: string): number {
  return BUILTIN_REFLECT_APPLY(BUILTIN_DATE_PARSE, BUILTIN_DATE, [value]) as number;
}
function stableSlice(value: string, start: number, end?: number): string {
  return BUILTIN_REFLECT_APPLY(
    BUILTIN_STRING_SLICE, value, end === undefined ? [start] : [start, end],
  ) as string;
}
function stableEndsWith(value: string, suffix: string): boolean {
  return BUILTIN_REFLECT_APPLY(BUILTIN_STRING_ENDS_WITH, value, [suffix]) as boolean;
}
function stablePadEnd(value: string, width: number): string {
  return BUILTIN_REFLECT_APPLY(BUILTIN_STRING_PAD_END, value, [width, "0"]) as string;
}

export function validForwardV02ClaimedInstant(value: unknown): value is string {
  // Bound caller-supplied fractions before regex/date parsing or ordering allocations.
  if (typeof value !== "string" || value.length > 90) return false;
  const m = stableExec(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,64})?(?:Z|[+-](\d{2}):(\d{2}))$/u,
    value,
  );
  if (!m || stableEndsWith(value, "-00:00")) return false;
  const year = BUILTIN_NUMBER(m[1]), month = BUILTIN_NUMBER(m[2]), day = BUILTIN_NUMBER(m[3]);
  const hour = BUILTIN_NUMBER(m[4]), minute = BUILTIN_NUMBER(m[5]), second = BUILTIN_NUMBER(m[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]! &&
    hour <= 23 && minute <= 59 && second <= 59 && BUILTIN_NUMBER(m[7] ?? 0) <= 23 &&
    BUILTIN_NUMBER(m[8] ?? 0) <= 59 && BUILTIN_NUMBER_IS_FINITE(stableDateParse(value));
}

/** Date.parse truncates submilliseconds; retain fractional precision for ordering. */
export function compareForwardV02ClaimedInstants(left: string, right: string): number {
  // Direct callers must not bypass the bounded, fail-closed timestamp preflight.
  if (!validForwardV02ClaimedInstant(left) || !validForwardV02ClaimedInstant(right)) {
    throw new TypeError("INVALID_CLAIMED_INSTANT");
  }
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const lm = stableExec(fraction, left), rm = stableExec(fraction, right);
  // String.replace(RegExp) delegates to mutable RegExp.exec. Remove the
  // already-validated fraction by captured String.slice instead.
  const withoutFraction = (value: string, m: RegExpExecArray | null): string =>
    m === null ? value : stableSlice(value, 0, m.index) + stableSlice(value, m.index + m[0]!.length);
  const l = stableDateParse(withoutFraction(left, lm));
  const r = stableDateParse(withoutFraction(right, rm));
  if (l !== r) return l < r ? -1 : 1;
  const a = lm?.[1] ?? "", b = rm?.[1] ?? "";
  const width = a.length > b.length ? a.length : b.length;
  const x = stablePadEnd(a, width), y = stablePadEnd(b, width);
  return x < y ? -1 : x > y ? 1 : 0;
}
