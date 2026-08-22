import type { DatabaseSync } from "node:sqlite";
import { canonicalUtcTimestamp } from "./canonical";

type ShadowDeliveryAttemptRow = {
  outbox_message_id: string;
  attempt_no: number;
  outcome: string;
  started_at: string;
  completed_at: string;
  next_available_at: string | null;
  created_at: string;
};

const TERMINAL_OUTCOMES = new Set(["succeeded", "permanent_failure", "cancelled"]);

function canonicalTimestampMs(value: string, name: string): number {
  const canonical = canonicalUtcTimestamp(value);
  if (canonical !== value) throw new Error(`non-canonical ${name}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`invalid ${name}`);
  return milliseconds;
}

export function assertShadowDeliveryAttemptHistory(db: DatabaseSync, asOf?: string): void {
  const asOfMs = asOf === undefined ? null : canonicalTimestampMs(asOf, "delivery attempt asOf");
  const rows = db.prepare(`
    SELECT outbox_message_id, attempt_no, outcome,
           started_at, completed_at, next_available_at, created_at
    FROM shadow_delivery_attempts
    ORDER BY outbox_message_id, attempt_no
  `).all() as ShadowDeliveryAttemptRow[];

  let currentMessageId: string | null = null;
  let expectedAttemptNo = 1;
  let previousOutcome: string | null = null;
  let previousCompletedAtMs: number | null = null;
  let previousNextAvailableAtMs: number | null = null;
  for (const row of rows) {
    if (row.outbox_message_id !== currentMessageId) {
      currentMessageId = row.outbox_message_id;
      expectedAttemptNo = 1;
      previousOutcome = null;
      previousCompletedAtMs = null;
      previousNextAvailableAtMs = null;
    }
    if (!Number.isSafeInteger(row.attempt_no) || row.attempt_no !== expectedAttemptNo) {
      throw new Error("non-contiguous shadow delivery attempt sequence");
    }
    expectedAttemptNo += 1;

    const startedAtMs = canonicalTimestampMs(row.started_at, "delivery attempt started_at");
    const completedAtMs = canonicalTimestampMs(row.completed_at, "delivery attempt completed_at");
    const createdAtMs = canonicalTimestampMs(row.created_at, "delivery attempt created_at");
    if (asOfMs !== null && (startedAtMs > asOfMs || completedAtMs > asOfMs || createdAtMs > asOfMs)) {
      throw new Error("future shadow delivery attempt timestamp");
    }
    if (completedAtMs < startedAtMs) throw new Error("shadow delivery attempt completed before start");
    if (previousOutcome !== null) {
      if (TERMINAL_OUTCOMES.has(previousOutcome)) {
        throw new Error("shadow delivery attempt recorded after terminal outcome");
      }
      if (previousCompletedAtMs !== null && startedAtMs < previousCompletedAtMs) {
        throw new Error("overlapping shadow delivery attempts");
      }
      if (previousNextAvailableAtMs !== null && startedAtMs < previousNextAvailableAtMs) {
        throw new Error("shadow delivery attempt started before retry schedule");
      }
    }

    let nextAvailableAtMs: number | null = null;
    if (row.outcome === "retryable_failure") {
      if (row.next_available_at === null) throw new Error("retryable shadow delivery attempt missing next_available_at");
      nextAvailableAtMs = canonicalTimestampMs(row.next_available_at, "delivery attempt next_available_at");
      if (nextAvailableAtMs <= startedAtMs) throw new Error("invalid shadow delivery retry schedule");
    } else if (row.next_available_at !== null) {
      throw new Error("terminal shadow delivery attempt must not have next_available_at");
    }

    previousOutcome = row.outcome;
    previousCompletedAtMs = completedAtMs;
    previousNextAvailableAtMs = nextAvailableAtMs;
  }
}
