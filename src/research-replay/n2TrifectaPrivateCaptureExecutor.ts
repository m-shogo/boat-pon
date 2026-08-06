import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

import {
  countUnavailableTrifectaSelections,
  parseAllTrifectaOdds,
} from "../domain/oddsParser";
import { canonicalHash } from "./canonical";
import {
  N2_TRIFECTA_RAW_PARSER_VERSION,
  parseBoatRaceDisplayedOddsUpdateTime,
} from "./n2TrifectaRawCaptureCanary";
import {
  auditN2TrifectaOddsCaptureApproval,
  buildN2TrifectaRawRelativePath,
  type N2TrifectaOddsCaptureApproval,
  type N2TrifectaOddsCheckpointEntry,
  type N2TrifectaOddsCheckpointPlan,
} from "./n2TrifectaOddsCheckpointCollection";
import {
  auditN2TrifectaMarketSnapshot,
  type N2TrifectaMarketSnapshotCandidate,
  type N2TrifectaSnapshotAudit,
} from "./n2TrifectaMarketFoundation";

export const N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION =
  "n2-trifecta-private-capture-executor-v1";
export const N2_TRIFECTA_PRIVATE_CAPTURE_MAX_RAW_BYTES = 2_000_000;
export const N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS = 60;
export const N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS = 120;

export type N2TrifectaPrivateFetchResult = {
  statusCode: number;
  contentType: string;
  headers: Record<string, string | undefined>;
  rawBytes: Uint8Array;
  fetchedAt: string;
};

export type N2TrifectaPrivateFetcher = (
  entry: N2TrifectaOddsCheckpointEntry,
) => Promise<N2TrifectaPrivateFetchResult>;

export type N2TrifectaPrivateCaptureEnvelope = {
  envelopeVersion: "n2-trifecta-private-capture-envelope-v1";
  status: "PASS" | "BLOCKED";
  blockers: string[];
  manifestDigest: string;
  checkpointKey: string;
  entry: N2TrifectaOddsCheckpointEntry;
  response: {
    statusCode: number;
    contentType: string;
    fetchedAt: string;
    rawByteLength: number;
    rawSha256: string;
    headers: Record<string, string>;
  };
  sourceDisplayedUpdate: ReturnType<typeof parseBoatRaceDisplayedOddsUpdateTime>;
  parserVersion: typeof N2_TRIFECTA_RAW_PARSER_VERSION;
  parsedSelectionCount: number;
  unavailableSelectionCount: number;
  rawDocumentId: string | null;
  parseRunId: string | null;
  proposedObservationId: string | null;
  snapshotCandidate: N2TrifectaMarketSnapshotCandidate | null;
  snapshotAudit: N2TrifectaSnapshotAudit | null;
  rawRelativePath: string | null;
  envelopeRelativePath: string | null;
  acceptedMarkerRelativePath: string;
  databaseWriteAuthorized: false;
  currentBuyConnectionAuthorized: false;
  lineConnectionAuthorized: false;
  publicPublishAuthorized: false;
  productionApplyExecuted: false;
};

export type N2TrifectaPrivateCaptureEntryResult = {
  checkpointKey: string;
  raceIdentity: string;
  checkpointLabel: string;
  result:
    | "CAPTURED"
    | "BLOCKED_EVIDENCE_SAVED"
    | "ALREADY_ACCEPTED"
    | "ATTEMPT_ALREADY_RECORDED"
    | "NOT_DUE";
  blockers: string[];
  attemptId: string | null;
  rawRelativePath: string | null;
  envelopeRelativePath: string | null;
};

export type N2TrifectaPrivateCaptureRunReport = {
  reportVersion: "n2-trifecta-private-capture-run-v1";
  executorVersion: typeof N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION;
  status: "PASS" | "NO_CHANGE" | "DRY_RUN" | "BLOCKED";
  executionMode: "dry-run" | "execute";
  startedAt: string;
  completedAt: string;
  manifestDigest: string;
  approvalId: string | null;
  approvalAudit: ReturnType<typeof auditN2TrifectaOddsCaptureApproval>;
  dueEntryCount: number;
  networkRequestCount: number;
  capturedCount: number;
  blockedEvidenceCount: number;
  skippedCount: number;
  stoppedEarly: boolean;
  blockers: string[];
  entryResults: N2TrifectaPrivateCaptureEntryResult[];
  ledgerRelativePath: string;
  databaseWriteCount: 0;
  primaryDbWriteCount: 0;
  sidecarWriteCount: 0;
  currentBuyChanged: false;
  lineChanged: false;
  publicPublished: false;
  automatedBettingChanged: false;
  productionApplyExecuted: false;
  outputDigest: string;
};

export type N2TrifectaPrivateCaptureExecutorInput = {
  plan: N2TrifectaOddsCheckpointPlan;
  approval: N2TrifectaOddsCaptureApproval | null;
  rootDir: string;
  now: string;
  executionMode: "dry-run" | "execute";
  fetcher?: N2TrifectaPrivateFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
};

type AttemptLedgerEvent = {
  ledgerVersion: "n2-trifecta-private-capture-ledger-v1";
  event: "ATTEMPT_STARTED" | "ATTEMPT_COMPLETED";
  attemptId: string;
  checkpointKey: string;
  manifestDigest: string;
  raceIdentity: string;
  checkpointLabel: string;
  sourceUrl: string;
  at: string;
  result?: "PASS" | "BLOCKED" | "FETCH_ERROR";
  rawSha256?: string | null;
  blockers?: string[];
};

const ALLOWED_HEADERS = new Set([
  "cache-control",
  "content-length",
  "content-type",
  "date",
  "etag",
  "last-modified",
]);

function parseInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleepDefault(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function sanitizeHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.trim().toLowerCase();
    if (!ALLOWED_HEADERS.has(normalized) || value == null) continue;
    entries.push([normalized, value.slice(0, 1_000)]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function checkpointKey(
  manifestDigest: string,
  entry: N2TrifectaOddsCheckpointEntry,
): string {
  return canonicalHash({
    manifestDigest,
    raceIdentity: entry.raceIdentity,
    checkpointLabel: entry.checkpointLabel,
    targetCaptureAt: entry.targetCaptureAt,
    sourceUrl: entry.sourceUrl,
  });
}

function checkpointDirectory(entry: N2TrifectaOddsCheckpointEntry): string {
  return [
    "data",
    "raw",
    "research",
    "trifecta-market",
    entry.date,
    entry.venueCode,
    String(entry.raceNo).padStart(2, "0"),
    entry.checkpointLabel,
  ].join("/");
}

function acceptedMarkerRelativePath(entry: N2TrifectaOddsCheckpointEntry): string {
  return `${checkpointDirectory(entry)}/accepted.json`;
}

function ledgerRelativePath(manifestDigest: string): string {
  return `data/raw/research/trifecta-market/ledgers/${manifestDigest}.jsonl`;
}

function lockRelativePath(manifestDigest: string): string {
  return `data/tmp/n2-trifecta-private-capture/${manifestDigest}.lock`;
}

function resolveInside(rootDir: string, relativePath: string): string {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("UNSAFE_RELATIVE_PATH");
  }
  const root = resolve(rootDir);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("PATH_ESCAPES_ROOT");
  }
  return target;
}

function exclusiveWrite(path: string, content: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "wx", 0o600);
  try {
    if (typeof content === "string") writeFileSync(fd, content, "utf8");
    else writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

function appendLedger(
  rootDir: string,
  relativePath: string,
  event: AttemptLedgerEvent,
): void {
  const path = resolveInside(rootDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

function readAttemptedCheckpointKeys(
  rootDir: string,
  relativePath: string,
): Set<string> {
  const path = resolveInside(rootDir, relativePath);
  if (!existsSync(path)) return new Set();
  const content = readFileSync(path, "utf8");
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let parsed: Partial<AttemptLedgerEvent>;
    try {
      parsed = JSON.parse(line) as Partial<AttemptLedgerEvent>;
    } catch {
      throw new Error("ATTEMPT_LEDGER_INVALID_JSON");
    }
    if (parsed.event === "ATTEMPT_STARTED" && typeof parsed.checkpointKey === "string") {
      keys.add(parsed.checkpointKey);
    }
  }
  return keys;
}

function isDue(entry: N2TrifectaOddsCheckpointEntry, nowMs: number): boolean {
  const targetMs = parseInstant(entry.targetCaptureAt);
  if (targetMs == null) return false;
  return nowMs >= targetMs - N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS * 1_000
    && nowMs <= targetMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000;
}

function buildEnvelope(input: {
  plan: N2TrifectaOddsCheckpointPlan;
  entry: N2TrifectaOddsCheckpointEntry;
  response: N2TrifectaPrivateFetchResult;
}): N2TrifectaPrivateCaptureEnvelope {
  const blockers: string[] = [];
  const { entry, response, plan } = input;
  const fetchedAtMs = parseInstant(response.fetchedAt);
  const targetAtMs = parseInstant(entry.targetCaptureAt);
  const cutoffMs = parseInstant(entry.decisionCutoff);

  if (response.statusCode !== 200) blockers.push("HTTP_STATUS_NOT_200");
  if (!response.contentType.toLowerCase().includes("text/html")) {
    blockers.push("CONTENT_TYPE_NOT_HTML");
  }
  if (response.rawBytes.byteLength === 0) blockers.push("RAW_BYTES_EMPTY");
  if (response.rawBytes.byteLength > N2_TRIFECTA_PRIVATE_CAPTURE_MAX_RAW_BYTES) {
    blockers.push("RAW_BYTES_TOO_LARGE");
  }
  if (fetchedAtMs == null) blockers.push("FETCHED_AT_INVALID");
  if (targetAtMs == null) blockers.push("TARGET_CAPTURE_AT_INVALID");
  if (cutoffMs == null) blockers.push("DECISION_CUTOFF_INVALID");
  if (
    fetchedAtMs != null && targetAtMs != null
    && fetchedAtMs < targetAtMs - N2_TRIFECTA_PRIVATE_CAPTURE_EARLY_WINDOW_SECONDS * 1_000
  ) {
    blockers.push("FETCH_BEFORE_CHECKPOINT_WINDOW");
  }
  if (
    fetchedAtMs != null && targetAtMs != null
    && fetchedAtMs > targetAtMs + N2_TRIFECTA_PRIVATE_CAPTURE_LATE_WINDOW_SECONDS * 1_000
  ) {
    blockers.push("FETCH_AFTER_CHECKPOINT_WINDOW");
  }
  if (fetchedAtMs != null && cutoffMs != null && fetchedAtMs > cutoffMs) {
    blockers.push("FETCH_AFTER_DECISION_CUTOFF");
  }

  const html = Buffer.from(response.rawBytes).toString("utf8");
  if (html.replace(/[\s　]+/gu, " ").includes("締切時オッズ")) {
    blockers.push("CLOSING_ODDS_NOT_PREDECISION");
  }
  const sourceDisplayedUpdate = parseBoatRaceDisplayedOddsUpdateTime(html, entry.date);
  if (sourceDisplayedUpdate.status === "MISSING") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_MISSING");
  } else if (sourceDisplayedUpdate.status === "AMBIGUOUS") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_AMBIGUOUS");
  } else if (sourceDisplayedUpdate.status !== "PASS") {
    blockers.push("DISPLAYED_ODDS_UPDATE_TIME_INVALID");
  }

  const availableAtMs = sourceDisplayedUpdate.availableAt
    ? parseInstant(sourceDisplayedUpdate.availableAt)
    : null;
  if (availableAtMs != null && fetchedAtMs != null && availableAtMs > fetchedAtMs) {
    blockers.push("DISPLAYED_UPDATE_AFTER_FETCH");
  }
  if (availableAtMs != null && cutoffMs != null && availableAtMs > cutoffMs) {
    blockers.push("DISPLAYED_UPDATE_AFTER_DECISION_CUTOFF");
  }

  const parsedOdds = parseAllTrifectaOdds(html);
  const unavailableSelectionCount = countUnavailableTrifectaSelections(html);
  if (parsedOdds.size !== 120) blockers.push("PARSED_SELECTION_COUNT_NOT_120");
  if (unavailableSelectionCount !== 0) blockers.push("UNAVAILABLE_SELECTIONS_PRESENT");

  const rawSha256 = sha256(response.rawBytes);
  const rawDocumentId = response.rawBytes.byteLength > 0
    ? `raw-${canonicalHash({
        manifestDigest: plan.manifestDigest,
        sourceUrl: entry.sourceUrl,
        fetchedAt: response.fetchedAt,
        rawSha256,
      }).slice(0, 40)}`
    : null;
  const parseRunId = rawDocumentId
    ? `parse-${canonicalHash({
        rawDocumentId,
        parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
      }).slice(0, 40)}`
    : null;
  const proposedObservationId = parseRunId
    ? `obs-${canonicalHash({
        raceIdentity: entry.raceIdentity,
        checkpointLabel: entry.checkpointLabel,
        rawDocumentId,
        parseRunId,
      }).slice(0, 40)}`
    : null;

  let snapshotCandidate: N2TrifectaMarketSnapshotCandidate | null = null;
  let snapshotAudit: N2TrifectaSnapshotAudit | null = null;
  if (
    sourceDisplayedUpdate.availableAt
    && rawDocumentId
    && parseRunId
    && proposedObservationId
  ) {
    snapshotCandidate = {
      raceId: entry.raceIdentity,
      checkpointLabel: entry.checkpointLabel,
      capturedAt: response.fetchedAt,
      availableAt: sourceDisplayedUpdate.availableAt,
      decisionCutoff: entry.decisionCutoff,
      rawDocumentId,
      rawPayloadDigest: rawSha256,
      parseRunId,
      sourceUrl: entry.sourceUrl,
      proposedObservationId,
      odds: [...parsedOdds.entries()]
        .map(([selection, odds]) => ({
          selection: selection.replaceAll("-", ""),
          odds,
        }))
        .sort((left, right) => left.selection.localeCompare(right.selection)),
    };
    snapshotAudit = auditN2TrifectaMarketSnapshot(snapshotCandidate);
    for (const blocker of snapshotAudit.blockers) blockers.push(`SNAPSHOT_${blocker}`);
  } else {
    blockers.push("SNAPSHOT_CANDIDATE_UNRESOLVED");
  }

  const normalizedBlockers = unique(blockers);
  const rawRelativePath = rawDocumentId
    ? buildN2TrifectaRawRelativePath({
        entry,
        fetchedAt: response.fetchedAt,
        rawSha256,
      })
    : null;
  const envelopeRelativePath = rawRelativePath
    ? rawRelativePath.replace(/\.html$/u, ".envelope.json")
    : null;

  return {
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: normalizedBlockers.length === 0 ? "PASS" : "BLOCKED",
    blockers: normalizedBlockers,
    manifestDigest: plan.manifestDigest,
    checkpointKey: checkpointKey(plan.manifestDigest, entry),
    entry,
    response: {
      statusCode: response.statusCode,
      contentType: response.contentType,
      fetchedAt: response.fetchedAt,
      rawByteLength: response.rawBytes.byteLength,
      rawSha256,
      headers: sanitizeHeaders(response.headers),
    },
    sourceDisplayedUpdate,
    parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
    parsedSelectionCount: parsedOdds.size,
    unavailableSelectionCount,
    rawDocumentId,
    parseRunId,
    proposedObservationId,
    snapshotCandidate,
    snapshotAudit,
    rawRelativePath,
    envelopeRelativePath,
    acceptedMarkerRelativePath: acceptedMarkerRelativePath(entry),
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  };
}

async function readResponseBodyBounded(
  response: Response,
  controller: AbortController,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > N2_TRIFECTA_PRIVATE_CAPTURE_MAX_RAW_BYTES) {
      controller.abort();
      throw new Error("RAW_BYTES_TOO_LARGE");
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function fetchN2TrifectaOfficialOddsOnce(
  entry: N2TrifectaOddsCheckpointEntry,
): Promise<N2TrifectaPrivateFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(entry.sourceUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "BoatPon/0.1 private-research bounded checkpoint capture",
      },
    });
    const rawBytes = await readResponseBodyBounded(response, controller);
    const headers: Record<string, string | undefined> = {};
    for (const name of ALLOWED_HEADERS) headers[name] = response.headers.get(name) ?? undefined;
    return {
      statusCode: response.status,
      contentType: response.headers.get("content-type") ?? "",
      headers,
      rawBytes,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeN2TrifectaPrivateCapture(
  input: N2TrifectaPrivateCaptureExecutorInput,
): Promise<N2TrifectaPrivateCaptureRunReport> {
  const startedAt = new Date().toISOString();
  const blockers: string[] = [];
  const entryResults: N2TrifectaPrivateCaptureEntryResult[] = [];
  const nowMs = parseInstant(input.now);
  if (nowMs == null) blockers.push("INVALID_EXECUTION_TIME");

  const approvalAudit = auditN2TrifectaOddsCaptureApproval({
    plan: input.plan,
    approval: input.approval,
    now: input.now,
  });
  for (const blocker of approvalAudit.blockers) blockers.push(`APPROVAL_${blocker}`);

  const ledgerPath = ledgerRelativePath(input.plan.manifestDigest);
  const dueEntries = nowMs == null
    ? []
    : input.plan.entries.filter((entry) => isDue(entry, nowMs));

  if (input.executionMode === "dry-run") {
    const core = {
      reportVersion: "n2-trifecta-private-capture-run-v1" as const,
      executorVersion: N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION,
      status: "DRY_RUN" as const,
      executionMode: input.executionMode,
      startedAt,
      completedAt: new Date().toISOString(),
      manifestDigest: input.plan.manifestDigest,
      approvalId: input.approval?.approvalId ?? null,
      approvalAudit,
      dueEntryCount: dueEntries.length,
      networkRequestCount: 0,
      capturedCount: 0,
      blockedEvidenceCount: 0,
      skippedCount: input.plan.entries.length,
      stoppedEarly: false,
      blockers: unique(blockers),
      entryResults,
      ledgerRelativePath: ledgerPath,
      databaseWriteCount: 0 as const,
      primaryDbWriteCount: 0 as const,
      sidecarWriteCount: 0 as const,
      currentBuyChanged: false as const,
      lineChanged: false as const,
      publicPublished: false as const,
      automatedBettingChanged: false as const,
      productionApplyExecuted: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  if (approvalAudit.status !== "PASS" || blockers.length > 0) {
    const core = {
      reportVersion: "n2-trifecta-private-capture-run-v1" as const,
      executorVersion: N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION,
      status: "BLOCKED" as const,
      executionMode: input.executionMode,
      startedAt,
      completedAt: new Date().toISOString(),
      manifestDigest: input.plan.manifestDigest,
      approvalId: input.approval?.approvalId ?? null,
      approvalAudit,
      dueEntryCount: dueEntries.length,
      networkRequestCount: 0,
      capturedCount: 0,
      blockedEvidenceCount: 0,
      skippedCount: input.plan.entries.length,
      stoppedEarly: true,
      blockers: unique(blockers),
      entryResults,
      ledgerRelativePath: ledgerPath,
      databaseWriteCount: 0 as const,
      primaryDbWriteCount: 0 as const,
      sidecarWriteCount: 0 as const,
      currentBuyChanged: false as const,
      lineChanged: false as const,
      publicPublished: false as const,
      automatedBettingChanged: false as const,
      productionApplyExecuted: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  const lockPath = resolveInside(input.rootDir, lockRelativePath(input.plan.manifestDigest));
  mkdirSync(dirname(lockPath), { recursive: true });
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
  } catch {
    blockers.push("CAPTURE_LEASE_HELD");
    const core = {
      reportVersion: "n2-trifecta-private-capture-run-v1" as const,
      executorVersion: N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION,
      status: "BLOCKED" as const,
      executionMode: input.executionMode,
      startedAt,
      completedAt: new Date().toISOString(),
      manifestDigest: input.plan.manifestDigest,
      approvalId: input.approval?.approvalId ?? null,
      approvalAudit,
      dueEntryCount: dueEntries.length,
      networkRequestCount: 0,
      capturedCount: 0,
      blockedEvidenceCount: 0,
      skippedCount: input.plan.entries.length,
      stoppedEarly: true,
      blockers: unique(blockers),
      entryResults,
      ledgerRelativePath: ledgerPath,
      databaseWriteCount: 0 as const,
      primaryDbWriteCount: 0 as const,
      sidecarWriteCount: 0 as const,
      currentBuyChanged: false as const,
      lineChanged: false as const,
      publicPublished: false as const,
      automatedBettingChanged: false as const,
      productionApplyExecuted: false as const,
    };
    return { ...core, outputDigest: canonicalHash(core) };
  }

  closeSync(lockFd);
  let networkRequestCount = 0;
  let capturedCount = 0;
  let blockedEvidenceCount = 0;
  let stoppedEarly = false;
  const fetcher = input.fetcher ?? fetchN2TrifectaOfficialOddsOnce;
  const sleep = input.sleep ?? sleepDefault;

  try {
    const attemptedKeys = readAttemptedCheckpointKeys(input.rootDir, ledgerPath);
    for (let index = 0; index < input.plan.entries.length; index += 1) {
      const entry = input.plan.entries[index];
      const key = checkpointKey(input.plan.manifestDigest, entry);
      const markerRelative = acceptedMarkerRelativePath(entry);
      const markerPath = resolveInside(input.rootDir, markerRelative);

      if (!dueEntries.includes(entry)) {
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "NOT_DUE",
          blockers: [],
          attemptId: null,
          rawRelativePath: null,
          envelopeRelativePath: null,
        });
        continue;
      }
      if (existsSync(markerPath)) {
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "ALREADY_ACCEPTED",
          blockers: [],
          attemptId: null,
          rawRelativePath: null,
          envelopeRelativePath: null,
        });
        continue;
      }
      if (attemptedKeys.has(key)) {
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "ATTEMPT_ALREADY_RECORDED",
          blockers: ["MAX_ATTEMPTS_REACHED"],
          attemptId: null,
          rawRelativePath: null,
          envelopeRelativePath: null,
        });
        continue;
      }
      if (networkRequestCount >= input.approval!.maxRequests) {
        blockers.push("REQUEST_BUDGET_EXHAUSTED");
        stoppedEarly = true;
        break;
      }

      if (networkRequestCount > 0) {
        await sleep(input.plan.minInterRequestMs);
      }
      const attemptId = `attempt-${canonicalHash({
        manifestDigest: input.plan.manifestDigest,
        checkpointKey: key,
        startedAt: new Date().toISOString(),
      }).slice(0, 40)}`;
      appendLedger(input.rootDir, ledgerPath, {
        ledgerVersion: "n2-trifecta-private-capture-ledger-v1",
        event: "ATTEMPT_STARTED",
        attemptId,
        checkpointKey: key,
        manifestDigest: input.plan.manifestDigest,
        raceIdentity: entry.raceIdentity,
        checkpointLabel: entry.checkpointLabel,
        sourceUrl: entry.sourceUrl,
        at: new Date().toISOString(),
      });
      attemptedKeys.add(key);
      networkRequestCount += 1;

      let response: N2TrifectaPrivateFetchResult;
      try {
        response = await fetcher(entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appendLedger(input.rootDir, ledgerPath, {
          ledgerVersion: "n2-trifecta-private-capture-ledger-v1",
          event: "ATTEMPT_COMPLETED",
          attemptId,
          checkpointKey: key,
          manifestDigest: input.plan.manifestDigest,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          sourceUrl: entry.sourceUrl,
          at: new Date().toISOString(),
          result: "FETCH_ERROR",
          rawSha256: null,
          blockers: [message.slice(0, 500)],
        });
        blockers.push("FETCH_ERROR");
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "BLOCKED_EVIDENCE_SAVED",
          blockers: ["FETCH_ERROR"],
          attemptId,
          rawRelativePath: null,
          envelopeRelativePath: null,
        });
        stoppedEarly = true;
        break;
      }

      const envelope = buildEnvelope({ plan: input.plan, entry, response });
      if (envelope.rawRelativePath && envelope.envelopeRelativePath) {
        const rawPath = resolveInside(input.rootDir, envelope.rawRelativePath);
        const envelopePath = resolveInside(input.rootDir, envelope.envelopeRelativePath);
        exclusiveWrite(rawPath, response.rawBytes);
        exclusiveWrite(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`);
      }
      appendLedger(input.rootDir, ledgerPath, {
        ledgerVersion: "n2-trifecta-private-capture-ledger-v1",
        event: "ATTEMPT_COMPLETED",
        attemptId,
        checkpointKey: key,
        manifestDigest: input.plan.manifestDigest,
        raceIdentity: entry.raceIdentity,
        checkpointLabel: entry.checkpointLabel,
        sourceUrl: entry.sourceUrl,
        at: new Date().toISOString(),
        result: envelope.status,
        rawSha256: envelope.response.rawSha256,
        blockers: envelope.blockers,
      });

      if (envelope.status === "PASS") {
        exclusiveWrite(markerPath, `${JSON.stringify({
          markerVersion: "n2-trifecta-private-capture-accepted-v1",
          manifestDigest: input.plan.manifestDigest,
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          rawDocumentId: envelope.rawDocumentId,
          rawSha256: envelope.response.rawSha256,
          rawRelativePath: envelope.rawRelativePath,
          envelopeRelativePath: envelope.envelopeRelativePath,
          acceptedAt: new Date().toISOString(),
          databaseWriteAuthorized: false,
          productionApplyExecuted: false,
        }, null, 2)}\n`);
        capturedCount += 1;
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "CAPTURED",
          blockers: [],
          attemptId,
          rawRelativePath: envelope.rawRelativePath,
          envelopeRelativePath: envelope.envelopeRelativePath,
        });
      } else {
        blockedEvidenceCount += 1;
        blockers.push(...envelope.blockers);
        entryResults.push({
          checkpointKey: key,
          raceIdentity: entry.raceIdentity,
          checkpointLabel: entry.checkpointLabel,
          result: "BLOCKED_EVIDENCE_SAVED",
          blockers: envelope.blockers,
          attemptId,
          rawRelativePath: envelope.rawRelativePath,
          envelopeRelativePath: envelope.envelopeRelativePath,
        });
        stoppedEarly = true;
        break;
      }
    }
  } finally {
    rmSync(lockPath, { force: true });
  }

  const normalizedBlockers = unique(blockers);
  const skippedCount = entryResults.filter((entry) => [
    "ALREADY_ACCEPTED",
    "ATTEMPT_ALREADY_RECORDED",
    "NOT_DUE",
  ].includes(entry.result)).length;
  const status = normalizedBlockers.length > 0
    ? "BLOCKED" as const
    : capturedCount > 0
      ? "PASS" as const
      : "NO_CHANGE" as const;
  const core = {
    reportVersion: "n2-trifecta-private-capture-run-v1" as const,
    executorVersion: N2_TRIFECTA_PRIVATE_CAPTURE_EXECUTOR_VERSION,
    status,
    executionMode: input.executionMode,
    startedAt,
    completedAt: new Date().toISOString(),
    manifestDigest: input.plan.manifestDigest,
    approvalId: input.approval?.approvalId ?? null,
    approvalAudit,
    dueEntryCount: dueEntries.length,
    networkRequestCount,
    capturedCount,
    blockedEvidenceCount,
    skippedCount,
    stoppedEarly,
    blockers: normalizedBlockers,
    entryResults,
    ledgerRelativePath: ledgerPath,
    databaseWriteCount: 0 as const,
    primaryDbWriteCount: 0 as const,
    sidecarWriteCount: 0 as const,
    currentBuyChanged: false as const,
    lineChanged: false as const,
    publicPublished: false as const,
    automatedBettingChanged: false as const,
    productionApplyExecuted: false as const,
  };
  return { ...core, outputDigest: canonicalHash(core) };
}
