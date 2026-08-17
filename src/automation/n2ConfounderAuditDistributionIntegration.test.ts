import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import type { N2EdgeHistoricalConfirmationReport, N2EdgeHistoricalConfirmationResult } from "../research-replay/n2EdgeHistoricalConfirmation";
import type { N2EdgeHoldoutDistributionEvidenceReport } from "../research-replay/n2EdgeHoldoutDistributionEvidence";
import { createN2ConfounderAuditExecutor } from "./n2ConfounderAuditExecutor";
import type { ExecutorContext } from "./taskExecutors";

function splitResult(
  split: "validation" | "test",
  overrides: Partial<N2EdgeHistoricalConfirmationResult["test"]> = {},
) {
  return { split, uniqueRaceCount:220, meanResidual:0.02, standardError:0.002, zScore:10, rawPValue:1e-8, holmAdjustedPValue:1e-8, supportSufficient:true, effectSufficient:true, directionMatchesDiscovery:true, statisticallyConfirmed:true, ...overrides };
}
function confirmationResult(id:string, verdict:N2EdgeHistoricalConfirmationResult["verdict"]="HISTORICAL_CONFIRMED"):N2EdgeHistoricalConfirmationResult{
  const test = verdict === "HISTORICAL_REJECTED"
    ? splitResult("test", { meanResidual:-0.02, zScore:-10, directionMatchesDiscovery:false, statisticallyConfirmed:false })
    : verdict === "INSUFFICIENT_HOLDOUT"
      ? splitResult("test", { uniqueRaceCount:199, supportSufficient:false, statisticallyConfirmed:false })
      : splitResult("test");
  return { hypothesisId:id, featureKey:"firstCourse", bucket:"1", discoveryDirection:"underpredicted", validation:splitResult("validation"), test, verdict };
}
function confirmation(results:N2EdgeHistoricalConfirmationResult[]):N2EdgeHistoricalConfirmationReport{
  const core={confirmationVersion:"n2-edge-historical-confirmation-v1" as const,status:"PASS" as const,blockers:[] as string[],lockedHypothesisCount:results.length,validationRaceCount:220,testRaceCount:220,confirmationMethod:{rediscoveryAllowed:false as const,interactionSearchAllowed:false as const,raceLevelResidualRequired:true as const,minUniqueRacesPerSplit:200,minAbsoluteResidual:0.001,familyWiseAlpha:0.05,multipleTesting:"Holm-Bonferroni separately within validation and test" as const,bothHoldoutSplitsRequired:true as const,sameDirectionRequired:true as const,forwardShadowUsed:false as const},confirmedCount:results.filter(r=>r.verdict==="HISTORICAL_CONFIRMED").length,rejectedCount:results.filter(r=>r.verdict==="HISTORICAL_REJECTED").length,insufficientCount:results.filter(r=>r.verdict==="INSUFFICIENT_HOLDOUT").length,results,authority:{roiUsedForConfirmation:false as const,payoutUsedForConfirmation:false as const,trainLabelsUsedForConfirmation:false as const,forwardLabelsUsedForConfirmation:false as const,automaticPromotionAuthorized:false as const,currentBuyConnectionAuthorized:false as const,lineConnectionAuthorized:false as const,publicPublishAuthorized:false as const,automatedBettingAuthorized:false as const,productionApplyAuthorized:false as const}};
  return {...core,outputDigest:canonicalHash(core)};
}
function distribution(id:string, concentrated=false):N2EdgeHoldoutDistributionEvidenceReport{
  const validation={split:"validation" as const,uniqueRaceCount:220,distinctVenueCount:concentrated?8:17,maxVenueRaceCount:concentrated?44:14,maxVenueShare:concentrated?0.2:14/220,distinctYearCount:2,maxYearRaceCount:120,maxYearShare:120/220};
  const holdout={split:"test" as const,uniqueRaceCount:220,distinctVenueCount:17,maxVenueRaceCount:14,maxVenueShare:14/220,distinctYearCount:2,maxYearRaceCount:120,maxYearShare:120/220};
  const core={evidenceVersion:"n2-edge-holdout-distribution-evidence-v1" as const,status:"PASS" as const,blockers:[] as string[],lockedHypothesisCount:1,inputRaceCount:440,validationInputRaceCount:220,testInputRaceCount:220,hypotheses:[{hypothesisId:id,validation,test:holdout}],privacy:{raceKeysPersisted:false as const,venueCodesPersisted:false as const,yearsPersisted:false as const,perRaceResidualsPersisted:false as const},authority:{confirmationVerdictChanged:false as const,rejectionRescueAuthorized:false as const,automaticPromotionAuthorized:false as const,forwardLabelsUsed:false as const,currentBuyConnectionAuthorized:false as const,lineConnectionAuthorized:false as const,publicPublishAuthorized:false as const,automatedBettingAuthorized:false as const,productionApplyAuthorized:false as const}};
  return {...core,outputDigest:canonicalHash(core)};
}
function discoveryAuthority(){return{discoveryOnly:true,validationLabelsUsedForDiscovery:false,testLabelsUsedForDiscovery:false,automaticPromotionAuthorized:false,automaticForwardAuthorized:false,roiPayoutAccessAuthorized:false,databaseWriteAuthorized:false,currentBuyConnectionAuthorized:false,lineConnectionAuthorized:false,publicPublishAuthorized:false,automatedBettingAuthorized:false,productionApplyAuthorized:false};}
function writeCurrentDiscovery(root:string,result:N2EdgeHistoricalConfirmationResult){
  const dir=join(root,"reports/n2");mkdirSync(dir,{recursive:true});
  const summary={status:"PASS" as const,scan:{status:"PASS" as const,scanVersion:"n2-edge-hypothesis-scan-v2",signals:[{hypothesisId:result.hypothesisId,featureKey:result.featureKey,bucket:result.bucket,direction:result.discoveryDirection,discoverySplit:"train" as const,forwardShadowReserved:true as const}],authority:discoveryAuthority()},revision:"fixture-current"};
  const discovery={...summary,outputDigest:canonicalHash(summary)};
  writeFileSync(join(dir,"n2-edge-hypothesis-scan.json"),`${JSON.stringify(discovery,null,2)}\n`,"utf8");
  return discovery;
}
function writeArtifact(root:string,result:N2EdgeHistoricalConfirmationResult,evidence:N2EdgeHoldoutDistributionEvidenceReport){const dir=join(root,"reports/n2");mkdirSync(dir,{recursive:true});const discovery=writeCurrentDiscovery(root,result);const summary={status:"PASS",discoveryArtifactDigest:canonicalHash(discovery),confirmation:confirmation([result]),distributionEvidence:evidence,authority:{automaticPromotionAuthorized:false,currentBuyConnectionAuthorized:false,lineConnectionAuthorized:false,publicPublishAuthorized:false,automatedBettingAuthorized:false,productionApplyAuthorized:false}};const payload={...summary,generatedAt:"2026-08-08T08:00:00.000Z",outputDigest:canonicalHash(summary)};writeFileSync(join(dir,"n2-edge-historical-test.json"),JSON.stringify(payload,null,2));}
function context(root:string):ExecutorContext{return{repoRoot:root,runId:"run-n2-042-dist",requestId:"REQ-n2-042-dist",taskId:"TASK-N2-042",sidecarPath:join(root,"data/research-replay.sqlite"),historyDir:join(root,"reports/automation/history"),reportsDir:join(root,"reports/n2"),dryRun:false,taskStatuses:{"TASK-N2-041":"PASS"}};}
function withRoot(fn:(root:string)=>void){const root=mkdtempSync(join(tmpdir(),"boat-pon-n2-042-dist-"));try{fn(root);}finally{rmSync(root,{recursive:true,force:true});}}

test("well-distributed confirmed hypothesis becomes confirmed-pending, never auto-promoted",()=>withRoot(root=>{
  const result=confirmationResult("H-GOOD");writeArtifact(root,result,distribution("H-GOOD"));
  const outcome=createN2ConfounderAuditExecutor()(context(root));assert.equal(outcome.result,"PASS");
  const report=JSON.parse(readFileSync(join(root,"reports/n2/n2-confounder-audit.json"),"utf8")) as any;
  assert.equal(report.distributionBridge.evidenceMode,"aggregate_distribution_present");
  assert.equal(report.distributionBridge.confirmedWithoutBlockingConcentrationCount,1);
  assert.equal(report.confirmedPendingCount,1);assert.equal(report.confirmedBlockedCount,0);
  assert.equal(report.audit.items[0].disposition,"CONFIRMED_PENDING_CONFOUNDER_REVIEW");
  assert.equal(report.audit.items[0].promotionAuthorized,false);assert.equal(report.authority.automaticPromotionAuthorized,false);
  const registryDir=join(root,"research/registries/rejections");
  assert.equal(readdirSync(root).includes("research"),false,"confirmed hypotheses must not create a rejection registry side effect");
  void registryDir;
}));

test("pre-registered concentration failure remains blocking",()=>withRoot(root=>{
  const result=confirmationResult("H-CONCENTRATED");writeArtifact(root,result,distribution("H-CONCENTRATED",true));
  const outcome=createN2ConfounderAuditExecutor()(context(root));assert.equal(outcome.result,"PASS");
  const report=JSON.parse(readFileSync(join(root,"reports/n2/n2-confounder-audit.json"),"utf8")) as any;
  assert.equal(report.confirmedBlockedCount,1);assert.equal(report.confirmedPendingCount,0);
  assert.equal(report.audit.items[0].disposition,"CONFIRMED_WITH_BLOCKING_CONFOUNDER");
  assert.equal(report.audit.items[0].confounderFlags[0].flagId,"holdout-distribution-concentration-v1");
  assert.equal(report.authority.automaticPromotionAuthorized,false);
}));

test("historically rejected hypothesis fails closed until a canonical rejection subject exists",()=>withRoot(root=>{
  const result=confirmationResult("H-REJECTED","HISTORICAL_REJECTED");writeArtifact(root,result,distribution("H-REJECTED"));
  const outcome=createN2ConfounderAuditExecutor()(context(root));
  assert.equal(outcome.result,"BLOCKED");
  assert.ok(outcome.blocks.some(blocker=>blocker.includes("REJECTION_SUBJECT_ID_MISMATCH")&&blocker.includes(":discovery:H-REJECTED")));
  assert.equal(existsSync(join(root,"research")),false);
  assert.equal(existsSync(join(root,"reports/n2/n2-confounder-audit.json")),false);
}));
