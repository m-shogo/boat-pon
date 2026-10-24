import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  classifyForwardVaultAppend,
  forwardVaultDigest,
  validateForwardVaultRecord,
  type EnrollmentProtocol, type AnalysisSnapshot, type EvaluationProtocol,
} from "./forwardEvaluationVault.js";

const base = {schemaVersion:V,evidenceStage:"SHADOW_FORWARD" as const,createdAt:"2026-10-19T00:00:00Z"};
const enrollment:EnrollmentProtocol = {...base,kind:"ENROLLMENT_PROTOCOL",recordId:"enroll:1",enrollmentProtocolId:"enroll:1",decisionSystem:"research-fixture",eligibilityRules:["fixed"],startAt:base.createdAt,endAt:null,ticketUniverse:["fixture-ticket"],protocolVersion:"v1"};
const snapshot:AnalysisSnapshot = {...base,kind:"ANALYSIS_SNAPSHOT",recordId:"snapshot:1",analysisSnapshotId:"snapshot:1",cohortId:"cohort:1",cutoffAt:base.createdAt,membershipDigests:["a".repeat(64)]};
const protocol:EvaluationProtocol = {...base,kind:"EVALUATION_PROTOCOL",recordId:"eval:1",evaluationProtocolId:"eval:1",comparisonMode:"COMMON_COHORT",oddsBasis:"NONE",metricFamilies:["ROI"],unresolvedPolicy:"EXCLUDE_AND_COUNT",benchmarkDecisionSystems:["research-fixture"],protocolVersion:"v1"};

const cases = [
  [enrollment,"eligibilityRules","fixed"],
  [enrollment,"ticketUniverse","fixture-ticket"],
  [snapshot,"membershipDigests","a".repeat(64)],
  [protocol,"metricFamilies","ROI"],
  [protocol,"benchmarkDecisionSystems","research-fixture"],
] as const;

test("all five array fields reject holes that would persist as null",()=>{
  for(const [record,key,value] of cases){
    const hole = new Array<string>(1);
    const mixed = new Array<string>(2); mixed[1]=value;
    for(const array of [hole,mixed]){
      const candidate = {...record,[key]:array};
      assert.equal(validateForwardVaultRecord(candidate).valid,false,`${record.kind}.${key}`);
      assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
      assert.throws(()=>forwardVaultDigest(candidate as typeof record),TypeError);
      assert.match(JSON.stringify(array),/null/u);
    }
  }
});

test("array accessors and extra own properties cannot enter a vault digest",()=>{
  for(const [record,key,value] of cases){
    const getter = [value]; Object.defineProperty(getter,"0",{enumerable:true,configurable:true,get(){throw new Error("must not execute");}});
    const extra = [value] as string[] & {note?:string}; extra.note="unpersisted";
    for(const array of [getter,extra]){
      const candidate = {...record,[key]:array};
      assert.equal(validateForwardVaultRecord(candidate).valid,false,`${record.kind}.${key}`);
      assert.equal(classifyForwardVaultAppend(undefined,candidate),"REJECTED_INVALID");
      assert.throws(()=>forwardVaultDigest(candidate as typeof record),TypeError);
    }
  }
});

test("ordinary arrays preserve valid append and idempotency behavior",()=>{
  for(const [record] of cases){
    assert.equal(validateForwardVaultRecord(record).valid,true);
    assert.equal(classifyForwardVaultAppend(undefined,record),"APPEND");
    assert.equal(classifyForwardVaultAppend(record,{...record}),"IDEMPOTENT_NOOP");
  }
});
