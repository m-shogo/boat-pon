import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { canonicalTrifectaSelection, parseCanonicalRaceKey } from "./identity";

export const PAYLOAD_SCHEMA_VERSION = "rr-payload-v1";
export const TIMEZONE_POLICY_VERSION = "utc-ms-jst-race-v1";
export const CHECKPOINT_POLICY_VERSION = "t-minus-nearest-v1";

export type ObservationType =
  | "race_schedule"
  | "trifecta_market"
  | "beforeinfo"
  | "race_result"
  | "current_racer_profile"
  | "historical_closing_odds"
  | "fixture_only";

export type ObservationCategory =
  | "pre_race"
  | "post_race"
  | "current_only"
  | "historical_closing"
  | "fixture_only";

export type RaceSchedulePayload = {
  canonicalRaceKey: string;
  scheduledCloseAt: string;
  scheduledCloseOriginalOffset: string;
  scheduleStatus: "scheduled" | "changed" | "cancelled";
};

export type TrifectaMarketPayload = {
  selections: Array<{ selection: string; odds: number }>;
  scheduledCloseObservationId: string;
  scheduledCloseAtSeen: string;
  observedAt: string;
  minutesBeforeCloseAtCapture: number;
  checkpointLabelAtCapture: "T-30" | "T-20" | "T-10" | "T-5" | "ad-hoc";
  checkpointPolicyVersion: string;
  marketKind: "live_checkpoint" | "historical_closing";
};

export type BeforeInfoPayload = {
  exhibitionTime: number | null;
  exhibitionStartTiming: number | null;
  windSpeedMps: number | null;
  waveHeightCm: number | null;
  observedOnly: boolean;
};

export type RaceResultPayload = {
  trifecta: string;
  finishPositions: number[];
  confirmedAt: string;
};

export type CurrentRacerProfilePayload = {
  registrationNo: string;
  className: string;
  profileObservedAt: string;
};

export type FixtureOnlyPayload = {
  fixtureName: string;
  value: string;
};

export type TypedPayload =
  | RaceSchedulePayload
  | TrifectaMarketPayload
  | BeforeInfoPayload
  | RaceResultPayload
  | CurrentRacerProfilePayload
  | FixtureOnlyPayload;

const REGISTRY: Record<string, ObservationCategory> = {
  race_schedule: "pre_race",
  trifecta_market: "pre_race",
  beforeinfo: "pre_race",
  race_result: "post_race",
  actual_start_timing: "post_race",
  actual_entry: "post_race",
  finish_position: "post_race",
  winning_technique: "post_race",
  payout: "post_race",
  refund_result: "post_race",
  incident_result: "post_race",
  confirmed_race_result: "post_race",
  post_race_weather: "post_race",
  result_derived_label: "post_race",
  current_racer_profile: "current_only",
  historical_closing_odds: "historical_closing",
  fixture_only: "fixture_only",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`payload fields mismatch: expected=${expected.join(",")} actual=${actual.join(",")}`);
  }
}

function assertNullableFinite(value: unknown, field: string): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${field} must be finite number or null`);
  }
}

export function observationCategory(type: string): ObservationCategory | null {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type) ? REGISTRY[type] : null;
}

export function validateTypedPayload(type: ObservationType, payload: unknown): TypedPayload {
  if (!isRecord(payload)) throw new Error("typed payload must be an object");
  switch (type) {
    case "race_schedule": {
      assertExactKeys(payload, ["canonicalRaceKey", "scheduledCloseAt", "scheduledCloseOriginalOffset", "scheduleStatus"]);
      parseCanonicalRaceKey(String(payload.canonicalRaceKey));
      canonicalUtcTimestamp(String(payload.scheduledCloseAt));
      if (!/^[+-]\d{2}:\d{2}$/.test(String(payload.scheduledCloseOriginalOffset))) throw new Error("invalid original offset");
      if (!["scheduled", "changed", "cancelled"].includes(String(payload.scheduleStatus))) throw new Error("invalid schedule status");
      return payload as RaceSchedulePayload;
    }
    case "trifecta_market":
    case "historical_closing_odds": {
      assertExactKeys(payload, [
        "selections",
        "scheduledCloseObservationId",
        "scheduledCloseAtSeen",
        "observedAt",
        "minutesBeforeCloseAtCapture",
        "checkpointLabelAtCapture",
        "checkpointPolicyVersion",
        "marketKind",
      ]);
      if (!Array.isArray(payload.selections) || payload.selections.length === 0) throw new Error("market selections required");
      for (const item of payload.selections) {
        if (!isRecord(item)) throw new Error("invalid market selection");
        assertExactKeys(item, ["selection", "odds"]);
        canonicalTrifectaSelection(String(item.selection));
        if (typeof item.odds !== "number" || !Number.isFinite(item.odds) || item.odds <= 0) throw new Error("invalid odds");
      }
      canonicalUtcTimestamp(String(payload.scheduledCloseAtSeen));
      canonicalUtcTimestamp(String(payload.observedAt));
      if (typeof payload.minutesBeforeCloseAtCapture !== "number" || !Number.isFinite(payload.minutesBeforeCloseAtCapture)) {
        throw new Error("invalid minutesBeforeCloseAtCapture");
      }
      if (!["T-30", "T-20", "T-10", "T-5", "ad-hoc"].includes(String(payload.checkpointLabelAtCapture))) {
        throw new Error("invalid checkpoint");
      }
      if (payload.checkpointPolicyVersion !== CHECKPOINT_POLICY_VERSION) throw new Error("unknown checkpoint policy");
      const expectedKind = type === "historical_closing_odds" ? "historical_closing" : "live_checkpoint";
      if (payload.marketKind !== expectedKind) throw new Error(`marketKind must be ${expectedKind}`);
      return payload as TrifectaMarketPayload;
    }
    case "beforeinfo": {
      assertExactKeys(payload, ["exhibitionTime", "exhibitionStartTiming", "windSpeedMps", "waveHeightCm", "observedOnly"]);
      assertNullableFinite(payload.exhibitionTime, "exhibitionTime");
      assertNullableFinite(payload.exhibitionStartTiming, "exhibitionStartTiming");
      assertNullableFinite(payload.windSpeedMps, "windSpeedMps");
      assertNullableFinite(payload.waveHeightCm, "waveHeightCm");
      if (typeof payload.observedOnly !== "boolean") throw new Error("observedOnly must be boolean");
      return payload as BeforeInfoPayload;
    }
    case "race_result": {
      assertExactKeys(payload, ["trifecta", "finishPositions", "confirmedAt"]);
      canonicalTrifectaSelection(String(payload.trifecta));
      if (!Array.isArray(payload.finishPositions) || payload.finishPositions.some((item) => !Number.isInteger(item))) {
        throw new Error("invalid finishPositions");
      }
      canonicalUtcTimestamp(String(payload.confirmedAt));
      return payload as RaceResultPayload;
    }
    case "current_racer_profile": {
      assertExactKeys(payload, ["registrationNo", "className", "profileObservedAt"]);
      if (!/^\d{4}$/.test(String(payload.registrationNo))) throw new Error("invalid registration number");
      if (!["A1", "A2", "B1", "B2"].includes(String(payload.className))) throw new Error("invalid class");
      canonicalUtcTimestamp(String(payload.profileObservedAt));
      return payload as CurrentRacerProfilePayload;
    }
    case "fixture_only": {
      assertExactKeys(payload, ["fixtureName", "value"]);
      if (typeof payload.fixtureName !== "string" || typeof payload.value !== "string") throw new Error("invalid fixture payload");
      return payload as FixtureOnlyPayload;
    }
  }
}

export function semanticPayloadHash(type: ObservationType, payload: unknown): string {
  const validated = validateTypedPayload(type, payload);
  return canonicalHash({
    payloadSchemaVersion: PAYLOAD_SCHEMA_VERSION,
    payloadType: type,
    payload: validated,
  });
}

export function freezeCheckpoint(scheduledCloseAt: string, observedAt: string): {
  scheduledCloseAtSeen: string;
  observedAt: string;
  minutesBeforeCloseAtCapture: number;
  checkpointLabelAtCapture: TrifectaMarketPayload["checkpointLabelAtCapture"];
  checkpointPolicyVersion: string;
} {
  const close = new Date(scheduledCloseAt);
  const observed = new Date(observedAt);
  if (Number.isNaN(close.getTime()) || Number.isNaN(observed.getTime())) throw new Error("invalid checkpoint timestamp");
  const minutes = (close.getTime() - observed.getTime()) / 60_000;
  const candidates: Array<[number, TrifectaMarketPayload["checkpointLabelAtCapture"]]> = [
    [30, "T-30"],
    [20, "T-20"],
    [10, "T-10"],
    [5, "T-5"],
  ];
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate[0] - minutes) < Math.abs(best[0] - minutes) ? candidate : best
  );
  return {
    scheduledCloseAtSeen: canonicalUtcTimestamp(scheduledCloseAt),
    observedAt: canonicalUtcTimestamp(observedAt),
    minutesBeforeCloseAtCapture: Number(minutes.toFixed(6)),
    checkpointLabelAtCapture: Math.abs(nearest[0] - minutes) <= 1 ? nearest[1] : "ad-hoc",
    checkpointPolicyVersion: CHECKPOINT_POLICY_VERSION,
  };
}

export type ChangeClassification =
  | "NO_EVENT"
  | "CONFIRMED_SEMANTIC_EVENT"
  | "RAW_ONLY_COSMETIC_CHANGE"
  | "UNKNOWN_CHANGE"
  | "SCHEMA_CHANGE_CANDIDATE"
  | "SAFETY_ALERT"
  | "PARSER_VERSION_CHANGE";

export type ChangeRecommendation = "NO_ACTION" | "CAPTURE_RECOMMENDED" | "ALERT_RECOMMENDED";

export function classifyRawSemanticChange(input: {
  rawChanged: boolean;
  semanticChanged?: boolean;
  parserStatus: "healthy" | "warning" | "error";
  sourceSchemaStatus: "known" | "unknown";
}): { classification: ChangeClassification; recommendation: ChangeRecommendation; sourceEvent: boolean } {
  if (input.rawChanged && input.sourceSchemaStatus === "unknown") {
    return { classification: "SAFETY_ALERT", recommendation: "ALERT_RECOMMENDED", sourceEvent: false };
  }
  if (input.rawChanged && input.parserStatus === "error") {
    return { classification: "SCHEMA_CHANGE_CANDIDATE", recommendation: "ALERT_RECOMMENDED", sourceEvent: false };
  }
  if (!input.rawChanged && input.semanticChanged) {
    return { classification: "PARSER_VERSION_CHANGE", recommendation: "NO_ACTION", sourceEvent: false };
  }
  if (!input.rawChanged && !input.semanticChanged) {
    return { classification: "NO_EVENT", recommendation: "NO_ACTION", sourceEvent: false };
  }
  if (input.rawChanged && input.semanticChanged) {
    return { classification: "CONFIRMED_SEMANTIC_EVENT", recommendation: "CAPTURE_RECOMMENDED", sourceEvent: true };
  }
  if (input.parserStatus === "warning") {
    return { classification: "UNKNOWN_CHANGE", recommendation: "ALERT_RECOMMENDED", sourceEvent: false };
  }
  return { classification: "RAW_ONLY_COSMETIC_CHANGE", recommendation: "NO_ACTION", sourceEvent: false };
}
