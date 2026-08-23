export type RollingReportOptions = {
  from: string | null;
  to: string | null;
  days: number;
  json: boolean;
};

const VALUE_OPTIONS = ["--from", "--to", "--days"] as const;
type ValueOption = typeof VALUE_OPTIONS[number];

function canonicalDate(value: string, name: "FROM" | "TO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`ROLLING_REPORT_${name}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`ROLLING_REPORT_${name}_INVALID:${value}`);
  }
  return value;
}

function positiveSafeInteger(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`ROLLING_REPORT_DAYS_INVALID:${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`ROLLING_REPORT_DAYS_INVALID:${value}`);
  return parsed;
}

export function parseRollingReportOptions(argv: readonly string[], defaultDays: number): RollingReportOptions {
  if (!Number.isSafeInteger(defaultDays) || defaultDays <= 0) {
    throw new Error(`ROLLING_REPORT_DEFAULT_DAYS_INVALID:${defaultDays}`);
  }

  const values = new Map<ValueOption, string>();
  let json = false;
  const normalized = argv.filter((value) => value !== "--");
  const valueOptions: ReadonlySet<string> = new Set(VALUE_OPTIONS);

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--json") {
      if (json) throw new Error("ROLLING_REPORT_ARGUMENT_DUPLICATE:--json");
      json = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`ROLLING_REPORT_ARGUMENT_INVALID:${arg}`);
    const option = arg as ValueOption;
    if (values.has(option)) throw new Error(`ROLLING_REPORT_ARGUMENT_DUPLICATE:${arg}`);
    const value = normalized[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`ROLLING_REPORT_ARGUMENT_MISSING:${arg}`);
    }
    values.set(option, value);
    index += 1;
  }

  const fromValue = values.get("--from");
  const toValue = values.get("--to");
  const from = fromValue === undefined ? null : canonicalDate(fromValue, "FROM");
  const to = toValue === undefined ? null : canonicalDate(toValue, "TO");
  if (from !== null && to !== null && from > to) {
    throw new Error(`ROLLING_REPORT_DATE_RANGE_INVALID:${from}:${to}`);
  }

  const daysValue = values.get("--days");
  return {
    from,
    to,
    days: daysValue === undefined ? defaultDays : positiveSafeInteger(daysValue),
    json,
  };
}
