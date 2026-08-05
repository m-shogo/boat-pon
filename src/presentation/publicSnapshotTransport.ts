import {
  assertPublicDashboardSnapshot,
  validatePublicDashboardSnapshot,
  type PublicDashboardSnapshot,
} from "./publicSnapshot";

export const PUBLIC_SNAPSHOT_DIGEST_PLACEHOLDER = "0".repeat(64);
export const DEFAULT_PUBLIC_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type PublicSnapshotFreshness = "FRESH" | "STALE" | "NOT_AVAILABLE";

export type PublicSnapshotFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type PublicSnapshotFetcher = (
  url: string,
  init?: {
    cache?: "no-store";
    headers?: Record<string, string>;
  },
) => Promise<PublicSnapshotFetchResponse>;

export type PublicSnapshotLoadResult = {
  snapshot: PublicDashboardSnapshot | null;
  source: "network" | "not-available";
  observedFreshness: PublicSnapshotFreshness;
  errors: string[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalizePublicSnapshotValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("public snapshot contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePublicSnapshotValue(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizePublicSnapshotValue(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`public snapshot contains unsupported value type: ${typeof value}`);
}

export function publicSnapshotDigestPayload(snapshot: PublicDashboardSnapshot): PublicDashboardSnapshot {
  return {
    ...structuredClone(snapshot),
    integrity: {
      algorithm: "sha256",
      digest: PUBLIC_SNAPSHOT_DIGEST_PLACEHOLDER,
    },
  };
}

export async function computePublicDashboardSnapshotDigest(
  snapshot: PublicDashboardSnapshot,
): Promise<string> {
  const payload = publicSnapshotDigestPayload(snapshot);
  const bytes = new TextEncoder().encode(canonicalizePublicSnapshotValue(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sealPublicDashboardSnapshot(
  snapshot: PublicDashboardSnapshot,
): Promise<PublicDashboardSnapshot> {
  assertPublicDashboardSnapshot(snapshot);
  const sealed = publicSnapshotDigestPayload(snapshot);
  sealed.integrity.digest = await computePublicDashboardSnapshotDigest(sealed);
  assertPublicDashboardSnapshot(sealed);
  return sealed;
}

export async function verifyPublicDashboardSnapshotIntegrity(
  value: unknown,
): Promise<{ ok: boolean; errors: string[]; snapshot: PublicDashboardSnapshot | null }> {
  const validation = validatePublicDashboardSnapshot(value);
  if (!validation.ok) return { ok: false, errors: validation.errors, snapshot: null };

  const snapshot = value as PublicDashboardSnapshot;
  const expected = await computePublicDashboardSnapshotDigest(snapshot);
  if (expected !== snapshot.integrity.digest) {
    return {
      ok: false,
      errors: ["$.integrity.digest: digest mismatch"],
      snapshot: null,
    };
  }
  return { ok: true, errors: [], snapshot };
}

export async function loadPublicDashboardSnapshot(options: {
  url?: string;
  fetcher?: PublicSnapshotFetcher;
  nowMs?: number;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
} = {}): Promise<PublicSnapshotLoadResult> {
  const url = options.url ?? "/public-data/latest.json";
  const fetcher = options.fetcher ?? (globalThis.fetch as PublicSnapshotFetcher | undefined);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PUBLIC_SNAPSHOT_MAX_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS;

  if (!fetcher) return unavailable("FETCH_UNAVAILABLE");
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return unavailable("INVALID_FRESHNESS_CONFIGURATION");
  }

  let response: PublicSnapshotFetchResponse;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return unavailable("NETWORK_ERROR");
  }

  if (!response.ok) return unavailable(`HTTP_${response.status}`);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return unavailable("INVALID_JSON");
  }

  const verified = await verifyPublicDashboardSnapshotIntegrity(value);
  if (!verified.ok || !verified.snapshot) return unavailable("INVALID_OR_UNVERIFIED_SNAPSHOT");

  const dataAsOfMs = Date.parse(verified.snapshot.dataAsOf);
  if (dataAsOfMs - nowMs > maxFutureSkewMs) return unavailable("FUTURE_DATA_AS_OF");

  const observedFreshness: PublicSnapshotFreshness = nowMs - dataAsOfMs > maxAgeMs ? "STALE" : "FRESH";
  const warnings: string[] = [];
  if (verified.snapshot.status.snapshotFreshness !== observedFreshness) {
    warnings.push("DECLARED_FRESHNESS_MISMATCH");
  }

  return {
    snapshot: verified.snapshot,
    source: "network",
    observedFreshness,
    errors: [],
    warnings,
  };
}

function unavailable(error: string): PublicSnapshotLoadResult {
  return {
    snapshot: null,
    source: "not-available",
    observedFreshness: "NOT_AVAILABLE",
    errors: [error],
    warnings: [],
  };
}
