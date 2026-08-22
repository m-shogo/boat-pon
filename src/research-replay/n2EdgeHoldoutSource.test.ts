import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash } from "./canonical";
import {
  SOURCE_DUPLICATE_POLICY_VERSION,
  SOURCE_DUPLICATE_RESOLVER_VERSION,
  archiveFileForRaceKey,
} from "./n1CanonicalResolution";
import { N1_CANONICAL_RESOLUTION_SCHEMA_VERSION } from "./settlement";
import { readN2EdgeHoldoutSource } from "./n2EdgeHoldoutSource";

const DETECTION_REASON =
  "intra_file_source_duplicate: same raw document produced multiple identical race observations";

function withDb(fn:(p:{primary:string;sidecar:string},d:{primary:DatabaseSync;sidecar:DatabaseSync})=>void){
 const root=mkdtempSync(join(tmpdir(),"n2-holdout-source-")); const pp=join(root,"p.sqlite"),sp=join(root,"s.sqlite");
 const p=new DatabaseSync(pp),s=new DatabaseSync(sp);
 p.exec(`CREATE TABLE official_programs(race_id TEXT PRIMARY KEY,date TEXT,venue TEXT,race_no INTEGER,close_at TEXT,source_file TEXT,raw_json TEXT,imported_at TEXT);`);
 s.exec(`CREATE TABLE parse_runs(parse_run_id TEXT PRIMARY KEY,raw_document_id TEXT NOT NULL,status TEXT NOT NULL);
 CREATE TABLE domain_observations(observation_id TEXT PRIMARY KEY,canonical_race_key TEXT NOT NULL,observation_type TEXT NOT NULL,payload_type TEXT NOT NULL,raw_document_id TEXT NOT NULL,parse_run_id TEXT NOT NULL,supersedes_id TEXT,correction_kind TEXT,correction_reason TEXT);
 CREATE TABLE settlement_candidates_v2(candidate_id TEXT PRIMARY KEY,canonical_race_key TEXT,bet_type TEXT,settlement_status TEXT,result_kind TEXT,revision_kind TEXT,resolution_status TEXT,observation_id TEXT,parse_run_id TEXT,raw_document_id TEXT,semantic_hash TEXT,supersedes_candidate_id TEXT,correction_reason TEXT);
 CREATE TABLE race_payout_lines_v2(payout_line_id TEXT PRIMARY KEY,candidate_id TEXT,line_no INTEGER,bet_type TEXT,selection_canonical TEXT,payout_yen INTEGER,line_kind TEXT);
 CREATE TABLE settlement_source_duplicate_resolutions_v2(resolution_id TEXT PRIMARY KEY,duplicate_observation_id TEXT NOT NULL,canonical_observation_id TEXT NOT NULL,canonical_race_key TEXT NOT NULL,raw_document_id TEXT NOT NULL,source_archive_file TEXT NOT NULL,resolution_kind TEXT NOT NULL,detection_reason TEXT NOT NULL,duplicate_semantic_digest TEXT NOT NULL,resolver_version TEXT NOT NULL,policy_version TEXT NOT NULL,schema_version TEXT NOT NULL);`);
 try{fn({primary:pp,sidecar:sp},{primary:p,sidecar:s});}finally{try{p.close()}catch{} try{s.close()}catch{} rmSync(root,{recursive:true,force:true});}
}
function winner(db:DatabaseSync,id:string,key:string,sel="1-2-3",options:{rawDocumentId?:string;parseRunId?:string;semanticHash?:string}={}){
 const rawDocumentId=options.rawDocumentId??`raw-${id}`; const parseRunId=options.parseRunId??`parse-${id}`; const semanticHash=options.semanticHash??`semantic-${id}`;
 db.prepare("INSERT OR IGNORE INTO parse_runs VALUES (?,?,'success')").run(parseRunId,rawDocumentId);
 db.prepare(`INSERT INTO domain_observations VALUES (?,?,'settlement_result','settlement_result',?,?,NULL,NULL,NULL)`).run(`obs-${id}`,key,rawDocumentId,parseRunId);
 db.prepare(`INSERT INTO settlement_candidates_v2 VALUES (?,?, 'trifecta','settled','normal','initial','resolved',?,?,?,?,NULL,NULL)`).run(id,key,`obs-${id}`,parseRunId,rawDocumentId,semanticHash);
 db.prepare(`INSERT INTO race_payout_lines_v2 VALUES (?,?,1,'trifecta',?,1000,'payout')`).run(`p-${id}`,id,sel);
}
function sourceDuplicateResolution(db:DatabaseSync,duplicateId:string,canonicalId:string,key:string,rawDocumentId:string,semanticHash:string){
 db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (?,?,?,?,?,?,'source_duplicate',?,?,?,?,?)`).run(
  `resolution-${duplicateId}`,`obs-${duplicateId}`,`obs-${canonicalId}`,key,rawDocumentId,archiveFileForRaceKey(key),DETECTION_REASON,
  canonicalHash([["trifecta",semanticHash]]),SOURCE_DUPLICATE_RESOLVER_VERSION,SOURCE_DUPLICATE_POLICY_VERSION,N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
 );
}
function program(db:DatabaseSync,id:string,date:string,venue:string,raceNo:number,importedAt=`${date} 01:00:00`){
 db.prepare(`INSERT INTO official_programs VALUES (?,?,?,?,?,'x','BAD_UNREAD_RAW',?)`).run(id,date,venue,raceNo,"23:00",importedAt);
}

test("holdout source returns validation/test candidates plus prior rolling history without raw reads",()=>withDb((paths,dbs)=>{
 winner(dbs.sidecar,"warm","2021-07-05:11:R1");
 winner(dbs.sidecar,"v","2022-01-01:11:R1"); winner(dbs.sidecar,"t","2024-01-01:11:R1","2-1-3");
 program(dbs.primary,"20220101-びわこ-01","2022-01-01","びわこ",1);
 program(dbs.primary,"20240101-11-01","2024-01-01","11",1);
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"PASS"); assert.equal(r.historicalOutcomeCount,3); assert.equal(r.candidateRaceCount,2);
 assert.deepEqual(r.candidates.map(x=>x.canonicalRaceKey),["2022-01-01:11:R1","2024-01-01:11:R1"]);
 assert.equal(r.reads.rawJsonReadCount,0); assert.equal(r.reads.primaryDatabaseWriteCount,0); assert.equal(r.reads.sidecarDatabaseWriteCount,0);
}));

test("current source-duplicate evidence removes only the duplicate holdout observation",()=>withDb((paths,dbs)=>{
 const key="2022-01-01:11:R1",rawDocumentId="raw-shared",parseRunId="parse-shared",semanticHash="semantic-shared";
 winner(dbs.sidecar,"canonical",key,"1-2-3",{rawDocumentId,parseRunId,semanticHash});
 winner(dbs.sidecar,"duplicate",key,"1-2-3",{rawDocumentId,parseRunId,semanticHash});
 sourceDuplicateResolution(dbs.sidecar,"duplicate","canonical",key,rawDocumentId,semanticHash);
 program(dbs.primary,"20220101-びわこ-01","2022-01-01","びわこ",1);
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"PASS"); assert.equal(r.historicalOutcomeCount,1); assert.equal(r.candidateRaceCount,1);
}));

test("settlement lineage drift blocks holdout ingestion before primary reads",()=>withDb((paths,dbs)=>{
 const key="2022-01-01:11:R1"; winner(dbs.sidecar,"v",key);
 dbs.sidecar.prepare("UPDATE domain_observations SET canonical_race_key=? WHERE observation_id=?")
  .run("2022-01-01:11:R2","obs-v");
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"BLOCKED"); assert.ok(r.blockers.includes(`${key}:SETTLEMENT_LINEAGE_INVALID`));
 assert.equal(r.reads.primaryDatabaseReadCount,0); assert.equal(r.candidateRaceCount,0);
}));

test("stale source-duplicate evidence blocks holdout ingestion before primary reads",()=>withDb((paths,dbs)=>{
 const key="2022-01-01:11:R1"; winner(dbs.sidecar,"v",key);
 dbs.sidecar.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES ('stale','obs-v','missing-observation',?,'raw-v',?,'source_duplicate',?,'deadbeef',?,?,?)`).run(
  key,archiveFileForRaceKey(key),DETECTION_REASON,SOURCE_DUPLICATE_RESOLVER_VERSION,SOURCE_DUPLICATE_POLICY_VERSION,N1_CANONICAL_RESOLUTION_SCHEMA_VERSION,
 );
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"BLOCKED"); assert.ok(r.blockers.includes("SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"));
 assert.equal(r.reads.primaryDatabaseReadCount,0); assert.equal(r.candidateRaceCount,0);
}));

test("impossible historical holdout race dates fail closed",()=>withDb((paths,dbs)=>{
 winner(dbs.sidecar,"bad","2024-02-30:11:R1");
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"BLOCKED");
 assert.ok(r.blockers.includes("2024-02-30:11:R1:RACE_KEY_INVALID"));
 assert.equal(r.candidateRaceCount,0);
 assert.equal(r.reads.rawJsonReadCount,0);
}));

test("post-cutoff program is excluded and counted",()=>withDb((paths,dbs)=>{
 winner(dbs.sidecar,"v","2022-01-01:11:R1");
 program(dbs.primary,"20220101-びわこ-01","2022-01-01","びわこ",1,"2022-01-01 15:00:00");
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"PASS"); assert.equal(r.candidateRaceCount,0); assert.equal(r.excludedProgramReasonCounts.POST_CUTOFF_PRIMARY_IMPORT,1);
}));

test("forward programs are never queried into the holdout metadata range",()=>withDb((paths,dbs)=>{
 winner(dbs.sidecar,"f","2026-01-01:11:R1"); program(dbs.primary,"20260101-びわこ-01","2026-01-01","びわこ",1);
 dbs.primary.close();dbs.sidecar.close();
 const r=readN2EdgeHoldoutSource({primaryDbPath:paths.primary,sidecarDbPath:paths.sidecar});
 assert.equal(r.status,"PASS"); assert.equal(r.officialProgramMetadataCount,0); assert.equal(r.candidateRaceCount,0);
}));