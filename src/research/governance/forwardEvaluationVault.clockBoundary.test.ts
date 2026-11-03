import assert from 'node:assert/strict';
import test from 'node:test';
import { FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, validateForwardVaultRecord, classifyForwardVaultAppend, type EnrollmentProtocol } from './forwardEvaluationVault.js';
const fixture=(startAt:string):EnrollmentProtocol=>({schemaVersion:V,kind:'ENROLLMENT_PROTOCOL',recordId:'enroll:clock',evidenceStage:'SHADOW_FORWARD',createdAt:'2026-10-14T00:00:00Z',enrollmentProtocolId:'enroll:clock',decisionSystem:'research-fixture',eligibilityRules:['rule'],startAt,endAt:null,ticketUniverse:['fixture'],protocolVersion:'v1'});
test('valid 23:59:59 and next-day 00:00:00 remain admissible',()=>{
  for(const t of ['2026-10-14T23:59:59Z','2026-10-15T00:00:00Z','2026-10-14T23:59:59.999+09:00'])assert.equal(validateForwardVaultRecord(fixture(t)).valid,true,t);
});
test('24:00:00 rollover is not a valid RFC3339 instant',()=>{
  for(const t of ['2026-10-14T24:00:00Z','2026-10-14T24:00:00.000Z','2026-10-14T24:00:00+09:00']){
    assert.equal(validateForwardVaultRecord(fixture(t)).valid,false,t);
    assert.equal(classifyForwardVaultAppend(undefined,fixture(t)),'REJECTED_INVALID',t);
  }
});
test('out-of-range minute and second rejected',()=>{
  for(const t of ['2026-10-14T12:60:00Z','2026-10-14T12:00:61Z'])assert.equal(validateForwardVaultRecord(fixture(t)).valid,false,t);
});
test('24:00:00 in createdAt also rejected',()=>{
  const p=fixture('2026-10-14T23:59:59Z');p.createdAt='2026-10-14T24:00:00Z';assert.equal(validateForwardVaultRecord(p).valid,false);
});
test('year zero is rejected by the canonical schema format boundary',()=>{
  const t='0000-10-14T00:00:00Z';
  assert.equal(validateForwardVaultRecord(fixture(t)).valid,false);
  assert.equal(classifyForwardVaultAppend(undefined,fixture(t)),'REJECTED_INVALID');
});
