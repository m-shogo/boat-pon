import assert from "node:assert/strict";
import test from "node:test";
import {
  compareForwardV02ClaimedInstants,
  validForwardV02ClaimedInstant,
} from "./forwardV02ClaimedInstant";

/**
 * Independent Gregorian/UTC arithmetic oracle: no Date.parse or shared
 * comparator helpers. Synthetic claimed clocks never attest source time.
 */
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
const SCALE = 10n ** 64n;
type Sample = Readonly<{
  claimed: string;
  epochFraction: bigint;
  year: number;
  month: number;
  hour: number;
  minute: number;
  second: number;
  fraction: string;
  offsetMinutes: number;
}>;

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function syntheticSample(
  year: number, month: number, day: number, hour: number, minute: number,
  second: number, fraction: string, offsetMinutes: number,
): Sample {
  const y = year - 1;
  const ordinal = 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) +
    MONTH_START[month - 1]! + (leapYear(year) && month > 2 ? 1 : 0) + day - 1;
  const totalSeconds = ordinal * 86400 + hour * 3600 + minute * 60 + second - offsetMinutes * 60;
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const offset = offsetMinutes === 0 ? "Z" :
    `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
  const claimed = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T` +
    `${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}` +
    (fraction ? `.${fraction}` : "") + offset;
  return {
    claimed,
    epochFraction: BigInt(totalSeconds) * SCALE + BigInt(fraction.padEnd(64, "0") || "0"),
    year, month, hour, minute, second, fraction, offsetMinutes,
  };
}

const YEARS = [1, 4, 99, 100, 400, 999, 1582, 1900, 1999, 2000, 2024, 2026, 9999];
const OFFSETS = [0, 1, -1, 9 * 60, -(11 * 60 + 30), 23 * 60 + 59, -(23 * 60 + 59)];
const FRACTIONS = ["", "1", "9", "000000001", "123456789012345678", "9".repeat(64)];
function samples(): Sample[] {
  // xorshift32 avoids the low-bit phase lock of an LCG sampled every
  // eight draws (which previously exercised only 3/12 months and 3/24 hours).
  let state = 0x519_2026;
  const next = (bound: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state = (state ^ (state << 5)) >>> 0;
    return state % bound;
  };
  const result: Sample[] = [
    syntheticSample(1, 1, 1, 0, 0, 0, "", 23 * 60 + 59),
    syntheticSample(9999, 12, 31, 23, 59, 59, "9".repeat(64), -(23 * 60 + 59)),
    syntheticSample(2000, 2, 29, 23, 59, 59, "000000001", 9 * 60),
    syntheticSample(1900, 3, 1, 0, 0, 0, "", -1),
  ];
  for (let i = 0; i < 1_024; i++) {
    const year = YEARS[next(YEARS.length)]!;
    const month = 1 + next(12);
    const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    result.push(syntheticSample(year, month, 1 + next(days[month - 1]!),
      next(24), next(60), next(60), FRACTIONS[next(FRACTIONS.length)]!,
      OFFSETS[next(OFFSETS.length)]!));
  }
  return result;
}

test("independent Gregorian oracle sampler spans all declared calendar, time and offset dimensions", () => {
  const cases = samples();
  assert.equal(new Set(cases.map((item) => item.year)).size, YEARS.length);
  assert.equal(new Set(cases.map((item) => item.month)).size, 12);
  assert.equal(new Set(cases.map((item) => item.hour)).size, 24);
  assert.equal(new Set(cases.map((item) => item.minute)).size, 60);
  assert.equal(new Set(cases.map((item) => item.second)).size, 60);
  assert.equal(new Set(cases.map((item) => item.fraction)).size, FRACTIONS.length);
  assert.equal(new Set(cases.map((item) => item.offsetMinutes)).size, OFFSETS.length);
});

test("independent Gregorian oracle admits synthetic four-digit dates across offsets and 64-digit fractions", () => {
  for (const item of samples()) {
    assert.equal(validForwardV02ClaimedInstant(item.claimed), true, item.claimed);
  }
});

test("independent BigInt UTC oracle agrees with claimed-instant ordering and antisymmetry", () => {
  const cases = samples();
  for (let i = 0; i < 2_048; i++) {
    const left = cases[i % cases.length]!;
    const right = cases[(i * 7919 + 5) % cases.length]!;
    const expected = left.epochFraction < right.epochFraction ? -1 :
      left.epochFraction > right.epochFraction ? 1 : 0;
    assert.equal(compareForwardV02ClaimedInstants(left.claimed, right.claimed), expected,
      `${left.claimed} vs ${right.claimed}`);
    assert.equal(compareForwardV02ClaimedInstants(right.claimed, left.claimed),
      expected === 0 ? 0 : -expected, `reverse: ${right.claimed} vs ${left.claimed}`);
  }
});

test("independent Gregorian oracle crosses every month and hour rather than only marginal coverage", () => {
  const cases: Sample[] = [];
  for (let month = 1; month <= 12; month++) {
    for (let hour = 0; hour < 24; hour++) {
      cases.push(syntheticSample(2024, month, 15, hour, 0, 0, "", 0));
    }
  }
  assert.equal(cases.length, 12 * 24);
  assert.equal(new Set(cases.map((item) => item.claimed.slice(5, 7) + "/" + item.hour)).size, 12 * 24);
  for (let i = 0; i < cases.length - 1; i++) {
    const left = cases[i]!, right = cases[i + 1]!;
    assert.ok(left.epochFraction < right.epochFraction);
    assert.equal(compareForwardV02ClaimedInstants(left.claimed, right.claimed), -1);
    assert.equal(compareForwardV02ClaimedInstants(right.claimed, left.claimed), 1);
  }
});

test("independent UTC oracle crosses every declared fraction and offset pair", () => {
  const cases = OFFSETS.flatMap((offset) =>
    FRACTIONS.map((fraction) => syntheticSample(2024, 6, 15, 12, 34, 56, fraction, offset)));
  assert.equal(cases.length, OFFSETS.length * FRACTIONS.length);
  for (const left of cases) {
    assert.equal(validForwardV02ClaimedInstant(left.claimed), true, left.claimed);
    for (const right of cases) {
      const expected = left.epochFraction < right.epochFraction ? -1 :
        left.epochFraction > right.epochFraction ? 1 : 0;
      assert.equal(compareForwardV02ClaimedInstants(left.claimed, right.claimed), expected,
        `${left.claimed} vs ${right.claimed}`);
    }
  }
});

test("independent UTC oracle preserves equivalent instants across offset-induced year rollover", () => {
  const fraction = "123456789012345678";
  const equivalents = [
    syntheticSample(2024, 1, 1, 0, 0, 0, fraction, 0),
    syntheticSample(2024, 1, 1, 9, 0, 0, fraction, 9 * 60),
    syntheticSample(2023, 12, 31, 12, 30, 0, fraction, -(11 * 60 + 30)),
    syntheticSample(2024, 1, 1, 23, 59, 0, fraction, 23 * 60 + 59),
    syntheticSample(2023, 12, 31, 0, 1, 0, fraction, -(23 * 60 + 59)),
  ];
  for (const left of equivalents) {
    assert.equal(validForwardV02ClaimedInstant(left.claimed), true, left.claimed);
    for (const right of equivalents) {
      assert.equal(left.epochFraction, right.epochFraction);
      assert.equal(compareForwardV02ClaimedInstants(left.claimed, right.claimed), 0,
        `${left.claimed} vs ${right.claimed}`);
    }
  }
});
