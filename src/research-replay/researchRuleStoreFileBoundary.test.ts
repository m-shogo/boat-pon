import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/manage-research-rules.ts", "utf8");

test("research rule store is identity-verified before parsing", () => {
  const identity = source.indexOf("RESEARCH_RULE_STORE_IDENTITY_INVALID");
  const read = source.indexOf("readFileSync(verifiedStorePath, \"utf8\")");

  assert.ok(identity >= 0, "rule store identity guard must exist");
  assert.ok(read > identity, "rule store must only be parsed after identity verification");
  assert.doesNotMatch(source, /readFileSync\(STORE_PATH/);
});

test("research rule evaluation input is identity-verified and missing diagnostics stay opaque", () => {
  const identity = source.indexOf("RESEARCH_RULE_EVALUATION_IDENTITY_INVALID");
  const read = source.indexOf("readFileSync(verifiedEvaluationPath, \"utf8\")");

  assert.ok(identity >= 0, "evaluation identity guard must exist");
  assert.ok(read > identity, "evaluation JSON must only be parsed after identity verification");
  assert.match(source, /console\.error\("evaluation file not found"\)/);
  assert.doesNotMatch(source, /evaluation file not found: \$\{evaluationFile\}/);
});

test("research rule store mutation lock encloses reload through durable publication", () => {
  const lockHelper = source.indexOf("function withStoreWriteLock");
  const lockCreate = source.indexOf('openSync(lockPath, "wx", 0o600)', lockHelper);
  const lockIdentity = source.indexOf("RESEARCH_RULE_STORE_LOCK_IDENTITY_INVALID", lockCreate);
  const lockParentHandoff = source.indexOf("RESEARCH_RULE_STORE_LOCK_PARENT_HANDOFF_IDENTITY_INVALID", lockIdentity);
  const lockHandoffIdentity = source.indexOf("RESEARCH_RULE_STORE_LOCK_HANDOFF_IDENTITY_INVALID", lockParentHandoff);
  const lockRemove = source.indexOf("unlinkSync(lockPath)", lockHandoffIdentity);

  assert.ok(lockHelper >= 0, "write mutations must have a dedicated lock helper");
  assert.ok(lockCreate > lockHelper, "mutation lock must be acquired exclusively");
  assert.ok(lockIdentity > lockCreate, "lock identity must be verified after acquisition");
  assert.ok(lockParentHandoff > lockIdentity, "lock parent must be revalidated before cleanup");
  assert.ok(lockHandoffIdentity > lockParentHandoff, "owned lock path must be revalidated before cleanup");
  assert.ok(lockRemove > lockHandoffIdentity, "lock must only be removed after handoff verification");

  const addStart = source.indexOf("function runAdd");
  const transitionStart = source.indexOf("function runTransition");
  const addLock = source.indexOf("withStoreWriteLock(() => {", addStart);
  const addReload = source.indexOf("const store = loadStore();", addLock);
  const addSave = source.indexOf("saveStore(store);", addReload);
  assert.ok(addLock > addStart && addLock < transitionStart, "real add must acquire the write lock");
  assert.ok(addReload > addLock && addReload < transitionStart, "real add must reload the store inside the lock");
  assert.ok(addSave > addReload && addSave < transitionStart, "real add must publish while the lock is held");

  const transitionLock = source.indexOf("withStoreWriteLock(() => {", transitionStart);
  const transitionReload = source.indexOf("const store = loadStore();", transitionLock);
  const transitionSave = source.indexOf("saveStore(store);", transitionReload);
  assert.ok(transitionLock > transitionStart, "real transition must acquire the write lock");
  assert.ok(transitionReload > transitionLock, "real transition must reload the store inside the lock");
  assert.ok(transitionSave > transitionReload, "real transition must publish while the lock is held");
});

test("research rule store publication uses exclusive fsynced temp plus atomic rename", () => {
  const parentIdentity = source.indexOf("RESEARCH_RULE_STORE_PARENT_IDENTITY_INVALID");
  const tempCreate = source.indexOf('openSync(tempPath, "wx", 0o600)');
  const fsync = source.indexOf("fsyncSync(fd)");
  const tempIdentity = source.indexOf("RESEARCH_RULE_STORE_TEMP_IDENTITY_INVALID");
  const destinationIdentity = source.lastIndexOf("RESEARCH_RULE_STORE_TARGET_IDENTITY_INVALID");
  const parentHandoff = source.indexOf("RESEARCH_RULE_STORE_PARENT_HANDOFF_IDENTITY_INVALID", destinationIdentity);
  const rename = source.indexOf("renameSync(tempPath, STORE_PATH)");

  assert.ok(parentIdentity >= 0, "canonical store parent must be verified before temp creation");
  assert.ok(tempCreate > parentIdentity, "publication must create its temp only after parent identity verification");
  assert.ok(fsync > tempCreate, "temp file must be fsynced after creation");
  assert.ok(tempIdentity > fsync, "temp identity must be verified after durable write");
  assert.ok(destinationIdentity > tempIdentity, "existing store destination must be revalidated after temp identity");
  assert.ok(parentHandoff > destinationIdentity, "parent identity must be revalidated after destination handoff");
  assert.ok(rename > parentHandoff, "publication must rename only after parent handoff revalidation");
  assert.doesNotMatch(source, /writeFileSync\(STORE_PATH/);
});