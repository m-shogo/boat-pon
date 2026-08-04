# ADR-0003: Clean-room Challenger

- status: accepted
- date: 2026-08-05

## 決定
一部の Strategy Family を `knowledgePolicy = CLEAN_ROOM` として隔離し、他方式の成功知識に触れさせない独立検証者とする。

- clean-room が共有可能: `GLOBAL_FACT` / `RESEARCH_METHOD` / SAFETY_FINDING / corrected settlement / data contract / common evaluation protocol。
- clean-room が **共有禁止**: 他方式の成功 feature / threshold / weight / interaction / ticket selector / SKIP rule /
  `REUSABLE_CANDIDATE` / feature importance / 成功 race 一覧。

## 強制
- `cleanRoomPolicy.allowedShareClasses` は GLOBAL_FACT / RESEARCH_METHOD のみ許可（それ以外を含むと validator が reject）。
- CI が clean-room family の非共有 Discovery 採用を検出して fail（`detectCleanRoomViolations`）。

## 影響
過学習・知識汚染に対する独立した対照が常に存在する。
