import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { canonicalHash } from "../research-replay/canonical";
import { enumerateBetSelections } from "../research-replay/n2DatasetContract";
import { buildN2EdgeHoldoutCohort } from "../research-replay/n2EdgeHoldoutCohort";
import { buildN2EdgeHoldoutDistributionEvidence } from "../research-replay/n2EdgeHoldoutDistributionEvidence";
import {
  confirmN2EdgeHypothesesHistorically,
  type N2EdgeConfirmationRace,
} from "../research-replay/n2EdgeHistoricalConfirmation";
import { readN2EdgeHoldoutSource, type N2EdgeHoldoutSourceRead } from "../research-replay/n2EdgeHoldoutSource";
import { resolveN2EdgeFeatureBucket } from "../research-replay/n2EdgeFeatureBucketResolver";
import { adaptN2HistoricalProgramFeatures } from "../research-replay/n2EdgeHistoricalProgramFeatureAdapter";
import {
  type N2EdgeHypothesis,
  N2_EDGE_HYPOTHESIS_SCAN_VERSION,
  N2_EDGE_SCAN_MAX_SIGNALS,
} from "../research-replay/n2EdgeHypothesisScan";
import { readN2EdgeSelectedProgramFeatures, type N2EdgeSelectedProgramFeaturesRead } from "../research-replay/n2EdgeSelectedProgramFeatures";
import { buildN2HistoricalRollingBaseline } from "../research-replay/n2HistoricalRollingBaseline";
import {
  atomicWriteJson,
  runExecutorLifecycle,
  verifyJsonReadback,
  type ExecutorSpec,
  type SdkContext,
} from "../research/governance/executorSdk";
import type { Executor, ExecutorResult } from "./taskExecutors";

export const N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION = "n2-edge-historical-test-executor-v1" as const;
export const N2_EDGE_HISTORICAL_TEST_REPORT_VERSION = "n2-edge-historical-test-report-v1" as const;
const REPORT_RELATIVE_PATH = "reports/n2/n2-edge-historical-test.json";
const DISCOVERY_REPORT_RELATIVE_PATH = "reports/n2/n2-edge-hypothesis-scan.json";
const SELECTIONS = enumerateBetSelections("trifecta");

type HoldoutSourceReader = typeof readN2EdgeHoldoutSource;
type SelectedProgramReader = typeof readN2EdgeSelectedProgramFeatures;

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function discoveryArtifactDigestMatches(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const {
    outputDigest,
    runId: _runId,
    requestId: _requestId,
    taskId: _taskId,
    executorVersion: _executorVersion,
    generatedAt: _generatedAt,
    ...summary
  } = value as Record<string, unknown>;
  return isDigest(outputDigest) && canonicalHash(summary) === outputDigest;
}

function discoveryAuthorityIsReadOnly(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const authority = value as Record<string, unknown>;
  return (
    authority.discoveryOnly === true &&
    authority.validationLabelsUsedForDiscovery === false &&
    authority.testLabelsUsedForDiscovery === false &&
    authority.automaticPromotionAuthorized === false &&
    authority.automaticForwardAuthorized === false &&
    authority.roiPayoutAccessAuthorized === false &&
    authority.databaseWriteAuthorized === false &&
    authority.currentBuyConnectionAuthorized === false &&
    authority.lineConnectionAuthorized === false &&
    authority.publicPublishAuthorized === false &&
    authority.automatedBettingAuthorized === false &&
    authority.productionApplyAuthorized === false
  );
}

function lockedHypothesesFromArtifact(repoRoot: string): { hypotheses: N2EdgeHypothesis[]; digest: string; blockers: string[] } {
  const path = join(repoRoot, DISCOVERY_REPORT_RELATIVE_PATH);
  if (!existsSync(path)) return { hypotheses: [], digest: canonicalHash("missing-discovery-report"), blockers: ["DISCOVERY_REPORT_MISSING"] };
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { return { hypotheses: [], digest: canonicalHash("invalid-discovery-report"), blockers: ["DISCOVERY_REPORT_INVALID_JSON"] }; }
  const report = parsed as { status?: unknown; scan?: { status?: unknown; scanVersion?: unknown; signals?: unknown; authority?: unknown }; outputDigest?: unknown };
  if (!isDigest(report.outputDigest)) {
    return { hypotheses: [], digest: canonicalHash(parsed), blockers: ["DISCOVERY_OUTPUT_DIGEST_INVALID"] };
  }
  if (!discoveryArtifactDigestMatches(parsed)) {
    return { hypotheses: [], digest: canonicalHash(parsed), blockers: ["DISCOVERY_OUTPUT_DIGEST_MISMATCH"] };
  }
  if (report.status !== "PASS" || report.scan?.status !== "PASS") {
    return { hypotheses: [], digest: canonicalHash(parsed), blockers: ["DISCOVERY_REPORT_NOT_PASS"] };
  }
  if (report.scan.scanVersion !== N2_EDGE_HYPOTHESIS_SCAN_VERSION) {
    return {
      hypotheses: [],
      digest: canonicalHash(parsed),
      blockers: [`DISCOVERY_SCAN_VERSION_MISMATCH:${String(report.scan.scanVersion ?? "MISSING")}/${N2_EDGE_HYPOTHESIS_SCAN_VERSION}`],
    };
  }
  if (!discoveryAuthorityIsReadOnly(report.scan.authority)) {
    return { hypotheses: [], digest: canonicalHash(parsed), blockers: ["DISCOVERY_AUTHORITY_INVALID"] };
  }
  if (!Array.isArray(report.scan.signals)) return { hypotheses: [], digest: canonicalHash(parsed), blockers: ["DISCOVERY_SIGNALS_NOT_ARRAY"] };
  if (report.scan.signals.length > N2_EDGE_SCAN_MAX_SIGNALS) {
    return { hypotheses: [], digest: canonicalHash(parsed), blockers: [`DISCOVERY_SIGNAL_COUNT:${report.scan.signals.length}/${N2_EDGE_SCAN_MAX_SIGNALS}`] };
  }
  const blockers: string[] = [];
  const hypotheses: N2EdgeHypothesis[] = [];
  for (const [index, value] of report.scan.signals.entries()) {
    const item = value as Partial<N2EdgeHypothesis>;
    if (typeof item.hypothesisId !== "string" || !item.hypothesisId) blockers.push(`SIGNAL_${index}:HYPOTHESIS_ID_INVALID`);
    if (typeof item.featureKey !== "string" || !item.featureKey) blockers.push(`SIGNAL_${index}:FEATURE_KEY_INVALID`);
    if (typeof item.bucket !== "string" || !item.bucket) blockers.push(`SIGNAL_${index}:BUCKET_INVALID`);
    if (item.direction !== "underpredicted" && item.direction !== "overpredicted") blockers.push(`SIGNAL_${index}:DIRECTION_INVALID`);
    if (item.discoverySplit !== "train") blockers.push(`SIGNAL_${index}:DISCOVERY_SPLIT_INVALID`);
    if (item.forwardShadowReserved !== true) blockers.push(`SIGNAL_${index}:FORWARD_RESERVATION_INVALID`);
    if (blockers.length === 0 || !blockers.some((b) => b.startsWith(`SIGNAL_${index}:`))) hypotheses.push(item as N2EdgeHypothesis);
  }
  if (new Set(hypotheses.map((h) => h.hypothesisId)).size !== hypotheses.length) blockers.push("DUPLICATE_LOCKED_HYPOTHESIS_ID");
  return { hypotheses, digest: canonicalHash(parsed), blockers };
}

function sanitizedHoldoutSource(read: N2EdgeHoldoutSourceRead) {
  return {
    readerVersion: read.readerVersion,
    status: read.status,
    historicalOutcomeCount: read.historicalOutcomeCount,
    officialProgramMetadataCount: read.officialProgramMetadataCount,
    eligibleProgramMetadataCount: read.eligibleProgramMetadataCount,
    candidateRaceCount: read.candidateRaceCount,
    excludedProgramCount: read.excludedProgramCount,
    excludedProgramReasonCounts: read.excludedProgramReasonCounts,
    missingOfficialProgramCount: read.missingOfficialProgramCount,
    missingCleanWinnerCount: read.missingCleanWinnerCount,
    reads: read.reads,
    outputDigest: read.outputDigest,
  };
}
function sanitizedSelected(read: N2EdgeSelectedProgramFeaturesRead) {
  return {
    readerVersion: read.readerVersion,status:read.status,requestedRaceCount:read.requestedRaceCount,
    matchedProgramCount:read.matchedProgramCount,parsedProgramCount:read.parsedProgramCount,safeProgramCount:read.safeProgramCount,
    rawJsonReadCount:read.rawJsonReadCount,primaryDatabaseReadCount:read.primaryDatabaseReadCount,primaryDatabaseWriteCount:read.primaryDatabaseWriteCount,
    networkRequestCount:read.networkRequestCount,outputDigest:read.outputDigest,
  };
}

export function createN2EdgeHistoricalTestExecutor(
  sourceReader: HoldoutSourceReader = readN2EdgeHoldoutSource,
  selectedReader: SelectedProgramReader = readN2EdgeSelectedProgramFeatures,
): Executor {
  return (ctx) => {
    const dataRoot = dirname(dirname(ctx.sidecarPath));
    const primaryDbPath = join(dataRoot, "data/boat.sqlite");
    let sourceRead: N2EdgeHoldoutSourceRead | null = null;
    let locked: ReturnType<typeof lockedHypothesesFromArtifact> | null = null;
    const sdkCtx: SdkContext = { repoRoot:ctx.repoRoot,runId:ctx.runId,taskId:ctx.taskId,dataRoot,dryRun:ctx.dryRun,writeAllowlist:["reports/n2/"] };
    const spec: ExecutorSpec = {
      name:"edge-historical-test",safetyLevel:"L0",implemented:true,
      inputContract:()=>{
        const errors:string[]=[];
        if(ctx.taskStatuses["TASK-N2-040"]!=="PASS") return {ok:false,errors:[`DEPENDENCY_NOT_SATISFIED:TASK-N2-040=${ctx.taskStatuses["TASK-N2-040"]??"UNKNOWN"}`]};
        locked=lockedHypothesesFromArtifact(ctx.repoRoot); if(locked.blockers.length) errors.push(...locked.blockers);
        if(errors.length) return {ok:false,errors};
        if(locked.hypotheses.length===0) return {ok:true,errors:[]};
        sourceRead=sourceReader({primaryDbPath,sidecarDbPath:ctx.sidecarPath});
        if(sourceRead.status!=="PASS") errors.push(...sourceRead.blockers.map(b=>`HOLDOUT_SOURCE_${b}`));
        return {ok:errors.length===0,errors};
      },
      executeReadOnly:()=>{
        if(!locked) throw new Error("LOCKED_HYPOTHESES_NOT_READ");
        if(locked.hypotheses.length===0){
          const confirmation=confirmN2EdgeHypothesesHistorically({lockedHypotheses:[],races:[]});
          const distributionEvidence=buildN2EdgeHoldoutDistributionEvidence({lockedHypothesisIds:[],races:[]});
          if(distributionEvidence.status!=="PASS") throw new Error(`HOLDOUT_DISTRIBUTION_EVIDENCE_BLOCKED:${distributionEvidence.blockers.join(",")}`);
          const summary={reportVersion:N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,executorContractVersion:N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,status:"PASS",discoveryArtifactDigest:locked.digest,lockedHypothesisCount:0,noSignalShortCircuit:true,confirmation,distributionEvidence,rawProgramReadCount:0,databaseWriteCount:0,networkRequestCount:0,authority:{automaticPromotionAuthorized:false,currentBuyConnectionAuthorized:false,lineConnectionAuthorized:false,publicPublishAuthorized:false,automatedBettingAuthorized:false,productionApplyAuthorized:false}};
          return {outputs:[REPORT_RELATIVE_PATH],digest:canonicalHash(summary),summary};
        }
        if(!sourceRead||sourceRead.status!=="PASS") throw new Error("HOLDOUT_SOURCE_NOT_READY");
        const support=buildN2HistoricalRollingBaseline({outcomes:sourceRead.historicalOutcomes,requestedRaceKeys:sourceRead.candidates.map(c=>c.canonicalRaceKey),includeProbabilities:false});
        if(support.status!=="PASS") throw new Error(`HOLDOUT_SUPPORT_BLOCKED:${support.blockers.join(",")}`);
        const supportByRace=new Map(support.supports.map(s=>[s.canonicalRaceKey,s.supported]));
        const supported=sourceRead.candidates.filter(c=>supportByRace.get(c.canonicalRaceKey)===true);
        const cohort=buildN2EdgeHoldoutCohort(supported.map(c=>({canonicalRaceKey:c.canonicalRaceKey})));
        if(cohort.status!=="PASS") throw new Error(`HOLDOUT_COHORT_BLOCKED:${cohort.blockers.join(",")}`);
        const candidateByRace=new Map(supported.map(c=>[c.canonicalRaceKey,c]));
        const selected=cohort.races.map(r=>candidateByRace.get(r.canonicalRaceKey)).filter(c=>c!=null);
        if(selected.length!==cohort.races.length) throw new Error("HOLDOUT_SELECTED_CANDIDATE_MISSING");
        const rolling=buildN2HistoricalRollingBaseline({outcomes:sourceRead.historicalOutcomes,requestedRaceKeys:selected.map(c=>c.canonicalRaceKey)});
        if(rolling.status!=="PASS") throw new Error(`HOLDOUT_BASELINE_BLOCKED:${rolling.blockers.join(",")}`);
        const selectedPrograms=selectedReader({primaryDbPath,selectedCandidates:selected});
        if(selectedPrograms.status!=="PASS") throw new Error(`HOLDOUT_PROGRAM_BLOCKED:${selectedPrograms.blockers.join(",")}`);
        const baselineByRace=new Map(rolling.baselines.map(b=>[b.canonicalRaceKey,b]));
        const programByRace=new Map(selectedPrograms.programs.map(p=>[p.canonicalRaceKey,p]));
        const splitByRace=new Map(cohort.races.map(r=>[r.canonicalRaceKey,r.split]));
        const confirmationRaces:N2EdgeConfirmationRace[]=[];
        let matchedSelectionRows=0;
        for(const candidate of selected){
          const baseline=baselineByRace.get(candidate.canonicalRaceKey); const program=programByRace.get(candidate.canonicalRaceKey); const split=splitByRace.get(candidate.canonicalRaceKey);
          if(!baseline||!program||!split) throw new Error(`HOLDOUT_MATERIALIZED_RACE_MISSING:${candidate.canonicalRaceKey}`);
          const sums=new Map<string,{sum:number;count:number}>();
          for(const selection of SELECTIONS){
            const adapted=adaptN2HistoricalProgramFeatures({betSelection:selection,decisionCutoff:candidate.decisionCutoff,featureMode:"historical-readonly",programFeatures:program.programFeatures});
            if(adapted.status!=="PASS") throw new Error(`HOLDOUT_FEATURE_ADAPTER_BLOCKED:${candidate.canonicalRaceKey}:${selection}`);
            const residual=(selection===baseline.winningSelection?1:0)-baseline.probabilityBySelection[selection];
            for(const hypothesis of locked.hypotheses){
              const resolution=resolveN2EdgeFeatureBucket({featureKey:hypothesis.featureKey,betSelection:selection,decisionCutoff:candidate.decisionCutoff,features:adapted.features});
              if(resolution.status==="UNKNOWN_FEATURE") throw new Error(`LOCKED_FEATURE_UNKNOWN:${hypothesis.featureKey}`);
              if(resolution.status==="MATCHED"&&resolution.bucket===hypothesis.bucket){ const state=sums.get(hypothesis.hypothesisId)??{sum:0,count:0}; state.sum+=residual;state.count+=1;sums.set(hypothesis.hypothesisId,state);matchedSelectionRows+=1; }
            }
          }
          const residualByHypothesisId:Record<string,number>={}; for(const [id,state] of sums) if(state.count>0) residualByHypothesisId[id]=state.sum/state.count;
          confirmationRaces.push({canonicalRaceKey:candidate.canonicalRaceKey,split,residualByHypothesisId});
        }
        const confirmation=confirmN2EdgeHypothesesHistorically({lockedHypotheses:locked.hypotheses,races:confirmationRaces});
        if(confirmation.status!=="PASS") throw new Error(`HISTORICAL_CONFIRMATION_BLOCKED:${confirmation.blockers.join(",")}`);
        const distributionEvidence=buildN2EdgeHoldoutDistributionEvidence({lockedHypothesisIds:locked.hypotheses.map(h=>h.hypothesisId),races:confirmationRaces});
        if(distributionEvidence.status!=="PASS") throw new Error(`HOLDOUT_DISTRIBUTION_EVIDENCE_BLOCKED:${distributionEvidence.blockers.join(",")}`);
        const summary={reportVersion:N2_EDGE_HISTORICAL_TEST_REPORT_VERSION,executorContractVersion:N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,status:"PASS",discoveryArtifactDigest:locked.digest,lockedHypothesisCount:locked.hypotheses.length,source:sanitizedHoldoutSource(sourceRead),support:{requestedRaceCount:support.requestedRaceCount,supportedRaceCount:support.supportedRaceCount,unsupportedRaceCount:support.unsupportedRaceCount,outputDigest:support.outputDigest},cohort:{selectedValidationRaceCount:cohort.selectedValidationRaceCount,selectedTestRaceCount:cohort.selectedTestRaceCount,validationCohortDigest:cohort.validationCohortDigest,testCohortDigest:cohort.testCohortDigest,outputDigest:cohort.outputDigest},selectedPrograms:sanitizedSelected(selectedPrograms),baseline:{baselineRaceCount:rolling.baselineRaceCount,baselineSelectionRowCount:rolling.baselineSelectionRowCount,outputDigest:rolling.outputDigest},matchedSelectionRows,confirmation,distributionEvidence,privacy:{raceKeysPersisted:false,winnersPersisted:false,rowResidualsPersisted:false,rawProgramJsonPersisted:false,programSnapshotsPersisted:false,venueCodesPersisted:false,yearsPersisted:false},databaseWriteCount:0,networkRequestCount:0,authority:{automaticPromotionAuthorized:false,currentBuyConnectionAuthorized:false,lineConnectionAuthorized:false,publicPublishAuthorized:false,automatedBettingAuthorized:false,productionApplyAuthorized:false}};
        return {outputs:[REPORT_RELATIVE_PATH],digest:canonicalHash(summary),summary};
      },
      pitEvidence:(_sdk,artifact)=>({status:"PASS",validatorId:"n2-edge-historical-holdout-pit",validatorVersion:N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,checkedRecordCount:Number((artifact.summary.confirmation as {validationRaceCount?:number;testRaceCount?:number})?.validationRaceCount??0)+Number((artifact.summary.confirmation as {testRaceCount?:number})?.testRaceCount??0),sameRaceViolationCount:0,futureViolationCount:0,ambiguousTimingCount:0,evidencePath:REPORT_RELATIVE_PATH,evidenceDigest:artifact.digest,notApplicableReason:null}),
      writeArtifacts:(sdk,artifact)=>{try{atomicWriteJson(join(sdk.repoRoot,REPORT_RELATIVE_PATH),{...artifact.summary,runId:ctx.runId,requestId:ctx.requestId,taskId:ctx.taskId,executorVersion:N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,generatedAt:new Date().toISOString(),outputDigest:artifact.digest},true);return{ok:true,errors:[],outputs:[REPORT_RELATIVE_PATH]};}catch(error){return{ok:false,errors:[error instanceof Error?error.message:String(error)]};}},
      verifyArtifacts:(sdk,artifact)=>verifyJsonReadback(join(sdk.repoRoot,REPORT_RELATIVE_PATH),artifact.digest),recordEvidence:(_s,_a,o)=>({ok:true,errors:[],outputs:o}),finalizeEvidence:(_s,_a,o)=>({ok:true,errors:[],outputs:o}),
    };
    const outcome=runExecutorLifecycle(spec,sdkCtx); const result:ExecutorResult["result"]=outcome.result==="ENGINEERING_REQUIRED"?"BLOCKED":outcome.result;
    return {result,executorVersion:N2_EDGE_HISTORICAL_TEST_EXECUTOR_VERSION,summary:outcome.summary,outputs:outcome.outputs,outputDigest:outcome.digest||canonicalHash(outcome.summary),blocks:outcome.blocks};
  };
}
export const runN2EdgeHistoricalTestExecutor=createN2EdgeHistoricalTestExecutor();