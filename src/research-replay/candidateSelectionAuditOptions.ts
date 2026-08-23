export type CandidateSelectionAuditOptions = {
  date: string;
  json: boolean;
  limit: number;
  strict: boolean;
};

function requireCanonicalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) throw new Error(`CANDIDATE_SELECTION_AUDIT_DATE_INVALID:${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error(`CANDIDATE_SELECTION_AUDIT_DATE_INVALID:${value}`);
  }
  return value;
}

function requirePositiveSafeInteger(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`CANDIDATE_SELECTION_AUDIT_LIMIT_INVALID:${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`CANDIDATE_SELECTION_AUDIT_LIMIT_INVALID:${value}`);
  return parsed;
}

export function parseCandidateSelectionAuditOptions(
  argv: readonly string[],
  defaultDate: string,
): CandidateSelectionAuditOptions {
  let date = requireCanonicalDate(defaultDate);
  let json = false;
  let limit = 20;
  let strict = false;

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--json") {
      json = true;
    } else if (value === "--strict") {
      strict = true;
    } else if (value === "--date") {
      const raw = argv[++i];
      if (raw == null) throw new Error("CANDIDATE_SELECTION_AUDIT_DATE_MISSING");
      date = requireCanonicalDate(raw);
    } else if (value.startsWith("--date=")) {
      date = requireCanonicalDate(value.slice("--date=".length));
    } else if (value === "--limit") {
      const raw = argv[++i];
      if (raw == null) throw new Error("CANDIDATE_SELECTION_AUDIT_LIMIT_MISSING");
      limit = requirePositiveSafeInteger(raw);
    } else if (value.startsWith("--limit=")) {
      limit = requirePositiveSafeInteger(value.slice("--limit=".length));
    }
  }

  return { date, json, limit, strict };
}

export function addCandidateSelectionAuditDays(date: string, delta: number): string {
  requireCanonicalDate(date);
  if (!Number.isSafeInteger(delta)) throw new Error(`CANDIDATE_SELECTION_AUDIT_DAY_DELTA_INVALID:${String(delta)}`);
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}
