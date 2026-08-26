function assertCanonicalJstDate(name: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`T5_MARKET_BASELINE_${name}_INVALID:${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year
    || utc.getUTCMonth() !== month - 1
    || utc.getUTCDate() !== day
  ) {
    throw new Error(`T5_MARKET_BASELINE_${name}_INVALID:${value}`);
  }
}

export function assertT5MarketBaselineWindow(input: {
  from: string;
  to: string;
  boundary: string;
}): void {
  assertCanonicalJstDate("FROM", input.from);
  assertCanonicalJstDate("TO", input.to);
  assertCanonicalJstDate("BOUNDARY", input.boundary);
  if (input.from > input.to) {
    throw new Error(`T5_MARKET_BASELINE_WINDOW_INVALID:${input.from}:${input.to}`);
  }
}
