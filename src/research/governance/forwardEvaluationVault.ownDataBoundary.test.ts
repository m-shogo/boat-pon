import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EnrollmentProtocol,
  type EvaluationResult,
} from "./forwardEvaluationVault.js";

const base = {schemaVersion:V,evidenceStage:"SHADOW_FORWARD" as const,createdAt:"2026-10-19T00:00:00Z"};
const enrollment:EnrollmentProtocol = {...base,kind:"ENROLLMENT_PROTOCOL",recordId:"enroll:1",enrollmentProtocolId:"enroll:1",decisionSystem:"research-fixture",eligibilityRules:["fixed"],startAt:base.createdAt,endAt:null,ticketUniverse:["fixture-ticket"],protocolVersion:"v1"};
const sha = "a".repeat(64);
const result:EvaluationResult = {...base,kind:"RESULT",recordId:"result:1",resultId:"result:1",analysisSnapshotId:"snapshot:1",analysisSnapshotDigest:sha,evaluationProtocolId:"eval:1",evaluationProtocolDigest:sha,decisionSystem:"research-fixture",comparisonMode:"COMMON_COHORT",oddsBasis:"NONE",metricFamily:"ROI",includedCount:1,excludedCount:0,metrics:{roi:0.25},sourceManifestDigest:sha,evaluatorVersion:"v1"};

test("required non-enumerable own fields cannot disappear on JSON publication",()=>{
  for(const key of ["recordId","kind","createdAt","endAt"] as const){
    const candidate={...enrollment};
    Object.defineProperty(candidate,key,{enumerable:false});
    assert.equal(validateForwardVaultRecord(candidate).valid,false,key);
    assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
    assert.throws(()=>forwardVaultDigest(candidate),TypeError);
    assert.equal(classifyForwardVaultAppend(candidate,enrollment),"REJECTED_INVALID");
  }
});

test("required accessor fields fail closed without invoking their getters",()=>{
  for(const key of ["recordId","kind","createdAt","endAt"] as const){
    const candidate={...enrollment};
    let getterReads=0;
    Object.defineProperty(candidate,key,{enumerable:true,configurable:true,get(){getterReads++;return enrollment[key];}});
    assert.equal(validateForwardVaultRecord(candidate).valid,false,key);
    assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
    assert.throws(()=>forwardVaultDigest(candidate),TypeError);
    assert.equal(getterReads,0,key);
  }
});

test("symbol and non-enumerable extra record keys are rejected",()=>{
  const hidden={...enrollment};
  Object.defineProperty(hidden,"unpublished",{value:"changed",enumerable:false});
  const symbol={...enrollment};
  Object.defineProperty(symbol,Symbol("unpublished"),{value:"changed",enumerable:true});
  for(const candidate of [hidden,symbol]){
    assert.equal(validateForwardVaultRecord(candidate).valid,false);
    assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
    assert.throws(()=>forwardVaultDigest(candidate),TypeError);
  }
});

test("metrics require own enumerable numeric data descriptors",()=>{
  const hidden={roi:0.25};
  Object.defineProperty(hidden,"unpublished",{value:9,enumerable:false});
  const symbol={roi:0.25};
  Object.defineProperty(symbol,Symbol("unpublished"),{value:9,enumerable:true});
  const accessor={roi:0.25};
  let getterReads=0;
  Object.defineProperty(accessor,"roi",{enumerable:true,configurable:true,get(){getterReads++;return 0.25;}});
  for(const metrics of [hidden,symbol,accessor]){
    const candidate={...result,metrics};
    assert.equal(validateForwardVaultRecord(candidate).valid,false);
    assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
    assert.throws(()=>forwardVaultDigest(candidate),TypeError);
  }
  assert.equal(getterReads,0);
});

test("valid records remain appendable and idempotent with null-prototype metrics",()=>{
  assert.equal(validateForwardVaultRecord(enrollment).valid,true);
  assert.equal(classifyForwardVaultAppend(undefined,enrollment),"APPEND");
  assert.equal(classifyForwardVaultAppend(enrollment,{...enrollment}),"IDEMPOTENT_NOOP");
  const nullMetrics=Object.assign(Object.create(null),{roi:0.25}) as Record<string,number>;
  const candidate={...result,metrics:nullMetrics};
  assert.equal(validateForwardVaultRecord(candidate).valid,true);
  assert.equal(forwardVaultDigest(candidate),forwardVaultDigest(result));
  assert.equal(classifyForwardVaultAppend(result,candidate),"IDEMPOTENT_NOOP");
});
