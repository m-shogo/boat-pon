import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type LockOwner = Record<string, unknown>;

export function acquireSingleFlightLock(input: {
  lockPath: string;
  staleAfterSeconds: number;
  owner: LockOwner;
  nowIso: () => string;
  nowMs?: () => number;
}): boolean {
  const nowMs = input.nowMs ?? (() => Date.now());
  mkdirSync(dirname(input.lockPath), { recursive: true });

  try {
    const current = JSON.parse(readFileSync(input.lockPath, "utf8"));
    const heartbeat = current.heartbeatAt ?? current.acquiredAt;
    const ageSeconds = (nowMs() - Date.parse(heartbeat)) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds < input.staleAfterSeconds) return false;
    writeFileSync(`${input.lockPath}.stale-${nowMs()}.json`, JSON.stringify(current, null, 2));
    rmSync(input.lockPath, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      // Preserve legacy behavior: malformed/unreadable lock content is treated as stale.
      rmSync(input.lockPath, { force: true });
    }
  }

  let fd: number | null = null;
  try {
    fd = openSync(input.lockPath, "wx", 0o600);
    const acquiredAt = input.nowIso();
    writeFileSync(fd, `${JSON.stringify({ ...input.owner, acquiredAt, heartbeatAt: acquiredAt }, null, 2)}\n`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
