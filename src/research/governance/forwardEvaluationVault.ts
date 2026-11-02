import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { compareForwardV02ClaimedInstants, validForwardV02ClaimedInstant } from "./forwardV02ClaimedInstant.js";

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
// A caller-replaced Object.freeze must not make issued validation verdicts mutable.
const BUILTIN_OBJECT_FREEZE = Object.freeze;
// Node-only research ingress: reject caller-owned live/revoked Proxies before
// get, descriptor, ownKeys, prototype or array-length traps can disagree.
const BUILTIN_NODE_IS_PROXY = nodeTypes.isProxy;
// Pin array classification so caller-replaced Array.isArray cannot deny valid
// vault arrays or change canonical digest and stage-pooling admission.
const BUILTIN_ARRAY_IS_ARRAY = Array.isArray;
// Expected prototype identities must not drift when global Array/Object
// constructors are replaced after import (research-only caller realm).
const BUILTIN_ARRAY_PROTOTYPE = Array.prototype;
const BUILTIN_OBJECT_PROTOTYPE = Object.prototype;
// Numeric admission must not change when caller code replaces ambient Number/Object helpers.
// Otherwise NaN, fractional counts or -0 can pass validation and alias JSON digests.
const BUILTIN_NUMBER_IS_FINITE = Number.isFinite;
const BUILTIN_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const BUILTIN_OBJECT_IS = Object.is;
const frozenValidation=(valid:boolean,errors:string[]):Validation=>BUILTIN_OBJECT_FREEZE({
  valid, errors:BUILTIN_OBJECT_FREEZE(errors),
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
  if(v===null||typeof v!=="object"||BUILTIN_NODE_IS_PROXY(v)||BUILTIN_ARRAY_IS_ARRAY(v))return false;
  try {
    const proto=BUILTIN_OBJECT_GET_PROTOTYPE_OF(v);
    return (proto===BUILTIN_OBJECT_PROTOTYPE||proto===null)&&!("toJSON" in v);
  } catch { return false; }
};
// Only own, enumerable data descriptors can participate in JSON persistence.
// Inspect descriptors rather than reading values, so accessors never execute.
const ownDataShape=(v:Record<string,unknown>,required?:readonly string[]):boolean=>{
  try {
    const keys=BUILTIN_REFLECT_OWN_KEYS(v);
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      if(typeof key!=="string")return false;
      const d=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(v,key);
      if(!d||!d.enumerable||!("value" in d))return false;
    }
    if(required){
      if(keys.length!==required.length)return false;
      for(let i=0;i<required.length;i++){
        if(!hasOwn(v,required[i]))return false;
      }
    }
    return true;
  } catch { return false; }
};
// Match the portable schema's ECMAScript whitespace semantics without
// trusting a caller-replaced String.prototype.trim after module initialization.
// Numeric array indices and denial slots must not dispatch through caller-replaced global String.
const BUILTIN_STRING = String;
const BUILTIN_STRING_TRIM = String.prototype.trim;
const BUILTIN_REFLECT_APPLY = Reflect.apply;
// Pin own-property admission: caller mutation must not reopen inherited kind
// dispatch or reject valid fixed-schema records.
const BUILTIN_OBJECT_HAS_OWN_PROPERTY = Object.prototype.hasOwnProperty;
const hasOwn = (value: object, key: PropertyKey): boolean =>
  BUILTIN_REFLECT_APPLY(BUILTIN_OBJECT_HAS_OWN_PROPERTY, value, [key]) as boolean;
// Stage and duplicate admission must not dispatch through caller-replaced Set methods.
// Capture the Set constructor as well as its methods: a caller-replaced global
// Set must not deny otherwise valid unique protocol arrays after module load.
const BUILTIN_SET = Set;
const BUILTIN_SET_HAS = Set.prototype.has;
const BUILTIN_SET_ADD = Set.prototype.add;
const setHas = (set: Set<unknown>, value: unknown): boolean =>
  BUILTIN_REFLECT_APPLY(BUILTIN_SET_HAS, set, [value]) as boolean;
// Capture own-key enumeration before caller code can replace Object.keys.
// Validation and canonical digest must inspect the same complete key set.
const BUILTIN_OBJECT_KEYS = Object.keys;
// Structural admission and canonical hashing must use the same native
// reflection methods even if a caller replaces ambient helpers later.
const BUILTIN_REFLECT_OWN_KEYS = Reflect.ownKeys;
const BUILTIN_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
// Canonical construction and validation denial recording must not depend on
// caller-replaced object helpers after this module is initialized.
const BUILTIN_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const BUILTIN_OBJECT_CREATE = Object.create;
// Bind canonical digest bytes to the module-load native serializer, not a
// caller-replaced ambient JSON.stringify after validation.
const BUILTIN_JSON_STRINGIFY = JSON.stringify;
// Bind SHA-256 update/digest to their module-load native methods. A caller
// can replace crypto.Hash prototype methods after validation and alias digests.
const HASH_METHOD_SNAPSHOT = createHash("sha256");
const BUILTIN_HASH_UPDATE = HASH_METHOD_SNAPSHOT.update;
const BUILTIN_HASH_DIGEST = HASH_METHOD_SNAPSHOT.digest;
// Capture the native exec directly: RegExp.prototype.test delegates to mutable
// RegExp.prototype.exec, so capturing test alone is not sufficient.
const BUILTIN_REGEXP_EXEC = RegExp.prototype.exec;
const str=(v:unknown)=>typeof v==="string"&&
  (BUILTIN_REFLECT_APPLY(BUILTIN_STRING_TRIM,v,[]) as string).length>0;
// Reuse the bounded v0.2 claimed-instant implementation for v0.1 syntax
// and chronology. A claimed timestamp is not authenticated clock evidence.
const instant = validForwardV02ClaimedInstant;
const compareInstants = compareForwardV02ClaimedInstants;
// Array.every skips holes, while JSON.stringify persists them as null.
// Inspect own indexed data descriptors to keep validation and hashing aligned.
const denseUniqueArray=(v:unknown,accept:(x:unknown)=>boolean):boolean=>{
  if(BUILTIN_NODE_IS_PROXY(v)||!BUILTIN_ARRAY_IS_ARRAY(v)||v.length===0)return false;
  try {
    // Array.prototype.toJSON can replace persisted array contents after validation.
    // Reject inherited/own hooks rather than hashing evidence that serializes differently.
    if(BUILTIN_OBJECT_GET_PROTOTYPE_OF(v)!==BUILTIN_ARRAY_PROTOTYPE||"toJSON" in v||BUILTIN_REFLECT_OWN_KEYS(v).length!==v.length+1)return false;
    const seen=new BUILTIN_SET<unknown>();
    for(let i=0;i<v.length;i++){
      const descriptor=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(v,BUILTIN_STRING(i));
      if(!descriptor||!descriptor.enumerable||!("value" in descriptor)||!accept(descriptor.value)||setHas(seen,descriptor.value))return false;
      BUILTIN_REFLECT_APPLY(BUILTIN_SET_ADD,seen,[descriptor.value]);
    }
    return true;
  } catch { return false; }
};
const strings=(v:unknown)=>denseUniqueArray(v,str);
const isSha256=(v:unknown):v is string=>typeof v==="string"&&
  (BUILTIN_REFLECT_APPLY(BUILTIN_REGEXP_EXEC,SHA,[v]) as RegExpExecArray|null)!==null;
const digests=(v:unknown)=>denseUniqueArray(v,isSha256);
// Inspect finite metric values through own data descriptors. Delegating to
// Array.prototype.some can admit NaN/Infinity when ambient methods are replaced,
// while JSON.stringify would silently persist those values as null.
// Reject -0: JSON.stringify turns it into 0, aliasing distinct result metrics.
const finiteMetricMap=(v:unknown):boolean=>{
  if(!obj(v)||!ownDataShape(v))return false;
  const keys=BUILTIN_OBJECT_KEYS(v);
  if(keys.length===0)return false;
  for(let i=0;i<keys.length;i++){
    const descriptor=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(v,keys[i]);
    if(!descriptor||!("value" in descriptor)||typeof descriptor.value!=="number"||!BUILTIN_NUMBER_IS_FINITE(descriptor.value)||BUILTIN_OBJECT_IS(descriptor.value,-0))return false;
  }
  return true;
};
// Match an already-validated frozen protocol array without trusting a mutable
// Array.prototype.includes implementation (ambient prototype pollution).
const exactOwnArrayEntry=(values:readonly string[],expected:string):boolean=>{
  try {
    for(let i=0;i<values.length;i++){
      const d=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(values,BUILTIN_STRING(i));
      if(d&&d.enumerable&&"value" in d&&d.value===expected)return true;
    }
  } catch { return false; }
  return false;
};
const canonical=(v:unknown):unknown=>{
  if(BUILTIN_NODE_IS_PROXY(v))throw new TypeError("Proxy is not admissible in Forward Evaluation Vault");
  if(BUILTIN_ARRAY_IS_ARRAY(v)){
    if(BUILTIN_OBJECT_GET_PROTOTYPE_OF(v)!==BUILTIN_ARRAY_PROTOTYPE||BUILTIN_REFLECT_OWN_KEYS(v).length!==v.length+1)throw new TypeError("non-JSON array in Forward Evaluation Vault");
    // Do not delegate canonical array traversal to mutable Array.from.
    // A replaced Array.from can erase elements and alias distinct digests.
    const output:unknown[]=[];
    for(let i=0;i<v.length;i++){
      const descriptor=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(v,BUILTIN_STRING(i));
      if(!descriptor||!descriptor.enumerable||!("value" in descriptor))throw new TypeError("non-JSON array in Forward Evaluation Vault");
      // A caller-independent inherited Array.prototype numeric setter must not
      // erase a validated metric/protocol entry from the canonical digest.
      BUILTIN_OBJECT_DEFINE_PROPERTY(output, BUILTIN_STRING(i), {
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
    const keys=BUILTIN_OBJECT_KEYS(v);
    for(let i=1;i<keys.length;i++){
      const key=keys[i];
      let j=i-1;
      while(j>=0&&keys[j]>key){keys[j+1]=keys[j];j--;}
      keys[j+1]=key;
    }
    const output:Record<string,unknown>=BUILTIN_OBJECT_CREATE(null) as Record<string,unknown>;
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      const descriptor=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(v,key);
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
  const hash = createHash("sha256");
  BUILTIN_REFLECT_APPLY(BUILTIN_HASH_UPDATE, hash, [BUILTIN_JSON_STRINGIFY(canonical(r))]);
  return BUILTIN_REFLECT_APPLY(BUILTIN_HASH_DIGEST, hash, ["hex"]) as string;
};

export function validateForwardVaultRecord(v:unknown):Validation {
  const e:string[]=[]; if(!obj(v)) return frozenValidation(false,["record must be an object"]);
  // A fresh error array has no own index yet: inherited numeric setters can
  // silently discard a denial and make an invalid research record appear valid.
  const appendError=(message:string):void=>{
    BUILTIN_OBJECT_DEFINE_PROPERTY(e,BUILTIN_STRING(e.length),{
      value:message,enumerable:true,writable:true,configurable:true,
    });
  };
  if(!ownDataShape(v))return frozenValidation(false,["record fields must be enumerable own data properties"]);
  if(v.schemaVersion!==FORWARD_EVALUATION_VAULT_SCHEMA_VERSION)appendError("invalid schemaVersion");
  if(!str(v.recordId))appendError("recordId must be non-empty"); if(!setHas(STAGES,v.evidenceStage))appendError("invalid evidenceStage"); if(!instant(v.createdAt))appendError("createdAt must be timezone-bound ISO timestamp");
  if(typeof v.kind!=="string"||!hasOwn(FIELDS,v.kind)) return frozenValidation(false,[...e,"invalid kind"]);
  if(!ownDataShape(v,FIELDS[v.kind as VaultKind]))appendError("record fields must exactly match kind");
  // Caller-replaced Array.prototype[Symbol.iterator] must not suppress unknown-field diagnostics.
  const actualFields=BUILTIN_OBJECT_KEYS(v);
  for(let i=0;i<actualFields.length;i++){
    const k=actualFields[i];
    if(!exactOwnArrayEntry(FIELDS[v.kind as VaultKind],k))appendError(`unknown field is not allowed: ${k}`);
  }
  const req=(...ks:string[])=>{
    for(let i=0;i<ks.length;i++){
      const k=ks[i];
      if(!str(v[k]))appendError(`${k} must be non-empty`);
    }
  };
  const dg=(...ks:string[])=>{
    for(let i=0;i<ks.length;i++){
      const k=ks[i];
      if(!isSha256(v[k]))appendError(`${k} must be SHA-256`);
    }
  };
  switch(v.kind){
    case "ENROLLMENT_PROTOCOL": req("enrollmentProtocolId","decisionSystem","protocolVersion"); if(!strings(v.eligibilityRules)||!strings(v.ticketUniverse))appendError("protocol rule arrays must be non-empty unique strings"); if(!instant(v.startAt)||(v.endAt!==null&&!instant(v.endAt)))appendError("protocol boundaries must be exact timestamps"); if(instant(v.startAt)&&v.endAt!==null&&instant(v.endAt)&&compareInstants(v.endAt as string,v.startAt as string)<0)appendError("protocol endAt precedes startAt"); break;
    case "MEMBERSHIP": req("cohortId","enrollmentProtocolId","canonicalRaceId","decisionRecordId","reason"); dg("enrollmentProtocolDigest","decisionRecordDigest"); if(!instant(v.enrolledAt))appendError("enrolledAt must be exact"); if(typeof v.included!=="boolean")appendError("included must be boolean"); break;
    case "ANALYSIS_SNAPSHOT": req("analysisSnapshotId","cohortId"); if(!instant(v.cutoffAt))appendError("cutoffAt must be exact"); if(!digests(v.membershipDigests))appendError("membershipDigests must be unique SHA-256 digests"); break;
    case "EVALUATION_PROTOCOL": req("evaluationProtocolId","protocolVersion"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")appendError("invalid comparisonMode"); if(v.oddsBasis!=="BUY_TIME"&&v.oddsBasis!=="CLOSING"&&v.oddsBasis!=="NONE")appendError("invalid oddsBasis"); if(!strings(v.metricFamilies)||!strings(v.benchmarkDecisionSystems))appendError("protocol arrays must be non-empty unique strings"); if(v.unresolvedPolicy!=="EXCLUDE_AND_COUNT")appendError("unresolvedPolicy must fail closed"); break;
    case "RESULT": req("resultId","analysisSnapshotId","evaluationProtocolId","decisionSystem","metricFamily","evaluatorVersion"); dg("analysisSnapshotDigest","evaluationProtocolDigest","sourceManifestDigest"); if(v.comparisonMode!=="SELECTED_RACE"&&v.comparisonMode!=="COMMON_COHORT")appendError("invalid comparisonMode"); if(v.oddsBasis!=="BUY_TIME"&&v.oddsBasis!=="CLOSING"&&v.oddsBasis!=="NONE")appendError("invalid oddsBasis"); // Never let a caller-replaced array iterator skip count admission.
      for(let i=0;i<2;i++){
        const k=i===0?"includedCount":"excludedCount";
        if(!BUILTIN_NUMBER_IS_SAFE_INTEGER(v[k])||(v[k] as number)<0||BUILTIN_OBJECT_IS(v[k],-0))appendError(`${k} must be non-negative safe integer`);
      } if(!finiteMetricMap(v.metrics))appendError("metrics must contain finite numbers"); break;
  }
  return frozenValidation(e.length===0,e);
}

export function classifyForwardVaultAppend(existing:ForwardVaultRecord|undefined,candidate:unknown):VaultAppendDecision { const v=validateForwardVaultRecord(candidate); if(!v.valid)return "REJECTED_INVALID"; const next=candidate as ForwardVaultRecord; // Only an explicit undefined means no prior record. A malformed/falsy readback
  // (null, false, 0, or empty string) must never authorize a fresh append.
  if(existing===undefined)return "APPEND"; if(!validateForwardVaultRecord(existing).valid)return "REJECTED_INVALID"; if(existing.recordId!==next.recordId)return "CONFLICT"; try { return forwardVaultDigest(existing)===forwardVaultDigest(next)?"IDEMPOTENT_NOOP":"CONFLICT"; } catch { return "REJECTED_INVALID"; } }
// Stage pooling is a runtime admission boundary, not only a TypeScript hint.
// Read only own data descriptors: never invoke untrusted array accessors.
export function canPoolStages(stages:EvidenceStage[]):boolean {
  try {
    if(BUILTIN_NODE_IS_PROXY(stages)||!BUILTIN_ARRAY_IS_ARRAY(stages)||BUILTIN_OBJECT_GET_PROTOTYPE_OF(stages)!==BUILTIN_ARRAY_PROTOTYPE)return false;
    if(BUILTIN_REFLECT_OWN_KEYS(stages).length!==stages.length+1)return false;
    let first:EvidenceStage|undefined;
    for(let i=0;i<stages.length;i++){
      const descriptor=BUILTIN_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(stages,BUILTIN_STRING(i));
      if(!descriptor||!("value" in descriptor)||!descriptor.enumerable||!setHas(STAGES,descriptor.value))return false;
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
