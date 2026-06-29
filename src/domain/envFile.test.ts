import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFileContent } from "./envFile";

test("parses simple env values", () => {
  assert.deepEqual(parseEnvFileContent("A=1\nB=hello\n"), { A: "1", B: "hello" });
});

test("ignores comments and invalid keys", () => {
  assert.deepEqual(parseEnvFileContent("# comment\n1BAD=x\nGOOD=value # trailing\n"), { GOOD: "value" });
});

test("supports export prefix", () => {
  assert.deepEqual(parseEnvFileContent("export BOAT_PON_LINE_TO=U123\n"), { BOAT_PON_LINE_TO: "U123" });
});

test("keeps quoted hash and spaces", () => {
  assert.deepEqual(parseEnvFileContent('TOKEN="abc # def"\nNAME="Boat Pon"\n'), {
    TOKEN: "abc # def",
    NAME: "Boat Pon",
  });
});

test("unescapes double-quoted control characters", () => {
  assert.deepEqual(parseEnvFileContent('MESSAGE="a\\nb"\n'), { MESSAGE: "a\nb" });
});
