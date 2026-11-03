import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Schema-only ingestion must not grant PIT authority that the runtime rejects.
const schema=JSON.parse(readFileSync("config/research-governance/forward-evaluation-vault.schema.json","utf8"));
const instant=schema.$defs.exactInstant;
const known=RegExp(instant?.pattern??"","u");
const property=(kind:string,name:string)=>schema.allOf.find((entry:any)=>entry.if.properties.kind.const===kind).then.properties[name];

test("all five vault timestamp fields share the exact-offset schema boundary",()=>{
  assert.equal(schema.properties.createdAt.$ref,"#/$defs/exactInstant");
  assert.equal(property("ENROLLMENT_PROTOCOL","startAt").$ref,"#/$defs/exactInstant");
  assert.deepEqual(property("ENROLLMENT_PROTOCOL","endAt").anyOf,[{type:"null"},{$ref:"#/$defs/exactInstant"}]);
  assert.equal(property("MEMBERSHIP","enrolledAt").$ref,"#/$defs/exactInstant");
  assert.equal(property("ANALYSIS_SNAPSHOT","cutoffAt").$ref,"#/$defs/exactInstant");
  assert.equal(instant?.format,"date-time");
});
test("schema rejects unknown -00:00 UTC offset before point-in-time scoring",()=>{
  assert.equal(known.test("2026-10-14T12:00:00-00:00"),false);
  assert.equal(known.test("2026-10-14T12:00:00.123456-00:00"),false);
});
test("schema permits known offsets and nullable enrollment endAt",()=>{
  for(const timestamp of ["2026-10-14T12:00:00Z","2026-10-14T12:00:00+00:00","2026-10-14T21:00:00+09:00"]){
    assert.equal(known.test(timestamp),true);
  }
});
