import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_EVALUATION_VAULT_SCHEMA_VERSION as V,
  forwardVaultDigest, resultMatchesProtocol,
  type EvaluationProtocol, type EvaluationResult,
} from "./forwardEvaluationVault.js";

const SHA="a".repeat(64);
const protocol=():EvaluationProtocol=>({
  schemaVersion:V,kind:"EVALUATION_PROTOCOL",recordId:"protocol:1",evidenceStage:"SHADOW_FORWARD",
  createdAt:"2026-10-14T00:00:00Z",evaluationProtocolId:"eval:1",
  comparisonMode:"COMMON_COHORT",oddsBasis:"NONE",metricFamilies:["ROI"],
  unresolvedPolicy:"EXCLUDE_AND_COUNT",benchmarkDecisionSystems:["research-fixture"],protocolVersion:"v1",
});
const result=(p=protocol()):EvaluationResult=>({
  schemaVersion:V,kind:"RESULT",recordId:"result:1",evidenceStage:"SHADOW_FORWARD",
  createdAt:"2026-10-14T01:00:00Z",resultId:"result:1",analysisSnapshotId:"snapshot:1",
  analysisSnapshotDigest:SHA,evaluationProtocolId:p.evaluationProtocolId,
  evaluationProtocolDigest:forwardVaultDigest(p),decisionSystem:"research-fixture",
  comparisonMode:p.comparisonMode,oddsBasis:p.oddsBasis,metricFamily:"ROI",
  includedCount:1,excludedCount:0,metrics:{roi:0.1},sourceManifestDigest:SHA,evaluatorVersion:"v1",
});

test("valid prospective result matches frozen protocol",()=>{
  const p=protocol();assert.equal(resultMatchesProtocol(result(p),p),true);
});
test("metric family not enrolled in protocol is rejected",()=>{
  const p=protocol();assert.equal(resultMatchesProtocol({...result(p),metricFamily:"UNKNOWN"},p),false);
});
test("retrospectively authored protocol is rejected even with matching digest",()=>{
  const p={...protocol(),createdAt:"2026-10-14T02:00:00Z"};
  assert.equal(resultMatchesProtocol(result(p),p),false);
});
test("invalid record cannot be admitted by digest equality",()=>{
  const p=protocol();const r=result(p);
  assert.equal(resultMatchesProtocol({...r,metrics:{roi:Infinity}},p),false);
  assert.equal(resultMatchesProtocol({...r,unexpected:true} as EvaluationResult,p),false);
});
test("malformed runtime arguments fail closed without throwing",()=>{
  const p=protocol();
  assert.equal(resultMatchesProtocol(null as unknown as EvaluationResult,p),false);
  assert.equal(resultMatchesProtocol(result(p),null as unknown as EvaluationProtocol),false);
});
test("ambient serializer failure is converted to false and restored",()=>{
  const p=protocol();const r=result(p);const original=JSON.stringify;
  try {JSON.stringify=(()=>{throw new Error("fixture serializer failure")}) as typeof JSON.stringify;
    assert.equal(resultMatchesProtocol(r,p),false);
  } finally {JSON.stringify=original;}
  assert.equal(resultMatchesProtocol(r,p),true);
});
