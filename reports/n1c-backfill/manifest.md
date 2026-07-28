# Archive manifest (start-of-run固定)

- file count: **8168** (baseline 8,164 + delta 4)
- total bytes: 295456988
- manifest SHA-256: `c44bfb6fdda7728ee2bdc58d48d9378a48617d6ce95b61a84c15a8c2e934c1a1`
- range: k000101.lzh .. k260726.lzh
- files beyond baseline (k260722): k260723.lzh, k260724.lzh, k260725.lzh, k260726.lzh
- 差分理由: daily official K archive grew by the normal daily pipeline after the 2026-07-24 (k260722) snapshot; the extra files are standard daily result archives (not auxiliary/sanitized fixtures, not duplicate paths, not redefinition of target set)
