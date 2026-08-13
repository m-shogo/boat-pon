import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readN2EdgeHoldoutSource } from "./n2EdgeHoldoutSource";

function withDb(fn:(p:{primary:string;sidecar:string},d:{primary:DatabaseSync;sidecar:DatabaseSync})=>void){
 const root=mkdtempSync(join(tmpdir(),"n2-holdout-source-")); const pp=join(root,"p.sqlite"),sp=join(root,"s.sqlite");
 const p=new DatabaseSync(pp),s=new DatabaseSync(sp);
 p.exec(`CREATE TABLE official_programs(race_id TEXT PRIMARY KEY,date TEXT,venue TEXT,race_no INTEGER,close_at TEXT,source_file TEXT,raw_json TEXT,imported_at TEXT);`);
 s.exec(`CREATE TABLE settlement_candidates_v2(candidate_id TEXT PRIMARY KEY,canonical_race_key TEXT,bet_type TEXT,settlement_status TEXT,result_kind TEXT,resolution_status TEXT,observation_id TEXT,supersedes_candidate_id TEXT);
 CREATE TABLE race_payout_lines_v2(payout_line_id TEXT PRIMARY KEY,candidate_id TEXT,line_no INTEGER,bet_type TEXT,selection_canonical TEXT,payout_yen INTEGER,line_kind TEXT);
 CREATE TABLE settlement_source_duplicate_resolutions_v2(duplicate_observation_id TEXT);`);
 try{fn({primary:pp,sidecar:sp},{primary:p,sidecar:s});}finally{try{p.close()}catch{} try{s.close()}catch{} rmSync(root,{recursive:true,force:true});}
}
function winner(db:DatabaseSync,id:string,key:string,sel="1-2-3"){
 db.prepare(`INSERT INTO settlement_candidates_v2 VALUES (?,?, 'trifecta','settled','normal','resolved',?,NULL)`).run(id,key,`obs-${id}`);
 db.prepare(`INSERT INTO race_payout_lines_v2 VALUES (?,?,1,'trifecta',?,1000,'payout')`).run(`p-${id}`,id,sel);
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