import { parseCondition, type RowCondition } from "../domain/researchEvaluation";

export type RoiExplorerOptions = {
  from: string;
  to: string;
  ruleId: string;
  json: boolean;
  viewJson: boolean;
  presentationJson: boolean;
  condition?: RowCondition;
};

const VALUE_OPTIONS = ["--from", "--to", "--rule-id", "--condition"] as const;
type ValueOption = typeof VALUE_OPTIONS[number];

function canonicalDate(value: string, name: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`ROI_EXPLORER_${name}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`ROI_EXPLORER_${name}_INVALID:${value}`);
  }
  return value;
}

function canonicalRuleId(value: string): string {
  if (value.trim() === "" || value.trim() !== value) {
    throw new Error(`ROI_EXPLORER_RULE_ID_INVALID:${value}`);
  }
  return value;
}

export function parseRoiExplorerOptions(argv: readonly string[], defaultTo: string): RoiExplorerOptions {
  const canonicalDefaultTo = canonicalDate(defaultTo, "DEFAULT_TO");
  const values = new Map<ValueOption, string>();
  const booleans = new Set<string>();
  const normalized = argv.filter((value) => value !== "--");
  const valueOptions: ReadonlySet<string> = new Set(VALUE_OPTIONS);

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--json" || arg === "--view-json" || arg === "--presentation-json") {
      if (booleans.has(arg)) throw new Error(`ROI_EXPLORER_ARGUMENT_DUPLICATE:${arg}`);
      booleans.add(arg);
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`ROI_EXPLORER_ARGUMENT_INVALID:${arg}`);
    const option = arg as ValueOption;
    if (values.has(option)) throw new Error(`ROI_EXPLORER_ARGUMENT_DUPLICATE:${arg}`);
    const value = normalized[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`ROI_EXPLORER_ARGUMENT_MISSING:${arg}`);
    }
    values.set(option, value);
    index += 1;
  }

  const from = values.has("--from") ? canonicalDate(values.get("--from")!, "FROM") : "1970-01-01";
  const to = values.has("--to") ? canonicalDate(values.get("--to")!, "TO") : canonicalDefaultTo;
  if (from > to) throw new Error(`ROI_EXPLORER_DATE_RANGE_INVALID:${from}:${to}`);

  const conditionValue = values.get("--condition");
  return {
    from,
    to,
    ruleId: values.has("--rule-id") ? canonicalRuleId(values.get("--rule-id")!) : "explore-roi-adhoc",
    json: booleans.has("--json"),
    viewJson: booleans.has("--view-json"),
    presentationJson: booleans.has("--presentation-json"),
    condition: conditionValue === undefined ? undefined : parseCondition(conditionValue),
  };
}
