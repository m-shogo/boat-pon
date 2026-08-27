import { canonicalUtcTimestamp } from "./canonical";

export type N2T5CollectorEfficiencyInputs = {
  from: string;
  to: string;
  fixEffectiveAt: string;
  networkOnlyEffectiveAt: string;
};

function canonicalDate(value: string, label: "FROM" | "TO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`N2_T5_COLLECTOR_${label}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`N2_T5_COLLECTOR_${label}_INVALID:${value}`);
  }
  return value;
}

function canonicalInstant(value: string, label: "FIX_EFFECTIVE_AT" | "NETWORK_ONLY_EFFECTIVE_AT"): string {
  try {
    return canonicalUtcTimestamp(value);
  } catch {
    throw new Error(`N2_T5_COLLECTOR_${label}_INVALID:${value}`);
  }
}

export function resolveN2T5CollectorEfficiencyInputs(input: {
  from: string;
  to: string;
  fixEffectiveAt: string;
  networkOnlyEffectiveAt: string;
}): N2T5CollectorEfficiencyInputs {
  const from = canonicalDate(input.from, "FROM");
  const to = canonicalDate(input.to, "TO");
  if (from > to) throw new Error(`N2_T5_COLLECTOR_WINDOW_REVERSED:${from}:${to}`);
  const fixEffectiveAt = canonicalInstant(input.fixEffectiveAt, "FIX_EFFECTIVE_AT");
  const networkOnlyEffectiveAt = canonicalInstant(input.networkOnlyEffectiveAt, "NETWORK_ONLY_EFFECTIVE_AT");
  if (networkOnlyEffectiveAt < fixEffectiveAt) {
    throw new Error(`N2_T5_COLLECTOR_EFFECTIVE_ORDER_INVALID:${fixEffectiveAt}:${networkOnlyEffectiveAt}`);
  }
  return { from, to, fixEffectiveAt, networkOnlyEffectiveAt };
}
