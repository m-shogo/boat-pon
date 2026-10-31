import assert from 'node:assert/strict';
import test from 'node:test';
import { FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, validateForwardVaultRecord, classifyForwardVaultAppend, type EnrollmentProtocol } from './forwardEvaluationVault.js';
const fixture = (startAt:string):EnrollmentProtocol => ({schemaVersion:V,kind:'ENROLLMENT_PROTOCOL',recordId:'enroll:calendar-fixture',evidenceStage:'SHADOW_FORWARD',createdAt:'1900-01-01T00:00:00Z',enrollmentProtocolId:'enroll:calendar-fixture',decisionSystem:'research-fixture',eligibilityRules:['rule'],startAt,endAt:null,ticketUniverse:['fixture'],protocolVersion:'v1'});
test('valid leap day and timezone offset remain admissible',()=>{
  for(const instant of ['2024-02-29T23:59:59Z','2024-02-29T23:59:59.123+09:00','2026-02-28T00:00:00Z']){
    const p=fixture(instant);assert.equal(validateForwardVaultRecord(p).valid,true,instant);assert.equal(classifyForwardVaultAppend(undefined,p),'APPEND',instant);
  }
});
test('impossible February 30 is rejected before cohort admission',()=>{
  const p=fixture('2026-02-30T00:00:00Z');assert.equal(validateForwardVaultRecord(p).valid,false);assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
test('non-leap February 29 is rejected',()=>{
  const p=fixture('2026-02-29T00:00:00Z');assert.equal(validateForwardVaultRecord(p).valid,false);assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
test('April 31 with a timezone offset is rejected',()=>{
  const p=fixture('2026-04-31T00:00:00+09:00');assert.equal(validateForwardVaultRecord(p).valid,false);assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
test('century leap-year rules are exact',()=>{
  assert.equal(validateForwardVaultRecord(fixture('2000-02-29T00:00:00Z')).valid,true);
  assert.equal(validateForwardVaultRecord(fixture('2100-02-29T00:00:00Z')).valid,false);
});
test('invalid calendar date is rejected in record creation timestamp',()=>{
  const p=fixture('2026-02-28T00:00:00Z');p.createdAt='2026-04-31T00:00:00Z';
  assert.equal(validateForwardVaultRecord(p).valid,false);
  assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
