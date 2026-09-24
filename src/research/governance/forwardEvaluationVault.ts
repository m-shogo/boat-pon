import { createHash } from "node:crypto";

export const FORWARD_EVALUATION_VAULT_SCHEMA_VERSION = "forward-evaluation-vault.0.1" as const;
export type EvidenceStage = "HISTORICAL" | "VALIDATION" | "UNTOUCHED_HOLDOUT" | "SHADOW_FORWARD" | "FUTURE_ONLY";
export type ComparisonMode = "SELECTED_RACE" | "COMMON_COHORT";
export type OddsBasis = "BUY_TIME" | "CLOSING" | "NONE";
export type VaultKind = "ENROLLMENT_PROTOCOL" | "MEMBERSHIP" | "ANALYSIS_SNAPSHOT" | "EVALUATION_PROTOCOL" | "RESULT";
export type VaultAppendDecision = "APPEND" | "IDEMPOTENT_NOOP" | "CONFLICT" | "REJECTED_INVALID";

type Base = { schemaVersion: typeof FORWARD_EVALUATION_VAULT_SCHEMA_VERSION; kind: VaultKind; recordId: string; evidenceStage: EvidenceStage; createdAt: string };
export type EnrollmentProtocol = Base & { kind: "ENROLLMENT_PROTOCOL"; enrollmentProtocolId: string; decisionSystem: string; eligibilityRules: string[]; startAt: string; endAt: string | null; ticketUniverse: string[]; protocolVersion: string };
export type Membership = Base & { kind: "MEMBERSHIP"; cohortId: string; enrollmentProtocolId: string; enrollmentProtocolDigest: string; canonicalRaceId: string; decisionRecordId: string; decisionRecordDigest: string; enrolledAt: string; included: boolean; reason: string };
export type AnalysisSnapshot = Base & { kind: "ANALYSIS_SNAPSHOT"; analysisSnapshotId: string; cohortId: string; cutoffAt: string; membershipDigests: string[] };
export type EvaluationProtocol = Base & { kind: "EVALUATION_PROTOCOL"; evaluationProtocolId: string; comparisonMode: ComparisonMode; oddsBasis: OddsBasis; metricFamilies: string[]; unresolvedPolicy: "EXCLUDE_AND_COUNT"; benchmarkDecisionSystems: string[]; protocolVersion: string };
export type EvaluationResult = Base & { kind: "RESULT"; resultId: string; analysisSnapshotId: string; analysisSnapshotDigest: string; evaluationProtocolId: string; evaluationProtocolDigest: string; decisionSystem: string; comparisonMode: ComparisonMode; oddsBasis: OddsBasis; metricFamily: string; includedCount: number; excludedCount: number; metrics: Record<string, number>; sourceManifestDigest: string; evaluatorVersion: string };
export type ForwardVaultRecord = EnrollmentProtocol | Membership | AnalysisSnapshot | EvaluationProtocol | EvaluationResult;
export type Validation = { valid: boolean; errors: string[] };

const SHA = /^[0-9a-f]{64}$/u;
const STAGES = new Set<EvidenceStage>(["HISTORICAL","VALIDATION","UNTOUCHED_HOLDOUT","SHADOW_FORWARD","FUTURE_ONLY"]);
const BASE = ["schemaVersion","kind","recordId","evidenceStage","createdAt"];
const FIELDS: Record<VaultKind,string[]> = {
  ENROLLMENT_PROTOCOL:[...BASE,"enrollmentProtocolId","decisionSystem","eligibilityRules","startAt","endAt","ticketUniverse","protocolVersion"],
  MEMBERSHIP:[...BASE,"cohortId","enrollmentProtocolId","enrollmentProtocolDigest","canonicalRaceId","decisionRecordId","decisionRecordDigest","enrolledAt","included","reason"],
  ANALYSIS_SNAPSHOT:[...BASE,"analysisSnapshotId","cohortId","cutoffAt","membershipDigests"],
  EVALUATION_PROTOCOL:[...BASE,"evaluationProtocolId","comparisonMode","oddsBasis","metricFamilies","unresolvedPolicy","benchmarkDecisionSystems","protocolVersion"],
  RESULT:[...BASE,"resultId","analysisSnapshotId","analysisSnapshotDigest","evaluationProtocolId","evaluationProtocolDigest","decisionSystem","comparisonMode","oddsBasis","metricFamily","includedCount","excludedCount","metrics","sourceManifestDigest","evaluatorVersion"],
};
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
const instant=(v:unknown)=>str(v)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(v as string)&&Number.isFinite(Date.parse(v as string));
const strings=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.every(str)&&new Set(v).size===v.length;
const digests=(v:unknown)=>Array.isArray(v)&&v.length>0&&v.every(x=>typeof x==="string"&&SHA.test(x))&&new Set(v).size===v.length;
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):obj(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const forwardVaultDigest=(r:ForwardVaultRecord)=>createHash("sha256").update(JSON.stringify(canonical(r))).digest("hex");

export function validateForwardVaultRecord(v:unknown):Validation {
  const e:string[]=[]; if(!obj(v)) return {valid:false,errors:["record must be an object"]};
  if(v.schemaVersion!==FORWARD_EVALUATION_VAULT_SCHEMA_VERSION)e.push("invalid schemaVersion");
  if(!str(v.recordId))e.push("recordId must be non-empty"); if(!STAGES.has(v.evidenceStage as EvidenceStage))e.push("invalid evidenceStage"); if(!instant(v.createdAt))e.push("createdAt must be timezone-bound ISO timestamp");
  if(typeof v.kind!=="string"||!(v.kind in FIELDS)) return {valid:false,errors:[...e,"invalid kind"]};
  for(const k of Object.keys(v))if(!FIELDS[v.kind as VaultKind].includes(k))e.push(`unknown field is not allowed: ${k}`);
  const req=(...ks:string[])=>ks.forEach(k=>{if(!str(v[k]))e.push(`${k} must be non-empty`)}); const dg=(...ks:string[])=>ks.forEach(k=>{if(typeof v[k]!=="string"||!SHA.test(v[k] as string))e.push(`${k} must be SHA-256`)});
  switch(v.kind){
    case "ENROLLMENT_PROTOCOL": req("enrollmentProtocolId","decisionSystem","protocolVersion"); if(!strings(v.eligibilityRules)||!strings(v.ticketUniverse))e.push("protocol rule arrays must be non-empty unique strings"); if(!instant(v.startAt)||(v.endAt!==null&&!instant(v.endAt)))e.push("protocol boundaries must be exact timestamps"); break;
    case "MEMBERSHIP": req("cohortId","enrollmentProtocolId","canonicalRaceId","decisionRecordId","reason"); dg("enrollmentProtocolDigest","decisionRecordDigest"); if(!instant(v.enrolledAt))e.push("enrolledAt must be exact"); if(typeof v.included!=="boolean")e.push("included must be boolean"); break;
    case "ANALYSIS_SNAPSHOT": req("analysisSnapshotId","cohortId"); if(!instant(v.cutoffAt))e.push("cutoffAt must be exact"); if(!digests(v.membershipDigests))e.push("membershipDigests must be unique SHA-256 digests"); break;
    case "EVALUATION_PROTOCOL": req("evaluationProtocolId","protocolVersion"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")e.push("invalid comparisonMode"); if(!["BUY_TIME","CLOSING","NONE"].includes(v.oddsBasis as string))e.push("invalid oddsBasis"); if(!strings(v.metricFamilies)||!strings(v.benchmarkDecisionSystems))e.push("protocol arrays must be non-empty unique strings"); if(v.unresolvedPolicy!=="EXCLUDE_AND_COUNT")e.push("unresolvedPolicy must fail closed"); break;
    case "RESULT": req("resultId","analysisSnapshotId","evaluationProtocolId","decisionSystem","metricFamily","evaluatorVersion"); dg("analysisSnapshotDigest","evaluationProtocolDigest","sourceManifestDigest"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")e.push("invalid comparisonMode"); if(!["BUY_TIME","CLOSING","NONE"].includes(v.oddsBasis as string))e.push("invalid oddsBasis"); for(const k of ["includedCount","excludedCount"])if(!Number.isSafeInteger(v[k])||(v[k] as number)<0)e.push(`${k} must be non-negative safe integer`); if(!obj(v.metrics)||Object.keys(v.metrics).length===0||Object.values(v.metrics).some(x=>typeof x!=="number"||!Number.isFinite(x)))e.push("metrics must contain finite numbers"); break;
  }
  return {valid:e.length===0,errors:e};
}

export function classifyForwardVaultAppend(existing:ForwardVaultRecord|undefined,candidate:unknown):VaultAppendDecision { const v=validateForwardVaultRecord(candidate); if(!v.valid)return "REJECTED_INVALID"; const next=candidate as ForwardVaultRecord; if(!existing)return "APPEND"; if(existing.recordId!==next.recordId)return "CONFLICT"; return forwardVaultDigest(existing)===forwardVaultDigest(next)?"IDEMPOTENT_NOOP":"CONFLICT"; }
export function canPoolStages(stages:EvidenceStage[]):boolean { return new Set(stages).size<=1; }
export function resultMatchesProtocol(result:EvaluationResult,protocol:EvaluationProtocol):boolean { return result.evidenceStage===protocol.evidenceStage&&result.evaluationProtocolId===protocol.evaluationProtocolId&&result.evaluationProtocolDigest===forwardVaultDigest(protocol)&&result.comparisonMode===protocol.comparisonMode&&result.oddsBasis===protocol.oddsBasis; }
