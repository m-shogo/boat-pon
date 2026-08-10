import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dispatch intent schema binds plan-next and L3 safety", () => {
  const schema = JSON.parse(readFileSync("config/research-dispatch-intent.schema.json", "utf8"));
  const conditions = schema.allOf ?? [];

  assert.ok(conditions.some((rule: any) =>
    rule?.if?.properties?.requestedAction?.const === "plan-next"
    && rule?.then?.properties?.taskId?.const === "NEXT"));
  assert.ok(conditions.some((rule: any) =>
    rule?.if?.properties?.safetyLevel?.const === "L3"
    && Array.isArray(rule?.then?.required)
    && rule.then.required.includes("approvalGrantId")));
});
