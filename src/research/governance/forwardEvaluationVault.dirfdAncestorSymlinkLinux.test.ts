import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Disposable research-only Linux namespace probe. O_NOFOLLOW constrains the
// final component of an open; it does not authenticate symlinked ancestors.
// This fixture neither publishes records nor modifies the SDK writer.
const pythonAncestorProbe = [
  "import errno, os, stat, sys",
  "root = sys.argv[1]",
  "flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW",
  "root_fd = os.open(root, flags)",
  "try:",
  "    unsafe_fd = os.open(os.path.join(root, 'alias', 'vault'), flags)",
  "    try:",
  "        target = os.stat(os.path.join(root, 'decoy', 'vault'), follow_symlinks=False)",
  "        opened = os.fstat(unsafe_fd)",
  "        assert stat.S_ISDIR(opened.st_mode)",
  "        assert (opened.st_dev, opened.st_ino) == (target.st_dev, target.st_ino)",
  "        print('UNSAFE_ANCESTOR_FOLLOWED', flush=True)",
  "    finally: os.close(unsafe_fd)",
  "    try:",
  "        alias_fd = os.open('alias', flags, dir_fd=root_fd)",
  "    except OSError as error:",
  "        if error.errno not in (errno.ELOOP, errno.ENOTDIR): raise",
  "        print('COMPONENT_SYMLINK_REJECTED', flush=True)",
  "    else:",
  "        os.close(alias_fd)",
  "        raise AssertionError('symlink ancestor unexpectedly accepted')",
  "    real_fd = os.open('real', flags, dir_fd=root_fd)",
  "    try:",
  "        vault_fd = os.open('vault', flags, dir_fd=real_fd)",
  "        try:",
  "            expected = os.stat(os.path.join(root, 'real', 'vault'), follow_symlinks=False)",
  "            observed = os.fstat(vault_fd)",
  "            assert (observed.st_dev, observed.st_ino) == (expected.st_dev, expected.st_ino)",
  "            print('REAL_COMPONENTS_ACCEPTED', flush=True)",
  "        finally: os.close(vault_fd)",
  "    finally: os.close(real_fd)",
  "finally: os.close(root_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

describe("Forward Vault dirfd ancestor-symlink admission (disposable Linux probe)", () => {
  it("shows final-component O_NOFOLLOW follows an ancestor symlink while component-wise dirfd traversal rejects it", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-ancestor-"));
    const decoy = join(root, "decoy", "vault");
    const trusted = join(root, "real", "vault");
    const content = '{"recordId":"synthetic-only","writer":"decoy"}\n';
    try {
      mkdirSync(decoy, { recursive: true });
      mkdirSync(trusted, { recursive: true });
      writeFileSync(join(decoy, "staged.json"), content, { flag: "wx" });
      symlinkSync(join(root, "decoy"), join(root, "alias"), "dir");

      const result = spawnSync("python3", ["-I", "-c", pythonAncestorProbe, root], {
        encoding: "utf8",
        timeout: 8_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout,
        "UNSAFE_ANCESTOR_FOLLOWED\nCOMPONENT_SYMLINK_REJECTED\nREAL_COMPONENTS_ACCEPTED\n");

      // Neither the unsafe observation nor the safe rejection publishes or
      // deletes any data; the synthetic decoy remains intact.
      assert.equal(readFileSync(join(decoy, "staged.json"), "utf8"), content);
      assert.equal(existsSync(join(decoy, "published.json")), false);
      assert.equal(existsSync(join(trusted, "published.json")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
