// macOS の TMPDIR（/var/folders/...）は /private/var へのシンボリックリンク。
// 研究系のコードは「実パスと一致するか」を検査するので、そのままだと Mac 上のテストが数百件落ちる。
// テストの最初に TMPDIR を実パスへ揃える（Linux の CI では値が変わらない）。
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const current = tmpdir();
const real = realpathSync(current);
if (real !== current) process.env.TMPDIR = real;
