export type N2ExternalSourceId =
  | "boatrace_official_trifecta_odds_html"
  | "boatrace_official_beforeinfo_html"
  | "jma_historical_station_csv";

export type N2SourceRole =
  | "trifecta_market"
  | "pre_race_environment"
  | "historical_environment_validation";

export type N2TermsReviewStatus =
  | "LEGAL_REVIEW_REQUIRED"
  | "PUBLIC_DATA_TERMS_REVIEWED_ATTRIBUTION_REQUIRED";

export type N2CaptureMode =
  | "CONTRACT_ONLY_NO_NETWORK"
  | "BOUNDED_MANUAL_REVIEW"
  | "HISTORICAL_BATCH_ONLY";

export type N2AvailabilityBasis =
  | "source_displayed_at"
  | "monotonic_first_seen_at"
  | "historical_observation_time";

export interface N2ExternalSourceDefinition {
  sourceId: N2ExternalSourceId;
  priority: 0 | 1 | 2;
  role: N2SourceRole;
  authority: "official";
  host: string;
  pathPrefix: string;
  captureMode: N2CaptureMode;
  termsReviewStatus: N2TermsReviewStatus;
  realTimeDecisionEligible: boolean;
  productionCaptureAuthorized: false;
  productionWriteAuthorized: false;
  requiredFields: readonly string[];
  caveats: readonly string[];
}

export interface N2CaptureProposal {
  sourceId: N2ExternalSourceId;
  sourceUrl: string;
  canonicalRaceId: string | null;
  checkpointLabel: string;
  fetchedAt: string;
  availableAt: string;
  availabilityBasis: N2AvailabilityBasis;
  decisionCutoff: string | null;
  contentType: string;
  rawByteLength: number;
  rawSha256: string;
  parserVersion: string;
  termsReviewApproved: boolean;
  boundedCaptureApprovalId: string | null;
  requestedMode: "review" | "production";
}

export interface N2CaptureProposalAudit {
  status:
    | "STRUCTURALLY_READY_FOR_BOUNDED_REVIEW"
    | "INVENTORY_ONLY"
    | "BLOCKED";
  blockers: string[];
  productionCaptureAuthorized: false;
  productionWriteAuthorized: false;
  pitVerified: boolean;
}

export const N2_EXTERNAL_SOURCE_CATALOG: readonly N2ExternalSourceDefinition[] =
  Object.freeze([
    Object.freeze({
      sourceId: "boatrace_official_trifecta_odds_html",
      priority: 0,
      role: "trifecta_market",
      authority: "official",
      host: "www.boatrace.jp",
      pathPrefix: "/owpc/pc/race/odds3t",
      captureMode: "CONTRACT_ONLY_NO_NETWORK",
      termsReviewStatus: "LEGAL_REVIEW_REQUIRED",
      realTimeDecisionEligible: true,
      productionCaptureAuthorized: false,
      productionWriteAuthorized: false,
      requiredFields: Object.freeze([
        "canonicalRaceId",
        "sourceUrl",
        "displayedOddsUpdateTime",
        "decisionCutoff",
        "exact120OrderedSelections",
        "rawBytes",
        "rawSha256",
        "fetchedAt",
        "availableAt",
        "parserVersion",
      ]),
      caveats: Object.freeze([
        "The page can expose an odds update time, but capture and reuse terms require review before automation.",
        "A complete checkpoint requires exactly 120 distinct ordered trifecta selections.",
        "The displayed update time, fetched time, and decision cutoff must be audited atomically.",
      ]),
    }),
    Object.freeze({
      sourceId: "boatrace_official_beforeinfo_html",
      priority: 1,
      role: "pre_race_environment",
      authority: "official",
      host: "www.boatrace.jp",
      pathPrefix: "/owpc/pc/race/beforeinfo",
      captureMode: "CONTRACT_ONLY_NO_NETWORK",
      termsReviewStatus: "LEGAL_REVIEW_REQUIRED",
      realTimeDecisionEligible: true,
      productionCaptureAuthorized: false,
      productionWriteAuthorized: false,
      requiredFields: Object.freeze([
        "canonicalRaceId",
        "sourceUrl",
        "exhibitionTime",
        "exhibitionStartTiming",
        "exhibitionCourse",
        "tilt",
        "partsChanges",
        "weather",
        "airTemperature",
        "waterTemperature",
        "windDirection",
        "windSpeed",
        "waveHeight",
        "rawBytes",
        "rawSha256",
        "fetchedAt",
        "availableAt",
        "decisionCutoff",
        "parserVersion",
      ]),
      caveats: Object.freeze([
        "Fetched-at time must not be relabeled as source publication time.",
        "When the page has no trustworthy displayed update time, monotonic first-seen evidence is required.",
        "Official race-water conditions take precedence over a distant weather station for the race checkpoint.",
      ]),
    }),
    Object.freeze({
      sourceId: "jma_historical_station_csv",
      priority: 2,
      role: "historical_environment_validation",
      authority: "official",
      host: "www.data.jma.go.jp",
      pathPrefix: "/risk/obsdl/",
      captureMode: "HISTORICAL_BATCH_ONLY",
      termsReviewStatus: "PUBLIC_DATA_TERMS_REVIEWED_ATTRIBUTION_REQUIRED",
      realTimeDecisionEligible: false,
      productionCaptureAuthorized: false,
      productionWriteAuthorized: false,
      requiredFields: Object.freeze([
        "stationId",
        "observationTime",
        "weatherElements",
        "qualityFlags",
        "homogeneityFlags",
        "downloadedAt",
        "rawBytes",
        "rawSha256",
        "sourceAttribution",
        "revisionCheckedAt",
      ]),
      caveats: Object.freeze([
        "The download service is historical validation only and is not a same-day decision source.",
        "Values can be revised after quality control; revision identity and quality flags must be retained.",
        "Requests must be bounded and must not create excessive automated access.",
      ]),
    }),
  ] satisfies readonly N2ExternalSourceDefinition[]);

const DATE_RE = /^\d{8}$/;
const VENUE_CODE_RE = /^(0[1-9]|1\d|2[0-4])$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CANONICAL_RACE_ID_RE = /^\d{8}-(0[1-9]|1\d|2[0-4])-R(0[1-9]|1[0-2])$/;

function parseIso(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceById(sourceId: N2ExternalSourceId): N2ExternalSourceDefinition {
  const source = N2_EXTERNAL_SOURCE_CATALOG.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (!source) throw new Error(`UNKNOWN_EXTERNAL_SOURCE:${sourceId}`);
  return source;
}

export function buildBoatRaceOfficialSourceUrl(
  sourceId:
    | "boatrace_official_trifecta_odds_html"
    | "boatrace_official_beforeinfo_html",
  input: { date: string; venueCode: string; raceNo: number },
): string {
  if (!DATE_RE.test(input.date)) throw new Error("INVALID_RACE_DATE");
  if (!VENUE_CODE_RE.test(input.venueCode)) {
    throw new Error("INVALID_VENUE_CODE");
  }
  if (!Number.isInteger(input.raceNo) || input.raceNo < 1 || input.raceNo > 12) {
    throw new Error("INVALID_RACE_NO");
  }
  const source = sourceById(sourceId);
  const params = new URLSearchParams({
    hd: input.date,
    jcd: input.venueCode,
    rno: String(input.raceNo),
  });
  return `https://${source.host}${source.pathPrefix}?${params.toString()}`;
}

export function auditN2CaptureProposal(
  proposal: N2CaptureProposal,
): N2CaptureProposalAudit {
  const source = sourceById(proposal.sourceId);
  const blockers: string[] = [];

  let url: URL | null = null;
  try {
    url = new URL(proposal.sourceUrl);
  } catch {
    blockers.push("INVALID_SOURCE_URL");
  }
  if (url && (url.protocol !== "https:" || url.host !== source.host)) {
    blockers.push("SOURCE_AUTHORITY_MISMATCH");
  }
  if (url && !url.pathname.startsWith(source.pathPrefix)) {
    blockers.push("SOURCE_PATH_MISMATCH");
  }

  if (source.role !== "historical_environment_validation") {
    if (!proposal.canonicalRaceId || !CANONICAL_RACE_ID_RE.test(proposal.canonicalRaceId)) {
      blockers.push("INVALID_CANONICAL_RACE_ID");
    }
    if (!proposal.decisionCutoff) blockers.push("DECISION_CUTOFF_REQUIRED");
  }

  const fetchedAt = parseIso(proposal.fetchedAt);
  const availableAt = parseIso(proposal.availableAt);
  const decisionCutoff = proposal.decisionCutoff
    ? parseIso(proposal.decisionCutoff)
    : null;
  if (fetchedAt == null) blockers.push("INVALID_FETCHED_AT");
  if (availableAt == null) blockers.push("INVALID_AVAILABLE_AT");
  if (proposal.decisionCutoff && decisionCutoff == null) {
    blockers.push("INVALID_DECISION_CUTOFF");
  }

  if (availableAt != null && fetchedAt != null && availableAt > fetchedAt) {
    blockers.push("AVAILABLE_AFTER_FETCH");
  }
  if (
    source.realTimeDecisionEligible &&
    fetchedAt != null &&
    decisionCutoff != null &&
    fetchedAt > decisionCutoff
  ) {
    blockers.push("CAPTURE_AFTER_DECISION_CUTOFF");
  }
  if (
    source.realTimeDecisionEligible &&
    availableAt != null &&
    decisionCutoff != null &&
    availableAt > decisionCutoff
  ) {
    blockers.push("AVAILABLE_AFTER_DECISION_CUTOFF");
  }

  if (proposal.rawByteLength <= 0 || !Number.isSafeInteger(proposal.rawByteLength)) {
    blockers.push("INVALID_RAW_BYTE_LENGTH");
  }
  if (!SHA256_RE.test(proposal.rawSha256)) blockers.push("INVALID_RAW_SHA256");
  if (!proposal.parserVersion.trim()) blockers.push("PARSER_VERSION_REQUIRED");
  if (!proposal.checkpointLabel.trim()) blockers.push("CHECKPOINT_LABEL_REQUIRED");
  if (!proposal.contentType.toLowerCase().includes("text/html") && proposal.sourceId !== "jma_historical_station_csv") {
    blockers.push("UNEXPECTED_CONTENT_TYPE");
  }

  if (source.sourceId === "boatrace_official_trifecta_odds_html") {
    if (proposal.availabilityBasis !== "source_displayed_at") {
      blockers.push("ODDS_DISPLAYED_UPDATE_TIME_REQUIRED");
    }
  }
  if (
    source.sourceId === "boatrace_official_beforeinfo_html" &&
    !["source_displayed_at", "monotonic_first_seen_at"].includes(
      proposal.availabilityBasis,
    )
  ) {
    blockers.push("BEFOREINFO_AVAILABILITY_EVIDENCE_REQUIRED");
  }
  if (source.sourceId === "jma_historical_station_csv") {
    if (proposal.availabilityBasis !== "historical_observation_time") {
      blockers.push("JMA_HISTORICAL_AVAILABILITY_BASIS_REQUIRED");
    }
    if (proposal.requestedMode === "production") {
      blockers.push("JMA_NOT_REALTIME_DECISION_SOURCE");
    }
  }

  if (!proposal.termsReviewApproved) blockers.push("TERMS_REVIEW_NOT_APPROVED");
  if (!proposal.boundedCaptureApprovalId) {
    blockers.push("BOUNDED_CAPTURE_APPROVAL_REQUIRED");
  }
  if (proposal.requestedMode === "production") {
    blockers.push("PRODUCTION_CAPTURE_NOT_AUTHORIZED");
  }

  const pitBlockers = new Set([
    "INVALID_FETCHED_AT",
    "INVALID_AVAILABLE_AT",
    "INVALID_DECISION_CUTOFF",
    "DECISION_CUTOFF_REQUIRED",
    "AVAILABLE_AFTER_FETCH",
    "CAPTURE_AFTER_DECISION_CUTOFF",
    "AVAILABLE_AFTER_DECISION_CUTOFF",
    "ODDS_DISPLAYED_UPDATE_TIME_REQUIRED",
    "BEFOREINFO_AVAILABILITY_EVIDENCE_REQUIRED",
  ]);
  const pitVerified = !blockers.some((blocker) => pitBlockers.has(blocker));

  const inventoryOnly = blockers.every((blocker) =>
    [
      "TERMS_REVIEW_NOT_APPROVED",
      "BOUNDED_CAPTURE_APPROVAL_REQUIRED",
      "PRODUCTION_CAPTURE_NOT_AUTHORIZED",
      "JMA_NOT_REALTIME_DECISION_SOURCE",
    ].includes(blocker),
  );

  return {
    status:
      blockers.length === 0
        ? "STRUCTURALLY_READY_FOR_BOUNDED_REVIEW"
        : inventoryOnly
          ? "INVENTORY_ONLY"
          : "BLOCKED",
    blockers,
    productionCaptureAuthorized: false,
    productionWriteAuthorized: false,
    pitVerified,
  };
}

export function summarizeN2ExternalSourceReadiness() {
  return {
    status: "CONTRACT_ONLY_NOT_AUTHORIZED" as const,
    priorityOrder: N2_EXTERNAL_SOURCE_CATALOG.map((source) => source.sourceId),
    productionCaptureAuthorized: false as const,
    productionWriteAuthorized: false as const,
    approvalCreated: false as const,
    productionApplyExecuted: false as const,
    blockers: [
      "BOATRACE_TERMS_REVIEW_REQUIRED",
      "BOUNDED_SOURCE_SPECIFIC_APPROVAL_MISSING",
      "RAW_CAPTURE_EXECUTOR_NOT_IMPLEMENTED",
      "PRODUCTION_WRITER_NOT_AUTHORIZED",
    ] as const,
  };
}
