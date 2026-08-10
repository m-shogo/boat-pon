// boat-pon task catalog + control-state model。
//
// 責務分離:
//   - task-catalog（main, immutable）: task の「定義」。taskId / taskType / executor /
//     safetyLevel / dependencies / defaultStatus / taskDefinitionVersion 等。ChatGPT の判断材料。
//   - queue-state（automation branch, mutable）: task の「状態」。status / attemptCount /
//     evidenceLinks / authoritySha / resultDigest 等。実行状態の正本はこちらだけ。
//
// main と automation branch で同じ可変 queue を二重管理しない。main は定義、branch は状態。
import { createHash } from "node:crypto";
import { TASK_STATUSES, type SafetyLevel, type TaskStatus } from "./researchOrchestrator";

export const CATALOG_SCHEMA_VERSION = "research-task-catalog-v1";
export const QUEUE_STATE_SCHEMA_VERSION = "research-queue-state-v1";

// executor 未実装の task を READY にしないための擬似状態（catalog 側 defaultStatus 用）。
export const DEFAULT_STATUSES = ["READY", "BLOCKED_EXECUTOR_PENDING", "BLOCKED_DEPENDENCY"] as const;
export type DefaultStatus = (typeof DEFAULT_STATUSES)[number];

export type TaskDefinition = {
  taskId: string;
  taskDefinitionVersion: number;
  title: string;
  objective: string;
  taskType: string;
  executor: string;
  safetyLevel: SafetyLevel;
  dependencies: string[];
  maxDurationSeconds: number;
  expectedInputs: string[];
  expectedOutputs: string[];
  estimatedDurationSeconds: number;
  defaultStatus: DefaultStatus;
  valueOfInformation: string;
  invalidationCondition: string;
  /** true の task は成功後に READY へ戻る（planner 等の恒久 task）。同一入力では no-op。 */
  recurring?: boolean;
};

export type TaskCatalog = {
  catalogSchemaVersion: string;
  catalogVersion: string;
  updatedAt: string;
  note?: string;
  tasks: TaskDefinition[];
};

export type TaskState = {
  status: TaskStatus;
  taskDefinitionVersion: number;
  authoritySha: string | null;
  attemptCount: number;
  maxAttempts: number;
  evidenceLinks: string[];
  resultDigest: string | null;
  lastFailure: { code: string; at: string; message?: string } | null;
  checkpoint: unknown | null;
  updatedAt: string;
  nextDecision?: string;
};

export type QueueState = {
  stateSchemaVersion: string;
  stateVersion: number;
  catalogVersion: string;
  updatedAt: string;
  tasks: Record<string, TaskState>;
};

// ---- catalog validation（strict, fail-closed）----
const TASKID_RE = /^TASK-[0-9A-Za-z._-]{1,64}$/;
const SAFETY = new Set(["L0", "L1", "L2", "L3", "L4"]);

export function validateCatalog(input: unknown): { valid: boolean; errors: string[]; catalog: TaskCatalog | null } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["catalog must be an object"], catalog: null };
  }
  const c = input as Record<string, unknown>;
  if (c.catalogSchemaVersion !== CATALOG_SCHEMA_VERSION) errors.push(`catalogSchemaVersion must be ${CATALOG_SCHEMA_VERSION}`);
  if (typeof c.catalogVersion !== "string" || c.catalogVersion.trim() === "") errors.push("invalid catalogVersion");
  if (!Array.isArray(c.tasks)) { errors.push("tasks must be an array"); return { valid: false, errors, catalog: null }; }
  const ids = new Set<string>();
  for (const [i, t0] of (c.tasks as unknown[]).entries()) {
    const t = t0 as Record<string, unknown>;
    const at = `tasks[${i}]`;
    if (typeof t.taskId !== "string" || !TASKID_RE.test(t.taskId)) errors.push(`${at}.taskId invalid`);
    else { if (ids.has(t.taskId)) errors.push(`${at}.taskId duplicate: ${t.taskId}`); ids.add(t.taskId); }
    if (!Number.isInteger(t.taskDefinitionVersion) || (t.taskDefinitionVersion as number) < 1) errors.push(`${at}.taskDefinitionVersion invalid`);
    for (const f of ["title", "objective", "taskType", "executor", "valueOfInformation", "invalidationCondition"]) {
      if (typeof t[f] !== "string" || (t[f] as string).trim() === "") errors.push(`${at}.${f} invalid`);
    }
    if (!SAFETY.has(t.safetyLevel as string)) errors.push(`${at}.safetyLevel invalid`);
    if (!Array.isArray(t.dependencies) || (t.dependencies as unknown[]).some((d) => typeof d !== "string")) errors.push(`${at}.dependencies invalid`);
    if (!Number.isInteger(t.maxDurationSeconds) || (t.maxDurationSeconds as number) < 60 || (t.maxDurationSeconds as number) > 21600) errors.push(`${at}.maxDurationSeconds invalid`);
    if (!Array.isArray(t.expectedInputs)) errors.push(`${at}.expectedInputs invalid`);
    if (!Array.isArray(t.expectedOutputs)) errors.push(`${at}.expectedOutputs invalid`);
    if (!Number.isInteger(t.estimatedDurationSeconds) || (t.estimatedDurationSeconds as number) < 0) errors.push(`${at}.estimatedDurationSeconds invalid`);
    if (!DEFAULT_STATUSES.includes(t.defaultStatus as DefaultStatus)) errors.push(`${at}.defaultStatus invalid`);
    if ("recurring" in t && typeof t.recurring !== "boolean") errors.push(`${at}.recurring must be boolean`);
  }
  // dependency 参照先が catalog に存在すること。
  for (const t of c.tasks as TaskDefinition[]) {
    for (const d of t.dependencies ?? []) if (!ids.has(d)) errors.push(`task ${t.taskId} depends on unknown ${d}`);
  }
  if (errors.length > 0) return { valid: false, errors, catalog: null };
  return { valid: true, errors: [], catalog: c as unknown as TaskCatalog };
}

export function validateQueueState(input: unknown): { valid: boolean; errors: string[]; state: QueueState | null } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["state must be an object"], state: null };
  }
  const s = input as Record<string, unknown>;
  if (s.stateSchemaVersion !== QUEUE_STATE_SCHEMA_VERSION) errors.push(`stateSchemaVersion must be ${QUEUE_STATE_SCHEMA_VERSION}`);
  if (!Number.isInteger(s.stateVersion) || (s.stateVersion as number) < 0) errors.push("invalid stateVersion");
  if (typeof s.catalogVersion !== "string") errors.push("invalid catalogVersion");
  if (typeof s.tasks !== "object" || s.tasks === null || Array.isArray(s.tasks)) { errors.push("tasks must be an object map"); return { valid: false, errors, state: null }; }
  for (const [id, v0] of Object.entries(s.tasks as Record<string, unknown>)) {
    if (!TASKID_RE.test(id)) errors.push(`state task id invalid: ${id}`);
    if (typeof v0 !== "object" || v0 === null || Array.isArray(v0)) {
      errors.push(`state ${id} must be an object`);
      continue;
    }
    const v = v0 as Record<string, unknown>;
    if (!TASK_STATUSES.includes(v.status as TaskStatus)) errors.push(`state ${id}.status invalid: ${v.status}`);
    if (!Number.isInteger(v.taskDefinitionVersion) || (v.taskDefinitionVersion as number) < 1) errors.push(`state ${id}.taskDefinitionVersion invalid`);
    if (!Number.isInteger(v.attemptCount) || (v.attemptCount as number) < 0) errors.push(`state ${id}.attemptCount invalid`);
    if (!Number.isInteger(v.maxAttempts) || (v.maxAttempts as number) < 1) errors.push(`state ${id}.maxAttempts invalid`);
    if (Number.isInteger(v.attemptCount) && Number.isInteger(v.maxAttempts) && (v.attemptCount as number) > (v.maxAttempts as number)) {
      errors.push(`state ${id}.attemptCount exceeds maxAttempts`);
    }
    if ("evidenceLinks" in v && (!Array.isArray(v.evidenceLinks) || (v.evidenceLinks as unknown[]).some((link) => typeof link !== "string"))) errors.push(`state ${id}.evidenceLinks invalid`);
  }
  if (errors.length > 0) return { valid: false, errors, state: null };
  return { valid: true, errors: [], state: s as unknown as QueueState };
}

// state 全体の deterministic digest（旧 queueDigest の後継）。key 順を固定して安定化する。
export function computeStateDigest(state: QueueState): string {
  const stable = {
    stateSchemaVersion: state.stateSchemaVersion,
    stateVersion: state.stateVersion,
    catalogVersion: state.catalogVersion,
    tasks: Object.fromEntries(
      Object.keys(state.tasks).sort().map((k) => {
        const t = state.tasks[k];
        return [k, { status: t.status, taskDefinitionVersion: t.taskDefinitionVersion, attemptCount: t.attemptCount, resultDigest: t.resultDigest ?? null }];
      }),
    ),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type MergedTask = TaskDefinition & {
  status: TaskStatus | "BLOCKED_EXECUTOR_PENDING" | "BLOCKED_DEPENDENCY";
  state: TaskState | null;
  staleDefinition: boolean;
};

// catalog（定義）と state（状態）を合成する。state に無い task は defaultStatus を状態とする。
// state.taskDefinitionVersion が catalog と一致しない場合は staleDefinition=true（revalidation 待ち）。
export function mergeCatalogAndState(catalog: TaskCatalog, state: QueueState): MergedTask[] {
  return catalog.tasks.map((def) => {
    const st = state.tasks[def.taskId] ?? null;
    const staleDefinition = st != null && st.taskDefinitionVersion !== def.taskDefinitionVersion;
    const status = st ? st.status : (def.defaultStatus as MergedTask["status"]);
    return { ...def, status, state: st, staleDefinition };
  });
}

// dispatch 可能な task: status=READY かつ全 dependency が PASS。
export function dispatchableTasks(merged: MergedTask[]): MergedTask[] {
  const byId = new Map(merged.map((t) => [t.taskId, t]));
  return merged.filter((t) =>
    t.status === "READY"
    && !t.staleDefinition
    && (t.dependencies ?? []).every((d) => byId.get(d)?.status === "PASS"));
}

// taskId（または NEXT）を解決する。NEXT は dispatchable のうち estimatedDuration 昇順で 1 件。
export function resolveTask(merged: MergedTask[], taskId: string): { task: MergedTask | null; reason: string } {
  if (taskId === "NEXT") {
    const cands = dispatchableTasks(merged).sort((a, b) => a.estimatedDurationSeconds - b.estimatedDurationSeconds);
    return cands.length ? { task: cands[0], reason: "NEXT resolved to earliest-dispatchable" } : { task: null, reason: "no dispatchable READY task" };
  }
  const t = merged.find((x) => x.taskId === taskId);
  if (!t) return { task: null, reason: `task not found in catalog: ${taskId}` };
  return { task: t, reason: "resolved by id" };
}

export const DEFAULT_MAX_ATTEMPTS = 3;

export type ReconcilePlan = {
  added: Array<{ taskId: string; status: string; taskDefinitionVersion: number }>;
  preserved: string[];
  staleDefinition: Array<{ taskId: string; stateDefinitionVersion: number; catalogDefinitionVersion: number }>;
  orphaned: string[];
  catalogVersionChanged: boolean;
};
export type ReconcileResult = { changed: boolean; plan: ReconcilePlan; nextState: QueueState };

// catalog（main, 正）と queue-state（automation branch）を reconcile する純関数。
// 決定的・冪等・fail-safe。既存 state entry は一切変更しない（PASS / attemptCount / evidence を保存）。
// - catalog に在り state に無い task → defaultStatus で追加
// - state に在り catalog に無い task → ORPHANED（残す・dispatch しない・削除しない）
// - taskDefinitionVersion が catalog と不一致 → staleDefinition 診断（自動で READY へ戻さない）
// - definition drift が1件でもあれば reconcile 自体を NO_CHANGE にして、別task追加やcatalogVersion更新も止める
// - 変更が無ければ changed=false（stateVersion を進めない・入力 state をそのまま返す = NO_CHANGE）
export function reconcileCatalogState(
  catalog: TaskCatalog, state: QueueState, opts: { now?: string; maxAttempts?: number } = {},
): ReconcileResult {
  const now = opts.now ?? new Date().toISOString();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const catalogById = new Map(catalog.tasks.map((t) => [t.taskId, t]));

  const added: ReconcilePlan["added"] = [];
  const preserved: string[] = [];
  const staleDefinition: ReconcilePlan["staleDefinition"] = [];
  const orphaned: string[] = [];

  // 既存 entry を verbatim 保存（順序も安定化のため id 昇順で再構築）。
  const nextTasks: Record<string, TaskState> = {};
  for (const id of Object.keys(state.tasks).sort()) {
    nextTasks[id] = { ...state.tasks[id] };
    const def = catalogById.get(id);
    if (!def) { orphaned.push(id); continue; }
    preserved.push(id);
    if (state.tasks[id].taskDefinitionVersion !== def.taskDefinitionVersion) {
      staleDefinition.push({ taskId: id, stateDefinitionVersion: state.tasks[id].taskDefinitionVersion, catalogDefinitionVersion: def.taskDefinitionVersion });
    }
  }
  // catalog 順（決定的）に、state に無い task を defaultStatus で追加。
  for (const def of catalog.tasks) {
    if (def.taskId in nextTasks) continue;
    nextTasks[def.taskId] = {
      status: def.defaultStatus as TaskStatus,
      taskDefinitionVersion: def.taskDefinitionVersion,
      authoritySha: null, attemptCount: 0, maxAttempts,
      evidenceLinks: [], resultDigest: null, lastFailure: null, checkpoint: null, updatedAt: now,
    };
    added.push({ taskId: def.taskId, status: def.defaultStatus, taskDefinitionVersion: def.taskDefinitionVersion });
  }

  const catalogVersionChanged = state.catalogVersion !== catalog.catalogVersion;
  const plan: ReconcilePlan = { added, preserved, staleDefinition, orphaned, catalogVersionChanged };
  if (staleDefinition.length > 0) return { changed: false, plan, nextState: state };

  const changed = added.length > 0 || catalogVersionChanged;
  if (!changed) return { changed: false, plan, nextState: state };
  const nextState: QueueState = {
    ...state, tasks: nextTasks, catalogVersion: catalog.catalogVersion,
    stateVersion: state.stateVersion + 1, updatedAt: now,
  };
  return { changed: true, plan, nextState };
}
