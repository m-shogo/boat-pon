import { relative, resolve } from "node:path";

import {
  contractDigest,
  validateDiscovery,
  validateExperiment,
  type Discovery,
  type Experiment,
} from "../research/governance/contracts";
import {
  appendRecordIdempotent,
  listRecords,
} from "../research/governance/registryStore";
import type { N2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";

export const N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT =
  "N2_EDGE_KNOWLEDGE_REVIEWED_APPEND_V1" as const;

export type N2EdgeKnowledgeRegistryPersistenceResult = {
  status: "PASS" | "BLOCKED";
  blockers: string[];
  experiment: {
    recordId: string | null;
    alreadyRecorded: boolean;
    appended: boolean;
    outputPath: string | null;
  };
  discovery: {
    recordId: string | null;
    alreadyRecorded: boolean;
    appended: boolean;
    outputPath: string | null;
  };
  experimentWrittenBeforeDiscovery: true;
  retryIsIdempotent: true;
  partialExperimentWithoutDiscoveryIsSafeToRetry: true;
  discoveryAdoptedByCount: 0;
  currentBuyTransferAuthorized: false;
  lineTransferAuthorized: false;
  publicPublishAuthorized: false;
  automatedBettingAuthorized: false;
  productionApplyAuthorized: false;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stripMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const { _digest, _recordedAt, ...body } = record;
  return body;
}

function registryRootPreflightBlocker(repoRoot: string, registryRoot: string): string | null {
  const expectedRegistryRoot = resolve(repoRoot, "research/registries");
  const actualRegistryRoot = resolve(registryRoot);
  if (actualRegistryRoot !== expectedRegistryRoot) {
    return "KNOWLEDGE_REGISTRY_ROOT_OUTSIDE_ALLOWLIST";
  }
  return null;
}

function relativeRegistryPath(repoRoot: string, absolutePath: string, kind: "experiments" | "discoveries"): string {
  const output = relative(repoRoot, absolutePath).replaceAll("\\", "/");
  const prefix = `research/registries/${kind}/`;
  if (!output.startsWith(prefix) || output.includes("..")) {
    throw new Error(`KNOWLEDGE_REGISTRY_OUTPUT_OUTSIDE_ALLOWLIST:${output}`);
  }
  return output;
}

function preflightRecord(input: {
  registryRoot: string;
  kind: "experiments" | "discoveries";
  idField: "experimentId" | "discoveryId";
  recordId: string;
  body: Record<string, unknown>;
}): { ok: boolean; blocker: string | null; alreadyRecorded: boolean } {
  let existing: Record<string, unknown>[];
  try {
    existing = listRecords<Record<string, unknown>>(input.registryRoot, input.kind);
  } catch (error) {
    return {
      ok: false,
      blocker: `${input.kind.toUpperCase()}_REGISTRY_READ_FAILED:${error instanceof Error ? error.message.slice(0, 180) : "UNKNOWN"}`,
      alreadyRecorded: false,
    };
  }
  const matching = existing.filter((record) => record[input.idField] === input.recordId);
  if (matching.length > 1) {
    return {
      ok: false,
      blocker: `${input.kind.toUpperCase()}_REGISTRY_DUPLICATE_ID:${input.recordId}`,
      alreadyRecorded: false,
    };
  }
  if (matching.length === 0) return { ok: true, blocker: null, alreadyRecorded: false };
  const stored = matching[0];
  const body = stripMetadata(stored);
  const expectedDigest = contractDigest(input.body);
  const storedDigest = typeof stored._digest === "string" ? stored._digest : contractDigest(body);
  if (storedDigest !== expectedDigest || contractDigest(body) !== expectedDigest) {
    return {
      ok: false,
      blocker: `${input.kind.toUpperCase()}_REGISTRY_CONFLICT:${input.recordId}`,
      alreadyRecorded: false,
    };
  }
  return { ok: true, blocker: null, alreadyRecorded: true };
}

function blocked(blockers: string[]): N2EdgeKnowledgeRegistryPersistenceResult {
  return {
    status: "BLOCKED",
    blockers: unique(blockers),
    experiment: { recordId: null, alreadyRecorded: false, appended: false, outputPath: null },
    discovery: { recordId: null, alreadyRecorded: false, appended: false, outputPath: null },
    experimentWrittenBeforeDiscovery: true,
    retryIsIdempotent: true,
    partialExperimentWithoutDiscoveryIsSafeToRetry: true,
    discoveryAdoptedByCount: 0,
    currentBuyTransferAuthorized: false,
    lineTransferAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
  };
}

/**
 * Persist an already-reviewed N2 lineage plan into the existing append-only
 * governance registries. The explicit write intent prevents accidental use by
 * read-only planners. This function cannot adopt a discovery or transfer it to
 * Current BUY/LINE/public/production paths.
 *
 * Experiment is appended first because Discovery validation requires an
 * experiment lineage. If the second append suffers an I/O failure, retry is
 * safe: the first append is exact-idempotent and the discovery remains absent,
 * which grants no execution authority.
 */
export function persistN2EdgeKnowledgeLineage(input: {
  repoRoot: string;
  registryRoot: string;
  plan: N2EdgeKnowledgeLineagePlan;
  writeIntent: typeof N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT;
}): N2EdgeKnowledgeRegistryPersistenceResult {
  const registryRootBlocker = registryRootPreflightBlocker(input.repoRoot, input.registryRoot);
  if (registryRootBlocker) return blocked([registryRootBlocker]);

  const blockers: string[] = [];
  if (input.writeIntent !== N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT) blockers.push("WRITE_INTENT_INVALID");
  if (input.plan.status !== "PASS") blockers.push("LINEAGE_PLAN_NOT_PASS");
  if (input.plan.registryPlan.registryWriteAuthorized !== false) blockers.push("LINEAGE_PLAN_WRITE_AUTHORITY_INVALID");
  if (input.plan.authority.automaticPromotionAuthorized !== false
    || input.plan.authority.currentBuyConnectionAuthorized !== false
    || input.plan.authority.lineConnectionAuthorized !== false
    || input.plan.authority.publicPublishAuthorized !== false
    || input.plan.authority.automatedBettingAuthorized !== false
    || input.plan.authority.productionApplyAuthorized !== false) {
    blockers.push("LINEAGE_PLAN_EXECUTION_AUTHORITY_INVALID");
  }
  const experiment = input.plan.experiment;
  if (!experiment || !input.plan.registryPlan.experimentAppendEligible) blockers.push("EXPERIMENT_NOT_APPEND_ELIGIBLE");
  if (experiment) {
    const validation = validateExperiment(experiment);
    if (!validation.valid) blockers.push(...validation.errors.map((error) => `EXPERIMENT:${error}`));
  }
  const discovery = input.plan.discoveryCandidate;
  if (discovery !== null) {
    if (!input.plan.registryPlan.discoveryAppendEligible) blockers.push("DISCOVERY_NOT_APPEND_ELIGIBLE");
    const validation = validateDiscovery(discovery);
    if (!validation.valid) blockers.push(...validation.errors.map((error) => `DISCOVERY:${error}`));
    if (discovery.adoptedBy.length !== 0) blockers.push("DISCOVERY_ALREADY_ADOPTED");
    if (!experiment || !discovery.sourceExperimentIds.includes(experiment.experimentId)) {
      blockers.push("DISCOVERY_EXPERIMENT_LINEAGE_MISMATCH");
    }
    if (experiment?.status !== "completed") blockers.push("DISCOVERY_REQUIRES_COMPLETED_EXPERIMENT");
  } else if (input.plan.registryPlan.discoveryAppendEligible) {
    blockers.push("DISCOVERY_APPEND_ELIGIBLE_WITHOUT_RECORD");
  }
  if (blockers.length > 0 || !experiment) return blocked(blockers);

  const experimentPreflight = preflightRecord({
    registryRoot: input.registryRoot,
    kind: "experiments",
    idField: "experimentId",
    recordId: experiment.experimentId,
    body: experiment as unknown as Record<string, unknown>,
  });
  if (!experimentPreflight.ok) blockers.push(experimentPreflight.blocker!);
  const discoveryPreflight = discovery === null ? null : preflightRecord({
    registryRoot: input.registryRoot,
    kind: "discoveries",
    idField: "discoveryId",
    recordId: discovery.discoveryId,
    body: discovery as unknown as Record<string, unknown>,
  });
  if (discoveryPreflight && !discoveryPreflight.ok) blockers.push(discoveryPreflight.blocker!);
  if (blockers.length > 0) return blocked(blockers);

  const experimentAppend = appendRecordIdempotent(
    input.registryRoot,
    "experiments",
    experiment as unknown as Record<string, unknown>,
  );
  if (!experimentAppend.ok) return blocked([`EXPERIMENT_${experimentAppend.code}:${experimentAppend.errors.join(";")}`]);
  let experimentOutputPath: string | null = null;
  try {
    if (experimentAppend.path) experimentOutputPath = relativeRegistryPath(input.repoRoot, experimentAppend.path, "experiments");
  } catch (error) {
    return blocked([error instanceof Error ? error.message : "EXPERIMENT_OUTPUT_PATH_INVALID"]);
  }

  if (discovery === null) {
    return {
      status: "PASS",
      blockers: [],
      experiment: {
        recordId: experiment.experimentId,
        alreadyRecorded: experimentPreflight.alreadyRecorded,
        appended: !experimentPreflight.alreadyRecorded,
        outputPath: experimentOutputPath,
      },
      discovery: { recordId: null, alreadyRecorded: false, appended: false, outputPath: null },
      experimentWrittenBeforeDiscovery: true,
      retryIsIdempotent: true,
      partialExperimentWithoutDiscoveryIsSafeToRetry: true,
      discoveryAdoptedByCount: 0,
      currentBuyTransferAuthorized: false,
      lineTransferAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    };
  }

  const discoveryAppend = appendRecordIdempotent(
    input.registryRoot,
    "discoveries",
    discovery as unknown as Record<string, unknown>,
  );
  if (!discoveryAppend.ok) {
    return {
      ...blocked([`DISCOVERY_${discoveryAppend.code}:${discoveryAppend.errors.join(";")}`]),
      experiment: {
        recordId: experiment.experimentId,
        alreadyRecorded: experimentPreflight.alreadyRecorded,
        appended: !experimentPreflight.alreadyRecorded,
        outputPath: experimentOutputPath,
      },
    };
  }
  let discoveryOutputPath: string | null = null;
  try {
    if (discoveryAppend.path) discoveryOutputPath = relativeRegistryPath(input.repoRoot, discoveryAppend.path, "discoveries");
  } catch (error) {
    return {
      ...blocked([error instanceof Error ? error.message : "DISCOVERY_OUTPUT_PATH_INVALID"]),
      experiment: {
        recordId: experiment.experimentId,
        alreadyRecorded: experimentPreflight.alreadyRecorded,
        appended: !experimentPreflight.alreadyRecorded,
        outputPath: experimentOutputPath,
      },
    };
  }
  return {
    status: "PASS",
    blockers: [],
    experiment: {
      recordId: experiment.experimentId,
      alreadyRecorded: experimentPreflight.alreadyRecorded,
      appended: !experimentPreflight.alreadyRecorded,
      outputPath: experimentOutputPath,
    },
    discovery: {
      recordId: discovery.discoveryId,
      alreadyRecorded: discoveryPreflight?.alreadyRecorded ?? false,
      appended: !(discoveryPreflight?.alreadyRecorded ?? false),
      outputPath: discoveryOutputPath,
    },
    experimentWrittenBeforeDiscovery: true,
    retryIsIdempotent: true,
    partialExperimentWithoutDiscoveryIsSafeToRetry: true,
    discoveryAdoptedByCount: 0,
    currentBuyTransferAuthorized: false,
    lineTransferAuthorized: false,
    publicPublishAuthorized: false,
    automatedBettingAuthorized: false,
    productionApplyAuthorized: false,
  };
}
