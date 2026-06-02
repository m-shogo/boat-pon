import type { DatabaseSync } from "node:sqlite";

export function acquireLock(db: DatabaseSync, jobKey: string): boolean {
  try {
    db.prepare("INSERT INTO job_locks (job_key, locked_at) VALUES (?, ?)").run(jobKey, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(db: DatabaseSync, jobKey: string): void {
  db.prepare("DELETE FROM job_locks WHERE job_key=?").run(jobKey);
}

export function clearStaleLock(db: DatabaseSync, jobKey: string, maxAgeMs = 6 * 60 * 60 * 1000): boolean {
  const row = db.prepare("SELECT locked_at FROM job_locks WHERE job_key=?").get(jobKey) as { locked_at: string } | undefined;
  if (!row) return false;
  const age = Date.now() - new Date(row.locked_at).getTime();
  if (age > maxAgeMs) {
    db.prepare("DELETE FROM job_locks WHERE job_key=?").run(jobKey);
    console.log(`[lock] stale lock cleared: ${jobKey} (age=${Math.round(age / 60000)}m)`);
    return true;
  }
  return false;
}
