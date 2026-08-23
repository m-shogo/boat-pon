export type T5MarketCoverageAuditOptions = {
  from: string;
  to: string;
  json: boolean;
  strict: boolean;
};

function requireCanonicalDate(value: string, name: "FROM" | "TO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`T5_MARKET_COVERAGE_AUDIT_${name}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`T5_MARKET_COVERAGE_AUDIT_${name}_INVALID:${value}`);
  }
  return value;
}

export function parseT5MarketCoverageAuditOptions(
  argv: readonly string[],
  defaults: { from: string; to: string },
): T5MarketCoverageAuditOptions {
  let from = requireCanonicalDate(defaults.from, "FROM");
  let to = requireCanonicalDate(defaults.to, "TO");
  let json = false;
  let strict = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      json = true;
    } else if (value === "--strict") {
      strict = true;
    } else if (value === "--from") {
      const raw = argv[++index];
      if (raw == null) throw new Error("T5_MARKET_COVERAGE_AUDIT_FROM_MISSING");
      from = requireCanonicalDate(raw, "FROM");
    } else if (value.startsWith("--from=")) {
      from = requireCanonicalDate(value.slice("--from=".length), "FROM");
    } else if (value === "--to") {
      const raw = argv[++index];
      if (raw == null) throw new Error("T5_MARKET_COVERAGE_AUDIT_TO_MISSING");
      to = requireCanonicalDate(raw, "TO");
    } else if (value.startsWith("--to=")) {
      to = requireCanonicalDate(value.slice("--to=".length), "TO");
    }
  }

  if (from > to) throw new Error(`T5_MARKET_COVERAGE_AUDIT_DATE_RANGE_INVALID:${from}:${to}`);
  return { from, to, json, strict };
}
