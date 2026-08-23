export const RULE_CANDIDATE_STATUSES = [
  "watch",
  "candidate",
  "reject",
  "adopted",
  "reverted",
] as const;

export type RuleCandidateStatus = typeof RULE_CANDIDATE_STATUSES[number];

export type RuleCandidateAppendOptions = {
  input: string | null;
  output: string;
  status: RuleCandidateStatus;
  evidence: string;
  action: string;
  nextCheck: string;
};

const VALUE_FLAGS = [
  "--input",
  "--output",
  "--status",
  "--evidence",
  "--action",
  "--next-check",
] as const;

type ValueFlag = typeof VALUE_FLAGS[number];

function requireValue(flag: ValueFlag, value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseStatus(value: string): RuleCandidateStatus {
  if (value.trim() !== value || !RULE_CANDIDATE_STATUSES.includes(value as RuleCandidateStatus)) {
    throw new Error(`invalid --status: ${value}`);
  }
  return value as RuleCandidateStatus;
}

export function parseRuleCandidateAppendOptions(argv: string[]): RuleCandidateAppendOptions {
  const parsed: RuleCandidateAppendOptions = {
    input: null,
    output: "docs/rule-candidates.md",
    status: "watch",
    evidence: "report:quality",
    action: "追加観察",
    nextCheck: "next weekly",
  };
  const seen = new Set<ValueFlag>();

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--") continue;
    if (!(VALUE_FLAGS as readonly string[]).includes(key)) {
      throw new Error(`unknown option: ${key}`);
    }
    const flag = key as ValueFlag;
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    const value = requireValue(flag, argv[i + 1]);
    i += 1;

    if (flag === "--input") parsed.input = value;
    else if (flag === "--output") parsed.output = value;
    else if (flag === "--status") parsed.status = parseStatus(value);
    else if (flag === "--evidence") parsed.evidence = value;
    else if (flag === "--action") parsed.action = value;
    else if (flag === "--next-check") parsed.nextCheck = value;
  }

  return parsed;
}
