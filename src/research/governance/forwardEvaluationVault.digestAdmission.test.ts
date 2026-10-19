import assert from "node:assert/strict";
import test from "node:test";
import { FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, classifyForwardVaultAppend, forwardVaultDigest, validateForwardVaultRecord, type ForwardVaultRecord, type Membership } from "./forwardEvaluationVault";
const sha=(c:string)=>c.repeat(64);
const membership=():Membership=>({schemaVersion:V,kind:"MEMBERSHIP",recordId:"member:1",evidenceStage:"SHADOW_FORWARD",createdAt:"2026-09-24T10:00:00Z",cohortId:"cohort:1",enrollmentProtocolId:"enroll:1",enrollmentProtocolDigest:sha("a"),canonicalRaceId:"fixture-race-1",decisionRecordId:"decision:1",decisionRecordDigest:sha("b"),enrolledAt:"2026-09-24T10:00:00Z",included:true,reason:"prospective rule matched"});
test("direct digest rejects invalid membership before JSON aliases",()=>{
  const good=membership();
  assert.equal(validateForwardVaultRecord(good).valid,true);
  const hash=forwardVaultDigest(good);
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert.equal(forwardVaultDigest({...good}),hash);
  const nan={...good,included:NaN} as unknown as Membership;
  const nul={...good,included:null} as unknown as Membership;
  assert.equal(JSON.stringify(nan),JSON.stringify(nul));
  for(const bad of [nan,nul,{...good,included:undefined} as unknown as Membership]){
    assert.equal(validateForwardVaultRecord(bad).valid,false);
    assert.equal(classifyForwardVaultAppend(undefined,bad),"REJECTED_INVALID");
    assert.throws(()=>forwardVaultDigest(bad),TypeError);
  }
});
test("direct digest rejects non-finite metric aliases",()=>{
  const good={schemaVersion:V,kind:"RESULT",recordId:"result:1",evidenceStage:"SHADOW_FORWARD",createdAt:"2026-09-24T11:00:00Z",resultId:"result:1",analysisSnapshotId:"snapshot:1",analysisSnapshotDigest:sha("c"),evaluationProtocolId:"eval:1",evaluationProtocolDigest:sha("a"),decisionSystem:"research-fixture",comparisonMode:"COMMON_COHORT",oddsBasis:"BUY_TIME",metricFamily:"ROI",includedCount:1,excludedCount:0,metrics:{roi:1.2},sourceManifestDigest:sha("d"),evaluatorVersion:"fixture-v1"} as ForwardVaultRecord;
  assert.equal(validateForwardVaultRecord(good).valid,true);
  assert.match(forwardVaultDigest(good),/^[0-9a-f]{64}$/);
  const nan={...good,metrics:{roi:NaN}} as ForwardVaultRecord;
  const nul={...good,metrics:{roi:null}} as unknown as ForwardVaultRecord;
  assert.equal(JSON.stringify(nan),JSON.stringify(nul));
  for(const bad of [nan,nul,{...good,metrics:{roi:Infinity}} as ForwardVaultRecord]){
    assert.equal(validateForwardVaultRecord(bad).valid,false);
    assert.throws(()=>forwardVaultDigest(bad),TypeError);
  }
});
