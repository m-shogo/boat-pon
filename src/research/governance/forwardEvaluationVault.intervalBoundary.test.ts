import assert from 'node:assert/strict';
import test from 'node:test';
import { FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, validateForwardVaultRecord, classifyForwardVaultAppend, type EnrollmentProtocol } from './forwardEvaluationVault.js';
const protocol=(startAt:string,endAt:string|null):EnrollmentProtocol=>({schemaVersion:V,kind:'ENROLLMENT_PROTOCOL',recordId:'enroll:interval',evidenceStage:'SHADOW_FORWARD',createdAt:'2026-10-14T00:00:00Z',enrollmentProtocolId:'enroll:interval',decisionSystem:'research-fixture',eligibilityRules:['a'],startAt,endAt,ticketUniverse:['x'],protocolVersion:'v1'});
test('forward interval accepts end after start across timezones',()=>{
  assert.equal(validateForwardVaultRecord(protocol('2026-10-14T12:00:00+09:00','2026-10-14T04:00:00Z')).valid,true);
});
test('open-ended interval remains valid',()=>{
  assert.equal(validateForwardVaultRecord(protocol('2026-10-14T12:00:00Z',null)).valid,true);
});
test('backwards interval must not be admitted',()=>{
  const p=protocol('2026-10-14T12:00:00Z','2026-10-13T12:00:00Z');
  assert.equal(validateForwardVaultRecord(p).valid,false);
  assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
test('backwards interval below one millisecond must not be admitted',()=>{
  const p=protocol('2026-10-14T12:00:00.0002Z','2026-10-14T12:00:00.0001Z');
  assert.equal(validateForwardVaultRecord(p).valid,false);
  assert.equal(classifyForwardVaultAppend(undefined,p),'REJECTED_INVALID');
});
test('equal endpoints remain valid until zero-duration policy is separately defined',()=>{
  assert.equal(validateForwardVaultRecord(protocol('2026-10-14T12:00:00Z','2026-10-14T12:00:00Z')).valid,true);
});
test('sub-millisecond ordering normalizes timezone offsets',()=>{
  const invalid=protocol('2026-10-14T12:00:00.0002+09:00','2026-10-14T03:00:00.0001Z');
  assert.equal(validateForwardVaultRecord(invalid).valid,false);
  const valid=protocol('2026-10-14T12:00:00.0001+09:00','2026-10-14T03:00:00.0002Z');
  assert.equal(validateForwardVaultRecord(valid).valid,true);
});
