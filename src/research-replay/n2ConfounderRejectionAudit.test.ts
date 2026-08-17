import assert from "node:assert/strict";
import test from "node:test";
import type { N2EdgeHistoricalConfirmationResult } from "./n2EdgeHistoricalConfirmation";
import { auditN2ConfoundersAndRejections } from "./n2ConfounderRejectionAudit";

function result(id:string,verdict:N2EdgeHistoricalConfirmationResult["verdict"]):N2EdgeHistoricalConfirmationResult{
 const confirmedSplit={split:"validation" as const,uniqueRaceCount:220,meanResidual:.02,standardError:.002,zScore:10,rawPValue:1e-10,holmAdjustedPValue:1e-10,supportSufficient:true,effectSufficient:true,directionMatchesDiscovery:true,statisticallyConfirmed:true};
 const rejectedSplit={...confirmedSplit,meanResidual:-.02,zScore:-10,directionMatchesDiscovery:false,statisticallyConfirmed:false};
 const insufficientSplit={...confirmedSplit,uniqueRaceCount:100,supportSufficient:false,statisticallyConfirmed:false};
 const validation=verdict==="HISTORICAL_CONFIRMED"?confirmedSplit:verdict==="HISTORICAL_REJECTED"?rejectedSplit:insufficientSplit;
 const test={...validation,split:"test" as const};
 return{hypothesisId:id,featureKey:"firstCourse",bucket:"1",discoveryDirection:"underpredicted",validation,test,verdict};
}

test("historical rejection is registered irreversibly even when a confounder explanation exists",()=>{
 const report=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","HISTORICAL_REJECTED")],confounderFlags:[{hypothesisId:"H1",flagId:"venue-concentration",severity:"info",detail:"one venue dominated"}]});
 assert.equal(report.status,"PASS");assert.equal(report.items[0].disposition,"REJECT_AND_REGISTER");assert.equal(report.rejectionEntries.length,1);
 assert.equal(report.rejectionEntries[0].rescueByConfounderExplanationAllowed,false);assert.equal(report.rejectionEntries[0].irreversibleWithinN2V1,true);assert.equal(report.items[0].promotionAuthorized,false);
});

test("insufficient holdout is not converted into a rejection",()=>{
 const report=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","INSUFFICIENT_HOLDOUT")],confounderFlags:[]});
 assert.equal(report.items[0].disposition,"INSUFFICIENT_HOLDOUT");assert.equal(report.rejectionEntries.length,0);assert.equal(report.insufficientCount,1);
});

test("blocking confounder can stop confirmed hypothesis but cannot promote anything",()=>{
 const report=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","HISTORICAL_CONFIRMED")],confounderFlags:[{hypothesisId:"H1",flagId:"era-concentration",severity:"blocking",detail:"holdout support concentrated"}]});
 assert.equal(report.items[0].disposition,"CONFIRMED_WITH_BLOCKING_CONFOUNDER");assert.equal(report.confirmedBlockedCount,1);assert.equal(report.invariants.confounderCanCreatePromotion,false);assert.equal(report.invariants.automaticPromotionAuthorized,false);
});

test("confirmed result without blocking flag stays pending review, never promoted",()=>{
 const report=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","HISTORICAL_CONFIRMED")],confounderFlags:[{hypothesisId:"H1",flagId:"coverage-note",severity:"info",detail:"balanced enough for review"}]});
 assert.equal(report.items[0].disposition,"CONFIRMED_PENDING_CONFOUNDER_REVIEW");assert.equal(report.items[0].promotionAuthorized,false);
});

test("rehashable historical verdict drift fails closed before disposition or rejection writes",()=>{
 for(const [sourceVerdict,forgedVerdict] of [
  ["HISTORICAL_CONFIRMED","HISTORICAL_REJECTED"],
  ["HISTORICAL_REJECTED","HISTORICAL_CONFIRMED"],
  ["INSUFFICIENT_HOLDOUT","HISTORICAL_REJECTED"],
 ] as const){
  const source=result("H1",sourceVerdict);
  const report=auditN2ConfoundersAndRejections({confirmationResults:[{...source,verdict:forgedVerdict}],confounderFlags:[]});
  assert.equal(report.status,"BLOCKED");
  assert.ok(report.blockers.includes(`HISTORICAL_VERDICT_INCONSISTENT:H1:${forgedVerdict}/${sourceVerdict}`));
  assert.equal(report.items.length,0);
  assert.equal(report.rejectionEntries.length,0);
 }
});

test("rehashable historical split semantic drift fails closed before disposition",()=>{
 const source=result("H1","HISTORICAL_CONFIRMED");
 const cases:[N2EdgeHistoricalConfirmationResult,string][]=[
  [{...source,validation:{...source.validation,supportSufficient:false,statisticallyConfirmed:false},verdict:"INSUFFICIENT_HOLDOUT"},"HISTORICAL_SPLIT_SUPPORT_INCONSISTENT:H1:validation"],
  [{...source,validation:{...source.validation,effectSufficient:false,statisticallyConfirmed:false},verdict:"HISTORICAL_REJECTED"},"HISTORICAL_SPLIT_EFFECT_INCONSISTENT:H1:validation"],
  [{...source,validation:{...source.validation,directionMatchesDiscovery:false,statisticallyConfirmed:false},verdict:"HISTORICAL_REJECTED"},"HISTORICAL_SPLIT_DIRECTION_INCONSISTENT:H1:validation"],
  [{...source,validation:{...source.validation,statisticallyConfirmed:false},verdict:"HISTORICAL_REJECTED"},"HISTORICAL_SPLIT_CONFIRMATION_INCONSISTENT:H1:validation"],
 ];
 for(const [forged,blocker] of cases){
  const report=auditN2ConfoundersAndRejections({confirmationResults:[forged],confounderFlags:[]});
  assert.equal(report.status,"BLOCKED");assert.ok(report.blockers.includes(blocker));assert.equal(report.items.length,0);assert.equal(report.rejectionEntries.length,0);
 }
});

test("rehashable p-value drift cannot forge a historical confirmation",()=>{
 const source=result("H1","HISTORICAL_CONFIRMED");
 const forgedSplit={...source.validation,standardError:0.02/1.5,zScore:1.5,rawPValue:0.001,holmAdjustedPValue:0.001};
 const forged={...source,validation:forgedSplit,test:{...forgedSplit,split:"test" as const}};
 const report=auditN2ConfoundersAndRejections({confirmationResults:[forged],confounderFlags:[]});
 assert.equal(report.status,"BLOCKED");
 assert.ok(report.blockers.includes("HISTORICAL_SPLIT_RAW_P_VALUE_INCONSISTENT:H1:validation"));
 assert.ok(report.blockers.includes("HISTORICAL_SPLIT_RAW_P_VALUE_INCONSISTENT:H1:test"));
 assert.equal(report.items.length,0);assert.equal(report.rejectionEntries.length,0);
});

test("flags for unknown hypotheses and duplicate confirmation results fail closed",()=>{
 const unknown=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","HISTORICAL_CONFIRMED")],confounderFlags:[{hypothesisId:"H2",flagId:"x",severity:"warning",detail:"x"}]});assert.equal(unknown.status,"BLOCKED");assert.ok(unknown.blockers.includes("UNKNOWN_FLAG_HYPOTHESIS:H2"));
 const dup=auditN2ConfoundersAndRejections({confirmationResults:[result("H1","HISTORICAL_CONFIRMED"),result("H1","HISTORICAL_REJECTED")],confounderFlags:[]});assert.equal(dup.status,"BLOCKED");assert.ok(dup.blockers.includes("DUPLICATE_CONFIRMATION:H1"));
});

test("audit is deterministic under input reordering",()=>{
 const results=[result("H1","HISTORICAL_CONFIRMED"),result("H2","HISTORICAL_REJECTED")];const flags=[{hypothesisId:"H1",flagId:"b",severity:"info" as const,detail:"b"},{hypothesisId:"H1",flagId:"a",severity:"warning" as const,detail:"a"}];
 const a=auditN2ConfoundersAndRejections({confirmationResults:results,confounderFlags:flags});const b=auditN2ConfoundersAndRejections({confirmationResults:[...results].reverse(),confounderFlags:[...flags].reverse()});assert.equal(a.outputDigest,b.outputDigest);assert.deepEqual(a.items,b.items);
});
