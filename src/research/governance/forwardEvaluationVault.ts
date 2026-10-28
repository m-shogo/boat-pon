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
// Runtime consumers must not rewrite an already-issued validation verdict or
// its diagnostic list. Compile-time types alone do not enforce this boundary.
const frozenValidation=(valid:boolean,errors:string[]):Validation=>Object.freeze({
  valid, errors:Object.freeze(errors),
}) as Validation;

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
// Reject exotic prototypes and toJSON hooks: JSON.stringify must agree with canonical hashing.
const obj=(v:unknown):v is Record<string,unknown>=>{
  if(v===null||typeof v!=="object"||Array.isArray(v))return false;
  try {
    const proto=Object.getPrototypeOf(v);
    return (proto===Object.prototype||proto===null)&&!("toJSON" in v);
  } catch { return false; }
};
// Only own, enumerable data descriptors can participate in JSON persistence.
// Inspect descriptors rather than reading values, so accessors never execute.
const ownDataShape=(v:Record<string,unknown>,required?:readonly string[]):boolean=>{
  try {
    const keys=Reflect.ownKeys(v);
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      if(typeof key!=="string")return false;
      const d=Object.getOwnPropertyDescriptor(v,key);
      if(!d||!d.enumerable||!("value" in d))return false;
    }
    if(required){
      if(keys.length!==required.length)return false;
      for(let i=0;i<required.length;i++){
        if(!Object.prototype.hasOwnProperty.call(v,required[i]))return false;
      }
    }
    return true;
  } catch { return false; }
};
const str=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
// Validate literal Gregorian dates and RFC3339 clock bounds before Date.parse,
// which otherwise normalizes impossible days and 24:00 to another instant.
const instant=(v:unknown)=>{
  if(typeof v!=="string")return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(v);
  if(!m||v.endsWith("-00:00"))return false;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  const hour=Number(m[4]),minute=Number(m[5]),second=Number(m[6]);
  if(year===0||hour>23||minute>59||second>59)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1])return false;
  return Number.isFinite(Date.parse(v));
};
// Compare validated RFC3339 instants without losing sub-millisecond ordering.
const compareInstants=(a:string,b:string):number=>{
  const fraction=/\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/u;
  const seconds=(s:string)=>Date.parse(s.replace(fraction,""));
  const sa=seconds(a),sb=seconds(b);
  if(sa!==sb)return sa<sb?-1:1;
  const fa=fraction.exec(a)?.[1]??"",fb=fraction.exec(b)?.[1]??"";
  const width=Math.max(fa.length,fb.length);
  const pa=fa.padEnd(width,"0"),pb=fb.padEnd(width,"0");
  return pa<pb?-1:pa>pb?1:0;
};
// Array.every skips holes, while JSON.stringify persists them as null.
// Inspect own indexed data descriptors to keep validation and hashing aligned.
const denseUniqueArray=(v:unknown,accept:(x:unknown)=>boolean):boolean=>{
  if(!Array.isArray(v)||v.length===0)return false;
  try {
    // Array.prototype.toJSON can replace persisted array contents after validation.
    // Reject inherited/own hooks rather than hashing evidence that serializes differently.
    if(Object.getPrototypeOf(v)!==Array.prototype||"toJSON" in v||Reflect.ownKeys(v).length!==v.length+1)return false;
    const seen=new Set<unknown>();
    for(let i=0;i<v.length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
      if(!descriptor||!descriptor.enumerable||!("value" in descriptor)||!accept(descriptor.value)||seen.has(descriptor.value))return false;
      seen.add(descriptor.value);
    }
    return true;
  } catch { return false; }
};
const strings=(v:unknown)=>denseUniqueArray(v,str);
const digests=(v:unknown)=>denseUniqueArray(v,x=>typeof x==="string"&&SHA.test(x));
// Inspect finite metric values through own data descriptors. Delegating to
// Array.prototype.some can admit NaN/Infinity when ambient methods are replaced,
// while JSON.stringify would silently persist those values as null.
const finiteMetricMap=(v:unknown):boolean=>{
  if(!obj(v)||!ownDataShape(v))return false;
  const keys=Object.keys(v);
  if(keys.length===0)return false;
  for(let i=0;i<keys.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(v,keys[i]);
    if(!descriptor||!("value" in descriptor)||typeof descriptor.value!=="number"||!Number.isFinite(descriptor.value))return false;
  }
  return true;
};
// Match an already-validated frozen protocol array without trusting a mutable
// Array.prototype.includes implementation (ambient prototype pollution).
const exactOwnArrayEntry=(values:readonly string[],expected:string):boolean=>{
  try {
    for(let i=0;i<values.length;i++){
      const d=Object.getOwnPropertyDescriptor(values,String(i));
      if(d&&d.enumerable&&"value" in d&&d.value===expected)return true;
    }
  } catch { return false; }
  return false;
};
const canonical=(v:unknown):unknown=>{
  if(Array.isArray(v)){
    if(Object.getPrototypeOf(v)!==Array.prototype||Reflect.ownKeys(v).length!==v.length+1)throw new TypeError("non-JSON array in Forward Evaluation Vault");
    // Do not delegate canonical array traversal to mutable Array.from.
    // A replaced Array.from can erase elements and alias distinct digests.
    const output:unknown[]=[];
    for(let i=0;i<v.length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
      if(!descriptor||!descriptor.enumerable||!("value" in descriptor))throw new TypeError("non-JSON array in Forward Evaluation Vault");
      // A caller-independent inherited Array.prototype numeric setter must not
      // erase a validated metric/protocol entry from the canonical digest.
      Object.defineProperty(output, String(i), {
        value: canonical(descriptor.value),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return output;
  }
  if(v!==null&&typeof v==="object"){
    if(!obj(v)||!ownDataShape(v))throw new TypeError("non-JSON object in Forward Evaluation Vault");
    // A mutable Array.prototype.map can collapse every valid record into {},
    // making different append-only payloads share the same digest.
    // Sort keys by UTF-16 lexical order without mutable Array.prototype.sort.
    // This preserves the canonical digest across object insertion orders.
    const keys=Object.keys(v);
    for(let i=1;i<keys.length;i++){
      const key=keys[i];
      let j=i-1;
      while(j>=0&&keys[j]>key){keys[j+1]=keys[j];j--;}
      keys[j+1]=key;
    }
    const output:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      const descriptor=Object.getOwnPropertyDescriptor(v,key);
      if(!descriptor||!("value" in descriptor))throw new TypeError("non-JSON object in Forward Evaluation Vault");
      output[key]=canonical(descriptor.value);
    }
    return output;
  }
  return v;
};
export const forwardVaultDigest=(r:ForwardVaultRecord)=>{
  // The exported digest must enforce the same admission contract as append.
  // Invalid NaN and null values otherwise alias under JSON.stringify.
  if(!validateForwardVaultRecord(r).valid)throw new TypeError("invalid Forward Evaluation Vault record");
  return createHash("sha256").update(JSON.stringify(canonical(r))).digest("hex");
};

export function validateForwardVaultRecord(v:unknown):Validation {
  const e:string[]=[]; if(!obj(v)) return frozenValidation(false,["record must be an object"]);
  // A fresh error array has no own index yet: inherited numeric setters can
  // silently discard a denial and make an invalid research record appear valid.
  const appendError=(message:string):void=>{
    Object.defineProperty(e,String(e.length),{
      value:message,enumerable:true,writable:true,configurable:true,
    });
  };
  if(!ownDataShape(v))return frozenValidation(false,["record fields must be enumerable own data properties"]);
  if(v.schemaVersion!==FORWARD_EVALUATION_VAULT_SCHEMA_VERSION)appendError("invalid schemaVersion");
  if(!str(v.recordId))appendError("recordId must be non-empty"); if(!STAGES.has(v.evidenceStage as EvidenceStage))appendError("invalid evidenceStage"); if(!instant(v.createdAt))appendError("createdAt must be timezone-bound ISO timestamp");
  if(typeof v.kind!=="string"||!Object.prototype.hasOwnProperty.call(FIELDS,v.kind)) return frozenValidation(false,[...e,"invalid kind"]);
  if(!ownDataShape(v,FIELDS[v.kind as VaultKind]))appendError("record fields must exactly match kind");
  for(const k of Object.keys(v))if(!FIELDS[v.kind as VaultKind].includes(k))appendError(`unknown field is not allowed: ${k}`);
  const req=(...ks:string[])=>{
    for(let i=0;i<ks.length;i++){
      const k=ks[i];
      if(!str(v[k]))appendError(`${k} must be non-empty`);
    }
  };
  const dg=(...ks:string[])=>{
    for(let i=0;i<ks.length;i++){
      const k=ks[i];
      if(typeof v[k]!=="string"||!SHA.test(v[k] as string))appendError(`${k} must be SHA-256`);
    }
  };
  switch(v.kind){
    case "ENROLLMENT_PROTOCOL": req("enrollmentProtocolId","decisionSystem","protocolVersion"); if(!strings(v.eligibilityRules)||!strings(v.ticketUniverse))appendError("protocol rule arrays must be non-empty unique strings"); if(!instant(v.startAt)||(v.endAt!==null&&!instant(v.endAt)))appendError("protocol boundaries must be exact timestamps"); if(instant(v.startAt)&&v.endAt!==null&&instant(v.endAt)&&compareInstants(v.endAt as string,v.startAt as string)<0)appendError("protocol endAt precedes startAt"); break;
    case "MEMBERSHIP": req("cohortId","enrollmentProtocolId","canonicalRaceId","decisionRecordId","reason"); dg("enrollmentProtocolDigest","decisionRecordDigest"); if(!instant(v.enrolledAt))appendError("enrolledAt must be exact"); if(typeof v.included!=="boolean")appendError("included must be boolean"); break;
    case "ANALYSIS_SNAPSHOT": req("analysisSnapshotId","cohortId"); if(!instant(v.cutoffAt))appendError("cutoffAt must be exact"); if(!digests(v.membershipDigests))appendError("membershipDigests must be unique SHA-256 digests"); break;
    case "EVALUATION_PROTOCOL": req("evaluationProtocolId","protocolVersion"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")appendError("invalid comparisonMode"); if(v.oddsBasis!=="BUY_TIME"&&v.oddsBasis!=="CLOSING"&&v.oddsBasis!=="NONE")appendError("invalid oddsBasis"); if(!strings(v.metricFamilies)||!strings(v.benchmarkDecisionSystems))appendError("protocol arrays must be non-empty unique strings"); if(v.unresolvedPolicy!=="EXCLUDE_AND_COUNT")appendError("unresolvedPolicy must fail closed"); break;
    case "RESULT": req("resultId","analysisSnapshotId","evaluationProtocolId","decisionSystem","metricFamily","evaluatorVersion"); dg("analysisSnapshotDigest","evaluationProtocolDigest","sourceManifestDigest"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")appendError("invalid comparisonMode"); if(v.oddsBasis!=="BUY_TIME"&&v.oddsBasis!=="CLOSING"&&v.oddsBasis!=="NONE")appendError("invalid oddsBasis"); for(const k of ["includedCount","excludedCount"])if(!Number.isSafeInteger(v[k])||(v[k] as number)<0)appendError(`${k} must be non-negative safe integer`); if(!finiteMetricMap(v.metrics))appendError("metrics must contain finite numbers"); break;
  }
  return frozenValidation(e.length===0,e);
}

export function classifyForwardVaultAppend(existing:ForwardVaultRecord|undefined,candidate:unknown):VaultAppendDecision { const v=validateForwardVaultRecord(candidate); if(!v.valid)return "REJECTED_INVALID"; const next=candidate as ForwardVaultRecord; if(!existing)return "APPEND"; if(!validateForwardVaultRecord(existing).valid)return "REJECTED_INVALID"; if(existing.recordId!==next.recordId)return "CONFLICT"; try { return forwardVaultDigest(existing)===forwardVaultDigest(next)?"IDEMPOTENT_NOOP":"CONFLICT"; } catch { return "REJECTED_INVALID"; } }
// Stage pooling is a runtime admission boundary, not only a TypeScript hint.
// Read only own data descriptors: never invoke untrusted array accessors.
export function canPoolStages(stages:EvidenceStage[]):boolean {
  try {
    if(!Array.isArray(stages)||Object.getPrototypeOf(stages)!==Array.prototype)return false;
    if(Reflect.ownKeys(stages).length!==stages.length+1)return false;
    let first:EvidenceStage|undefined;
    for(let i=0;i<stages.length;i++){
      const descriptor=Object.getOwnPropertyDescriptor(stages,String(i));
      if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||!STAGES.has(descriptor.value))return false;
      if(i>0&&descriptor.value!==first)return false;
      if(i===0)first=descriptor.value;
    }
    return true;
  } catch { return false; }
}
export function resultMatchesProtocol(result:EvaluationResult,protocol:EvaluationProtocol):boolean {
  try {
    // Runtime inputs must be valid records of the intended kinds; a matching
    // digest alone does not make a retrospectively authored protocol prospective.
    if(!validateForwardVaultRecord(result).valid||!validateForwardVaultRecord(protocol).valid)return false;
    if(result.kind!=="RESULT"||protocol.kind!=="EVALUATION_PROTOCOL")return false;
    if(compareInstants(protocol.createdAt,result.createdAt)>=0)return false;
    return result.evidenceStage===protocol.evidenceStage&&result.evaluationProtocolId===protocol.evaluationProtocolId&&result.evaluationProtocolDigest===forwardVaultDigest(protocol)&&result.comparisonMode===protocol.comparisonMode&&result.oddsBasis===protocol.oddsBasis&&exactOwnArrayEntry(protocol.metricFamilies,result.metricFamily);
  } catch {
    // Fail closed even if a getter or ambient JSON serializer throws.
    return false;
  }
}
