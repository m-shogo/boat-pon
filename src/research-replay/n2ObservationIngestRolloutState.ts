import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { canonicalUtcTimestamp } from "./canonical";

const REQUIRED_COLUMNS = [
  "shadow_write_enabled",
  "operational_gc_enabled",
  "kill_switch_engaged",
  "occurred_at",
] as const;

export type N2ObservationIngestRolloutState = {
  shadowWriteEnabled: boolean;
  operationalGcEnabled: boolean;
  killSwitchEngaged: boolean;
};

type RolloutRow = {
  shadow_write_enabled: number;
  operational_gc_enabled: number;
  kill_switch_engaged: number;
  occurred_at: string;
};

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return new Set(
    (db.prepare(`PRAGMA table_info(${quoted})`).all() as unknown as Array<{ name: string }>).map((row) => row.name),
  );
}

function assertCanonicalTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("N2_READINESS_ROLLOUT_TIMESTAMP_INVALID");
  try {
    if (canonicalUtcTimestamp(value) !== value) throw new Error("N2_READINESS_ROLLOUT_TIMESTAMP_INVALID");
  } catch {
    throw new Error("N2_READINESS_ROLLOUT_TIMESTAMP_INVALID");
  }
}

function flag(value: number): boolean {
  if (value !== 0 && value !== 1) throw new Error("N2_READINESS_ROLLOUT_FLAG_INVALID");
  return value === 1;
}

export function readCanonicalRolloutState(sidecarDbPath: string): N2ObservationIngestRolloutState {
  const db = new DatabaseSync(`${pathToFileURL(sidecarDbPath).href}?immutable=1`, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000");
  try {
    if (!tableExists(db, "rollout_config_events")) {
      return {
        shadowWriteEnabled: false,
        operationalGcEnabled: false,
        killSwitchEngaged: false,
      };
    }
    const columns = tableColumns(db, "rollout_config_events");
    if (REQUIRED_COLUMNS.some((column) => !columns.has(column))) {
      throw new Error("N2_READINESS_ROLLOUT_SCHEMA_INVALID");
    }

    const timeline = db.prepare("SELECT occurred_at FROM rollout_config_events").all() as unknown as Array<{ occurred_at: unknown }>;
    for (const event of timeline) assertCanonicalTimestamp(event.occurred_at);

    const row = db.prepare(`
      SELECT shadow_write_enabled, operational_gc_enabled, kill_switch_engaged, occurred_at
      FROM rollout_config_events
      ORDER BY occurred_at DESC, rowid DESC
      LIMIT 1
    `).get() as unknown as RolloutRow | undefined;
    if (!row) {
      return {
        shadowWriteEnabled: false,
        operationalGcEnabled: false,
        killSwitchEngaged: false,
      };
    }
    assertCanonicalTimestamp(row.occurred_at);
    return {
      shadowWriteEnabled: flag(row.shadow_write_enabled),
      operationalGcEnabled: flag(row.operational_gc_enabled),
      killSwitchEngaged: flag(row.kill_switch_engaged),
    };
  } finally {
    db.close();
  }
}
