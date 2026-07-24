import {
  BET_TYPES,
  parseSettlementSelection,
  type SettlementBetType,
} from "./settlement";

export type WebSettlementLine = {
  betType: SettlementBetType;
  selectionRaw: string;
  selectionNormalized: string;
  selectionCanonical: string;
  payoutYen: number;
  popularity: number | null;
};

export type WebSettlementParse = {
  sourceSchemaVersion: string;
  canonicalRaceKey: string | null;
  status: "success" | "warning" | "error" | "unsupported_schema";
  lines: WebSettlementLine[];
  diagnosticCodes: string[];
};

/**
 * Offline-only parser for the sanitized official-Web contract fixture.
 * It deliberately accepts only the frozen data-* contract and never guesses from
 * presentation text. A real collector/source adapter is outside N1-A.
 */
export function parseSanitizedOfficialWebResult(html: string): WebSettlementParse {
  const schema = html.match(/data-source-schema="([^"]+)"/)?.[1] ?? "unknown";
  const race = html.match(/data-canonical-race-key="([^"]+)"/)?.[1] ?? null;
  if (schema !== "sanitized-official-web-result-v1") {
    return {
      sourceSchemaVersion: schema,
      canonicalRaceKey: race,
      status: "unsupported_schema",
      lines: [],
      diagnosticCodes: ["UNSUPPORTED_WEB_RESULT_SCHEMA"],
    };
  }
  const lines: WebSettlementLine[] = [];
  const diagnostics: string[] = [];
  const pattern = /<[^>]*data-bet-type="([^"]+)"[^>]*data-selection="([^"]+)"[^>]*data-payout-yen="([^"]+)"(?:[^>]*data-popularity="([^"]+)")?[^>]*>/g;
  for (const match of html.matchAll(pattern)) {
    const betType = match[1] as SettlementBetType;
    if (!BET_TYPES.includes(betType)) {
      diagnostics.push("UNKNOWN_BET_TYPE");
      continue;
    }
    const selection = parseSettlementSelection(betType, match[2]);
    const payout = Number(match[3].replaceAll(",", ""));
    const popularity = match[4] == null ? null : Number(match[4]);
    if (!selection.valid || !selection.canonical || !Number.isInteger(payout) || payout < 0) {
      diagnostics.push(selection.reason ?? "INVALID_WEB_PAYOUT");
      continue;
    }
    lines.push({
      betType,
      selectionRaw: selection.raw,
      selectionNormalized: selection.normalized,
      selectionCanonical: selection.canonical,
      payoutYen: payout,
      popularity: Number.isInteger(popularity) && popularity! > 0 ? popularity : null,
    });
  }
  if (!race || lines.length === 0) {
    return {
      sourceSchemaVersion: schema,
      canonicalRaceKey: race,
      status: "error",
      lines: [],
      diagnosticCodes: [...diagnostics, "WEB_RESULT_REQUIRED_FIELD_MISSING"],
    };
  }
  const missing = BET_TYPES.filter((betType) => !lines.some((line) => line.betType === betType));
  return {
    sourceSchemaVersion: schema,
    canonicalRaceKey: race,
    status: diagnostics.length || missing.length ? "warning" : "success",
    lines,
    diagnosticCodes: [...diagnostics, ...missing.map((betType) => `BET_TYPE_MISSING:${betType}`)],
  };
}
