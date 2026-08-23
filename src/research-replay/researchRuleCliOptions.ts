import type { RuleStatus } from "../domain/researchRule";

export const RESEARCH_RULE_STATUSES: readonly RuleStatus[] = [
  "candidate",
  "backtest",
  "forward",
  "review",
  "approved",
  "production",
  "deprecated",
  "archived",
];

export function parseResearchRuleFlags(
  argv: string[],
  known: readonly string[],
): Record<string, string | undefined> {
  const allowed = new Set(known);
  const seen = new Set<string>();
  const out: Record<string, string | undefined> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!allowed.has(arg)) throw new Error(`unknown option: ${arg}`);
    if (seen.has(arg)) throw new Error(`duplicate option: ${arg}`);
    seen.add(arg);

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    out[arg] = value;
    i += 1;
  }
  return out;
}

export function requireCanonicalRuleId(value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.trim() !== value) {
    throw new Error("--rule-id requires a non-blank, trimmed value");
  }
  return value;
}

export function requireNonBlankText(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} requires a non-blank value`);
  }
  return value;
}

export function parseResearchRuleStatus(value: string | undefined, flag: string): RuleStatus {
  if (value === undefined || value.trim() !== value || !RESEARCH_RULE_STATUSES.includes(value as RuleStatus)) {
    throw new Error(`${flag} has an invalid status: ${value ?? ""}`);
  }
  return value as RuleStatus;
}
