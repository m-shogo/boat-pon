import assert from "node:assert/strict";
import test from "node:test";
import {FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V, validateForwardVaultRecord} from "./forwardEvaluationVault.js";

const base={schemaVersion:V,kind:"ENROLLMENT_PROTOCOL" as const,recordId:"enroll:unknown-offset",enrollmentProtocolId:"enroll:unknown-offset",evidenceStage:"SHADOW_FORWARD" as const,createdAt:"2026-10-14T11:59:59Z",decisionSystem:"fixture",eligibilityRules:["predeclared"],startAt:"2026-10-14T12:00:00Z",endAt:null,ticketUniverse:["fixture"],protocolVersion:"v1"};

// RFC3339 -00:00 explicitly denotes an UNKNOWN local offset, not UTC.
// A PIT admission gate must not treat it as an exact UTC instant.
test("unknown -00:00 offset is not evidence of an exact createdAt instant",()=>{
  assert.equal(validateForwardVaultRecord({...base,createdAt:"2026-10-14T11:59:59-00:00"}).valid,false);
});
test("unknown -00:00 offset is not evidence of a frozen enrollment boundary",()=>{
  assert.equal(validateForwardVaultRecord({...base,startAt:"2026-10-14T12:00:00-00:00"}).valid,false);
  assert.equal(validateForwardVaultRecord({...base,endAt:"2026-10-14T13:00:00-00:00"}).valid,false);
});
test("known UTC representations remain valid",()=>{
  assert.equal(validateForwardVaultRecord({...base,createdAt:"2026-10-14T11:59:59Z"}).valid,true);
  assert.equal(validateForwardVaultRecord({...base,createdAt:"2026-10-14T11:59:59+00:00"}).valid,true);
  assert.equal(validateForwardVaultRecord({...base,createdAt:"2026-10-14T20:59:59+09:00"}).valid,true);
});
