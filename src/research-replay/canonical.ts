import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "rr-c14n-v1";

const MISSING_MARKER = Object.freeze({ $type: "missing" });

export type CanonicalUnordered = {
  readonly $canonicalUnordered: readonly unknown[];
};

export function unordered(values: readonly unknown[]): CanonicalUnordered {
  return { $canonicalUnordered: values };
}

export function missing(): typeof MISSING_MARKER {
  return MISSING_MARKER;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("canonical number must be finite");
  if (Object.is(value, -0) || value === 0) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toString().replace("e+", "e");
}

function encode(value: unknown): string {
  if (value === undefined || value === MISSING_MARKER) return '{"$type":"missing"}';
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return `{"$number":${JSON.stringify(canonicalNumber(value))}}`;
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "bigint") return `{"$integer":${JSON.stringify(value.toString())}}`;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("invalid Date");
    return `{"$utc":${JSON.stringify(value.toISOString())}}`;
  }
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length === 1
      && Array.isArray((record as Partial<CanonicalUnordered>).$canonicalUnordered)
    ) {
      const items = (record as CanonicalUnordered).$canonicalUnordered.map(encode).sort();
      return `{"$unordered":[${items.join(",")}]}`;
    }
    const entries = Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key.normalize("NFC"))}:${encode(child)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`unsupported canonical value: ${typeof value}`);
}

export function canonicalSerialize(value: unknown): string {
  return encode(value);
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Bytes(Buffer.from(canonicalSerialize(value), "utf8"));
}

function hasValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return true;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function hasValidExplicitIsoClock(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value)) return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false;
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  return hour <= 23 && minute <= 59 && second <= 59;
}

export function canonicalUtcTimestamp(value: string): string {
  if (!hasValidCalendarDate(value) || !hasValidExplicitIsoClock(value)) {
    throw new Error(`invalid timestamp: ${value}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid timestamp: ${value}`);
  return parsed.toISOString();
}

export function canonicalJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
