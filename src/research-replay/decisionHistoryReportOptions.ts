import type { DecisionStatus } from "../domain/types";

export type DecisionHistoryReportOptions = {
  from: string | null;
  to: string | null;
  decision: DecisionStatus | null;
  modelVersion: string | null;
  runKind: string | null;
  json: boolean;
};

const VALUE_OPTIONS = ["--from", "--to", "--decision", "--model-version", "--run-kind"] as const;
type ValueOption = typeof VALUE_OPTIONS[number];

function canonicalDate(value: string, name: "FROM" | "TO"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`DECISION_HISTORY_REPORT_${name}_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`DECISION_HISTORY_REPORT_${name}_INVALID:${value}`);
  }
  return value;
}

function nonEmpty(value: string, name: string): string {
  if (value.trim() === "" || value.trim() !== value) {
    throw new Error(`DECISION_HISTORY_REPORT_${name}_INVALID:${value}`);
  }
  return value;
}

export function parseDecisionHistoryReportOptions(argv: readonly string[]): DecisionHistoryReportOptions {
  const values = new Map<ValueOption, string>();
  let json = false;
  const normalized = argv.filter((value) => value !== "--");
  const valueOptions: ReadonlySet<string> = new Set(VALUE_OPTIONS);

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === "--json") {
      if (json) throw new Error("DECISION_HISTORY_REPORT_ARGUMENT_DUPLICATE:--json");
      json = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`DECISION_HISTORY_REPORT_ARGUMENT_INVALID:${arg}`);
    const option = arg as ValueOption;
    if (values.has(option)) throw new Error(`DECISION_HISTORY_REPORT_ARGUMENT_DUPLICATE:${arg}`);
    const value = normalized[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`DECISION_HISTORY_REPORT_ARGUMENT_MISSING:${arg}`);
    }
    values.set(option, value);
    index += 1;
  }

  const fromValue = values.get("--from");
  const toValue = values.get("--to");
  const from = fromValue === undefined ? null : canonicalDate(fromValue, "FROM");
  const to = toValue === undefined ? null : canonicalDate(toValue, "TO");
  if (from !== null && to !== null && from > to) {
    throw new Error(`DECISION_HISTORY_REPORT_DATE_RANGE_INVALID:${from}:${to}`);
  }

  const decisionValue = values.get("--decision");
  let decision: DecisionStatus | null = null;
  if (decisionValue !== undefined) {
    const canonical = decisionValue.toUpperCase();
    if (canonical !== "BUY" && canonical !== "WATCH" && canonical !== "SKIP") {
      throw new Error(`DECISION_HISTORY_REPORT_DECISION_INVALID:${decisionValue}`);
    }
    decision = canonical;
  }

  const modelVersionValue = values.get("--model-version");
  const runKindValue = values.get("--run-kind");
  return {
    from,
    to,
    decision,
    modelVersion: modelVersionValue === undefined ? null : nonEmpty(modelVersionValue, "MODEL_VERSION"),
    runKind: runKindValue === undefined ? null : nonEmpty(runKindValue, "RUN_KIND"),
    json,
  };
}
