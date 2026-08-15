import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import type { ProgramFeatureSnapshot } from "../domain/programFeatures";
import type { N2EdgeHoldoutSourceRead } from "../research-replay/n2EdgeHoldoutSource";
import type { N2EdgeSelectedProgramFeaturesRead } from "../research-replay/n2EdgeSelectedProgramFeatures";
import {
  N2_EDGE_HYPOTHESIS_SCAN_VERSION,
  type N2EdgeHypothesis,
} from "../research-replay/n2EdgeHypothesisScan";
import { createN2EdgeHistoricalTestExecutor } from "./n2EdgeHistoricalTestExecutor";
import type { ExecutorContext } from "./taskExecutors";

function date(base:string,offset:number){const d=new Date(`${base}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
function safeProgram():ProgramFeatureSnapshot{return{boats:Array.from({length:6},(_,i)=>({course:i+1,className:i===0?"A1":"B1",nationalWinRate:5+i*.1,nationalTop2Rate:35+i,localWinRate:4.8+i*.1,localTop2Rate:33+i,motorTop2Rate:31+i,boatTop2Rate:30+i,venueMotorTop2Rate:null,venueBoatTop2Rate:null,courseAvgSt:null,courseTop3Rate:null,flyingCount:null,lateStartCount:null,exhibitionStResidual:null}))};}

function lockedHypothesis():N2EdgeHypothesis{return{hypothesisId:"N2EDGE-lock-course1",featureKey:"firstCourse",family:"course",selectionRole:"first",bucket:"1",direction:"underpredicted",uniqueRaceCount:300,meanResidual:.02,standardError:.002,zScore:10,rawPValue:1e-8,holmAdjustedPValue:1e-8,discoverySplit:"train",confirmationSplits:["validation","test"],forwardShadowReserved:true};}
function writeDiscovery(root:string,signals:N2EdgeHypothesis[],scanVersion:string=N2_EDGE_HYPOTHESIS_SCAN_VERSION){const path=join(root,"reports/n2/n2-edge-hypothesis-scan.json");mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({status:"PASS",scan:{status:"PASS",scanVersion,signals},outputDigest:"a".repeat(64)}));}

function source():N2EdgeHoldoutSourceRead{
 const outcomes:Array<{canonicalRaceKey:string;winningSelection:string}>=[]; const candidates:N2EdgeHoldoutSourceRead["candidates"]=[];
 for(let v=1;v<=17;v++){const venue=String(v).padStart(2,"0");
  for(const warmBase of ["2021-12-01","2023-12-01"]){for(let i=0;i<36;i++){const d=date(warmBase,Math.floor(i/12));outcomes.push({canonicalRaceKey:`${d}:${venue}:R${i%12+1}`,winningSelection:"1-2-3"});}}
  for(const [base] of [["2022-01-10"],["2024-01-10"]] as const){for(let i=0;i<13;i++){const d=date(base,Math.floor(i/12));const r=i%12+1;const key=`${d}:${venue}:R${r}`;outcomes.push({canonicalRaceKey:key,winningSelection:i%2===0?"1-2-3":"2-1-3"});candidates.push({canonicalRaceKey:key,primaryRaceId:`${d.replaceAll("-","")}-${venue}-${String(r).padStart(2,"0")}`,primaryIdentityEncoding:"venue_code",decisionCutoff:`${d}T05:00:00.000Z`,sourceObservedAt:`${d}T00:00:00.000Z`});}}
 }
 outcomes.sort((a,b)=>a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));candidates.sort((a,b)=>a.canonicalRaceKey.localeCompare(b.canonicalRaceKey));
 return{readerVersion:"n2-edge-holdout-source-v1",status:"PASS",blockers:[],historyFromDateInclusive:"2021-07-05",holdoutFromDateInclusive:"2022-01-01",holdoutToDateInclusive:"2025-12-31",historicalOutcomeCount:outcomes.length,officialProgramMetadataCount:candidates.length,eligibleProgramMetadataCount:candidates.length,candidateRaceCount:candidates.length,excludedProgramCount:0,excludedProgramReasonCounts:{},missingOfficialProgramCount:0,missingCleanWinnerCount:0,historicalOutcomes:outcomes,candidates,reads:{primaryDatabaseReadCount:1,sidecarDatabaseReadCount:1,rawJsonReadCount:0,primaryDatabaseWriteCount:0,sidecarDatabaseWriteCount:0,networkRequestCount:0},outputDigest:canonicalHash({outcomes,candidates})};
}
function selected(candidates:N2EdgeHoldoutSourceRead["candidates"]):N2EdgeSelectedProgramFeaturesRead{const programs=candidates.map(c=>({canonicalRaceKey:c.canonicalRaceKey,primaryRaceId:c.primaryRaceId,decisionCutoff:c.decisionCutoff,sourceObservedAt:c.sourceObservedAt,rawDocumentDigest:canonicalHash(c.primaryRaceId),programFeatures:safeProgram()}));return{readerVersion:"n2-edge-selected-program-features-v1",status:"PASS",blockers:[],requestedRaceCount:candidates.length,matchedProgramCount:candidates.length,parsedProgramCount:candidates.length,safeProgramCount:candidates.length,rawJsonReadCount:candidates.length,identityFieldCountPublished:0,liveOnlyFeatureValueCount:0,venueSpecificUnprovenFeatureValueCount:0,primaryDatabaseReadCount:1,primaryDatabaseWriteCount:0,networkRequestCount:0,programs,authority:{currentBuyConnectionAuthorized:false,lineConnectionAuthorized:false,publicPublishAuthorized:false,automatedBettingAuthorized:false,productionApplyAuthorized:false},outputDigest:canonicalHash(programs)};}
function context(root:string,status="PASS"):ExecutorContext{return{repoRoot:root,runId:"run-holdout-test",requestId:"REQ-holdout-test",taskId:"TASK-N2-041",sidecarPath:join(root,"data/research-replay.sqlite"),historyDir:join(root,"reports/automation/history"),reportsDir:join(root,"reports/n2"),dryRun:false,taskStatuses:{"TASK-N2-040":status}};}
function withRoot(fn:(root:string)=>void){const root=mkdtempSync(join(tmpdir(),"boat-pon-n2-041-"));try{fn(root);}finally{rmSync(root,{recursive:true,force:true});}}

test("no discovery signals short-circuits without holdout or raw-program reads",()=>withRoot(root=>{
 writeDiscovery(root,[]);let sourceCalls=0,selectedCalls=0;
 const executor=createN2EdgeHistoricalTestExecutor(()=>{sourceCalls++;return source();},input=>{selectedCalls++;return selected(input.selectedCandidates);});
 const result=executor(context(root));assert.equal(result.result,"PASS");assert.equal(sourceCalls,0);assert.equal(selectedCalls,0);
 const report=JSON.parse(readFileSync(join(root,"reports/n2/n2-edge-historical-test.json"),"utf8")) as Record<string,unknown>;
 assert.equal(report.noSignalShortCircuit,true);assert.equal(report.rawProgramReadCount,0);
}));

test("dependency blocks before discovery artifact/source reads",()=>withRoot(root=>{
 let sourceCalls=0;const executor=createN2EdgeHistoricalTestExecutor(()=>{sourceCalls++;return source();},input=>selected(input.selectedCandidates));
 const result=executor(context(root,"BLOCKED"));assert.equal(result.result,"BLOCKED");assert.equal(sourceCalls,0);assert.equal(existsSync(join(root,"reports/n2/n2-edge-historical-test.json")),false);
}));

test("stale discovery scan version blocks before holdout or raw-program reads",()=>withRoot(root=>{
 writeDiscovery(root,[lockedHypothesis()],"n2-edge-hypothesis-scan-v1");let sourceCalls=0,selectedCalls=0;
 const executor=createN2EdgeHistoricalTestExecutor(()=>{sourceCalls++;return source();},input=>{selectedCalls++;return selected(input.selectedCandidates);});
 const result=executor(context(root));assert.equal(result.result,"BLOCKED");assert.equal(sourceCalls,0);assert.equal(selectedCalls,0);
 assert.equal(existsSync(join(root,"reports/n2/n2-edge-historical-test.json")),false);
 assert.match(JSON.stringify(result.blocks),/DISCOVERY_SCAN_VERSION_MISMATCH:n2-edge-hypothesis-scan-v1\/n2-edge-hypothesis-scan-v2/u);
}));

test("locked hypothesis runs deterministic validation/test holdouts and persists aggregate-only evidence",()=>withRoot(root=>{
 writeDiscovery(root,[lockedHypothesis()]);const src=source();let selectedCalls=0;
 const executor=createN2EdgeHistoricalTestExecutor(()=>src,input=>{selectedCalls++;return selected(input.selectedCandidates);});
 const result=executor(context(root));assert.equal(result.result,"PASS");assert.equal(selectedCalls,1);
 const report=JSON.parse(readFileSync(join(root,"reports/n2/n2-edge-historical-test.json"),"utf8")) as Record<string,unknown>;
 const cohort=report.cohort as Record<string,unknown>;assert.equal(cohort.selectedValidationRaceCount,204);assert.equal(cohort.selectedTestRaceCount,204);
 const confirmation=report.confirmation as Record<string,unknown>;assert.equal(confirmation.status,"PASS");assert.equal(confirmation.validationRaceCount,204);assert.equal(confirmation.testRaceCount,204);
 const serialized=JSON.stringify(report);assert.doesNotMatch(serialized,/202[24]-\d{2}-\d{2}:\d{2}:R\d+/u);assert.doesNotMatch(serialized,/"(?:winningSelection|historicalOutcomes|candidates|programs|probabilityBySelection|rawJson)"\s*:/u);
 assert.match(String(report.outputDigest),/^[0-9a-f]{64}$/u);
}));
