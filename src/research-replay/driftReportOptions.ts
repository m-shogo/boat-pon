import { parseCondition, type RowCondition } from "../domain/researchEvaluation";

export type DriftReportOptions = {
  baselineFrom: string;
  baselineTo: string;
  recentFrom: string;
  recentTo: string;
  ruleId: string;
  json: boolean;
  presentationJson: boolean;
  condition?: RowCondition;
};

const VALUE_OPTIONS = [
  "--baseline-from",
  "--baseline-to",
  "--recent-from",
  "--recent-to",
  "--rule-id",
  "--condition",
] as const;
type ValueOption = typeof VALUE_OPTIONS[number];

function canonicalDate(value: string, name: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`DRIFT_REPORT_${name}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`DRIFT_REPORT_${name}_INVALID:${value}`);
  }
  return value;
}

function canonicalRuleId(value: string): string {
  if (value.trim() === "" || value.trim() !== value) {
    throw new Error(`DRIFT_REPORT_RULE_ID_INVALID:${value}`);
  }
  return value;
}

export function parseDriftReportOptions(argv: readonly string[], defaultRecentTo: string): DriftReportOptions {
  const canonicalDefaultRecentTo = canonicalDate(defaultRecentTo, "DEFAULT_RECENT_TO");
  const values = new Map<ValueOption, string>();
  const booleans = new Set<string>();
  const normalized = argv.filter((value) => value !== "--");
  const valueOptions: ReadonlySet<string> = new Set(VALUE_OPTIONS);

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--json" || arg === "--presentation-json") {
      if (booleans.has(arg)) throw new Error(`DRIFT_REPORT_ARGUMENT_DUPLICATE:${arg}`);
      booleans.add(arg);
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`DRIFT_REPORT_ARGUMENT_INVALID:${arg}`);
    const option = arg as ValueOption;
    if (values.has(option)) throw new Error(`DRIFT_REPORT_ARGUMENT_DUPLICATE:${arg}`);
    const value = normalized[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`DRIFT_REPORT_ARGUMENT_MISSING:${arg}`);
    }
    values.set(option, value);
    index += 1;
  }

  const baselineFrom = values.has("--baseline-from")
    ? canonicalDate(values.get("--baseline-from")!, "BASELINE_FROM")
    : "1970-01-01";
  const baselineTo = values.has("--baseline-to")
    ? canonicalDate(values.get("--baseline-to")!, "BASELINE_TO")
    : "1970-01-01";
  const recentFrom = values.has("--recent-from")
    ? canonicalDate(values.get("--recent-from")!, "RECENT_FROM")
    : "1970-01-01";
  const recentTo = values.has("--recent-to")
    ? canonicalDate(values.get("--recent-to")!, "RECENT_TO")
    : canonicalDefaultRecentTo;

  if (baselineFrom > baselineTo) {
    throw new Error(`DRIFT_REPORT_BASELINE_RANGE_INVALID:${baselineFrom}:${baselineTo}`);
  }
  if (recentFrom > recentTo) {
    throw new Error(`DRIFT_REPORT_RECENT_RANGE_INVALID:${recentFrom}:${recentTo}`);
  }

  const conditionValue = values.get("--condition");
  return {
    baselineFrom,
    baselineTo,
    recentFrom,
    recentTo,
    ruleId: values.has("--rule-id") ? canonicalRuleId(values.get("--rule-id")!) : "detect-drift-adhoc",
    json: booleans.has("--json"),
    presentationJson: booleans.has("--presentation-json"),
    condition: conditionValue === undefined ? undefined : parseCondition(conditionValue),
  };
}
