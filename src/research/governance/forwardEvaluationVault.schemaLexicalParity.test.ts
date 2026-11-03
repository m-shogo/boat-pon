import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  validateForwardVaultRecord, type EnrollmentProtocol,
  type Membership, type AnalysisSnapshot, type EvaluationProtocol,
} from "./forwardEvaluationVault";
const sha=(s:string)=>s.repeat(64);
const timestamp="2026-10-16T07:00:00Z";
const base={schemaVersion:V,evidenceStage:"SHADOW_FORWARD" as const,createdAt:timestamp};
const enrollment:EnrollmentProtocol={...base,kind:"ENROLLMENT_PROTOCOL",recordId:"enrollment:1",enrollmentProtocolId:"enroll:1",decisionSystem:"research-fixture",eligibilityRules:["fixed"],startAt:timestamp,endAt:null,ticketUniverse:["fixture"],protocolVersion:"v1"};
const member:Membership={...base,kind:"MEMBERSHIP",recordId:"member:1",cohortId:"cohort:1",enrollmentProtocolId:"enroll:1",enrollmentProtocolDigest:sha("a"),canonicalRaceId:"race:1",decisionRecordId:"decision:1",decisionRecordDigest:sha("b"),enrolledAt:timestamp,included:true,reason:"fixture"};
const snapshot:AnalysisSnapshot={...base,kind:"ANALYSIS_SNAPSHOT",recordId:"snapshot:1",analysisSnapshotId:"snapshot:1",cohortId:"cohort:1",cutoffAt:timestamp,membershipDigests:[sha("c")]};
const protocol:EvaluationProtocol={...base,kind:"EVALUATION_PROTOCOL",recordId:"protocol:1",evaluationProtocolId:"eval:1",comparisonMode:"COMMON_COHORT",oddsBasis:"BUY_TIME",metricFamilies:["ROI"],unresolvedPolicy:"EXCLUDE_AND_COUNT",benchmarkDecisionSystems:["benchmark"],protocolVersion:"v1"};

test("runtime rejects malformed and lowercase timestamps in all five schema timestamp fields",()=>{
  for(const [record,field] of [
    [enrollment,"createdAt"],[enrollment,"startAt"],[enrollment,"endAt"],
    [member,"enrolledAt"],[snapshot,"cutoffAt"],[protocol,"createdAt"],
  ] as const){
    assert.equal(validateForwardVaultRecord(record).valid,true,`${record.kind} baseline`);
    for(const malformed of ["not-an-instant","2026-10-16t07:00:00z","2026-13-16T07:00:00Z","2026-10-16T25:00:00Z","2026-10-16T07:00:00-00:00"]){
      assert.equal(validateForwardVaultRecord({...record,[field]:malformed}).valid,false,`${record.kind}.${field}: ${malformed}`);
    }
  }
});
test("runtime retains valid UTC/offset instants and nullable enrollment endAt",()=>{
  for(const good of ["2026-10-16T07:00:00Z","2026-10-16T16:00:00+09:00","2026-10-16T07:00:00+00:00","2026-10-16T07:00:00.000001Z"]){
    assert.equal(validateForwardVaultRecord({...protocol,createdAt:good}).valid,true,good);
  }
  assert.equal(validateForwardVaultRecord({...enrollment,endAt:null}).valid,true);
});
