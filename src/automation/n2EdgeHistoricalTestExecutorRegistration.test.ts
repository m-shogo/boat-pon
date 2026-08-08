import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runN2EdgeHistoricalTestExecutor } from "./n2EdgeHistoricalTestExecutor";
import { isExecutorImplemented, resolveExecutor } from "./taskExecutors";

test("edge-historical-test implementation remains outside runtime registry",()=>{
 assert.equal(typeof runN2EdgeHistoricalTestExecutor,"function");
 assert.equal(isExecutorImplemented("edge-historical-test"),false);
 assert.equal(resolveExecutor("edge-historical-test").code,"EXECUTOR_NOT_REGISTERED");
});

test("TASK-N2-041 stays blocked until N2-040 actually passes",()=>{
 const catalog=JSON.parse(readFileSync(resolve(process.cwd(),"automation/task-catalog.json"),"utf8")) as {tasks?:Array<Record<string,unknown>>};
 const task=catalog.tasks?.find(t=>t.taskId==="TASK-N2-041"); assert.ok(task);
 assert.equal(task.taskType,"edge-historical-test"); assert.equal(task.executor,"edge-historical-test");
 assert.deepEqual(task.dependencies,["TASK-N2-040"]); assert.deepEqual(task.expectedOutputs,["reports/n2/n2-edge-historical-test.json"]);
 assert.equal(task.defaultStatus,"BLOCKED_EXECUTOR_PENDING");
});
