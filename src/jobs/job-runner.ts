import type { DatabaseSync } from "node:sqlite";

const APP_NAME = "boat-pon";

export function hasSucceeded(db: DatabaseSync, jobName: string, targetDate: string): boolean {
  const row = db.prepare(
    "SELECT 1 FROM job_runs WHERE app_name=? AND job_name=? AND target_date=? AND status='success' LIMIT 1"
  ).get(APP_NAME, jobName, targetDate);
  return row != null;
}

export function getLastSuccessDate(db: DatabaseSync, jobName: string): string | null {
  const row = db.prepare(
    "SELECT target_date FROM job_runs WHERE app_name=? AND job_name=? AND status='success' ORDER BY target_date DESC LIMIT 1"
  ).get(APP_NAME, jobName) as { target_date: string } | undefined;
  return row?.target_date ?? null;
}

export function markRunning(db: DatabaseSync, jobName: string, targetDate: string): void {
  db.prepare(`
    INSERT INTO job_runs (app_name, job_name, target_date, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
    ON CONFLICT(app_name, job_name, target_date) DO UPDATE SET
      status='running', started_at=excluded.started_at, finished_at=NULL, error_message=NULL
  `).run(APP_NAME, jobName, targetDate, new Date().toISOString());
}

export function markSuccess(db: DatabaseSync, jobName: string, targetDate: string): void {
  db.prepare(`
    UPDATE job_runs SET status='success', finished_at=?
    WHERE app_name=? AND job_name=? AND target_date=?
  `).run(new Date().toISOString(), APP_NAME, jobName, targetDate);
}

export function markFailed(db: DatabaseSync, jobName: string, targetDate: string, error: string): void {
  db.prepare(`
    UPDATE job_runs SET status='failed', finished_at=?, error_message=?
    WHERE app_name=? AND job_name=? AND target_date=?
  `).run(new Date().toISOString(), error.slice(0, 1000), APP_NAME, jobName, targetDate);
}

export function markSkipped(db: DatabaseSync, jobName: string, targetDate: string): void {
  db.prepare(`
    INSERT INTO job_runs (app_name, job_name, target_date, status, started_at, finished_at)
    VALUES (?, ?, ?, 'skipped', ?, ?)
    ON CONFLICT(app_name, job_name, target_date) DO NOTHING
  `).run(APP_NAME, jobName, targetDate, new Date().toISOString(), new Date().toISOString());
}

export function recordMissing(db: DatabaseSync, jobName: string, targetDate: string, reason: string): void {
  db.prepare(`
    INSERT INTO missing_jobs (app_name, job_name, target_date, reason)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(app_name, job_name, target_date) DO NOTHING
  `).run(APP_NAME, jobName, targetDate, reason);
}

export type JobResult = { success: boolean; skipped?: boolean; message?: string };

export async function runJob(
  db: DatabaseSync,
  jobName: string,
  targetDate: string,
  fn: () => Promise<void>
): Promise<JobResult> {
  if (hasSucceeded(db, jobName, targetDate)) {
    markSkipped(db, jobName, targetDate);
    return { success: true, skipped: true };
  }
  markRunning(db, jobName, targetDate);
  try {
    await fn();
    markSuccess(db, jobName, targetDate);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markFailed(db, jobName, targetDate, msg);
    return { success: false, message: msg };
  }
}
