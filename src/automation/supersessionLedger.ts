import type { IntentSupersession } from "./intentSupersession";

export type SupersessionLedgerCheck = {
  processedSupersededIntentIds: string[];
};

/**
 * Durable supersession records classify stale intents as terminal without processing them.
 * A superseded intent appearing in the processed-intents ledger would collapse those two
 * mutually exclusive histories, so surface every overlap for fail-closed callers.
 */
export function checkSupersessionLedgerIsolation(input: {
  processedIntentIds: string[];
  supersessions: IntentSupersession[];
}): SupersessionLedgerCheck {
  const processed = new Set(input.processedIntentIds);
  const leaked = new Set<string>();

  for (const record of input.supersessions) {
    for (const entry of record.supersededIntents) {
      if (processed.has(entry.intentId)) leaked.add(entry.intentId);
    }
  }

  return { processedSupersededIntentIds: [...leaked].sort() };
}
