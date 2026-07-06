# Real Fable Implementation Plan

**本物のFable（F#/.NET/Feliz）導入はまだ禁止。** このドキュメントは、次に実際に
Fableを導入するかどうかを判断するためのチェックリストと、導入する場合の
最小手順・影響範囲・rollback方法をまとめたものです。

現状の `src/renderers/fable/` は **TypeScript stand-in PoC**（境界確認用の
TypeScriptによる代役実装）であり、本物のFableコンパイラではありません。
本ドキュメントの内容は「導入するとしたら」の計画であって、実行指示ではない。

関連ドキュメント:

- `docs/ai/06-FABLE-READINESS.md` — なぜ今すぐ使わないか、任せるべき/任せてはいけないこと
- `docs/ai/07-PRESENTATION-LAYER.md` — Presentation Layerのアーキテクチャ全体

## 現PoCの名前を明確化（TypeScript stand-in PoC）

`src/renderers/fable/fableOpportunityRenderer.ts` は **TypeScript stand-in PoC**
と呼ぶ。理由:

- F#/.NET/Fableコンパイラを一切使っていない、純粋なTypeScriptクラス
- 目的は「本物のFableを入れたときに同じ依存境界が成立するか」を先に
  TypeScriptだけで確認すること（依存境界・入力データの形はここで固まる）
- 本物のFableに置き換えるときも、この境界（`src/presentation/`以外
  非依存）とテスト方針（下記）はそのまま踏襲する

以後、両者を混同しないため、ドキュメント上では常に以下の呼び分けをする。

| 呼称 | 実体 |
|---|---|
| TypeScript stand-in PoC | `src/renderers/fable/`（現状、既存） |
| Real Fable Renderer | 本ドキュメントが計画する、F#/Fable/Felizによる実装（未着手） |

## 本物のFable導入時の候補構成

```text
boat-pon/
├─ src/
│  ├─ presentation/          # 既存。変更しない
│  ├─ renderers/
│  │  ├─ fable/               # 既存 TypeScript stand-in PoC（残す）
│  │  └─ fable-fsharp/        # 新規。Real Fable Renderer（候補パス）
│  │     ├─ FableRenderer.fsproj
│  │     ├─ OpportunityRenderer.fs
│  │     └─ Program.fs        # Fable出力のエントリポイント
│  └─ App.tsx                 # 既存React。当面変更しない
├─ package.json                # fable-compiler等をdevDependenciesに追加
└─ (dotnet SDK は npm 管理外。CIやローカル環境に別途必要)
```

候補パスは `src/renderers/fable-fsharp/`（TypeScript版と対で分かりやすい）。
迷った場合はこのパスを使う。

## F#/Fable/Felizを入れる場合の影響範囲

| 領域 | 影響 |
|---|---|
| `src/domain/` | **影響なし**（絶対に触らない） |
| `src/view-models/` | **影響なし** |
| `src/presentation/` | **影響なし**（型定義として参照されるのみ、変更しない） |
| `src/renderers/fable/`（TypeScript stand-in） | 残す。Real Fable Rendererができても削除しない（比較・rollback用） |
| `src/renderers/fable-fsharp/`（新規） | 追加のみ |
| `src/App.tsx` / `src/components/` | 当面変更なし。既存Reactは壊さない |
| `package.json` | devDependenciesに `fable-compiler`（またはnpmの`fable`パッケージ）追加 |
| `vite.config.ts` | Fableが出力したJS/ESモジュールを既存のVite設定でそのまま解決できるかを確認する必要あり（追加のViteプラグインが要るかは実際にビルドして確認） |
| ローカル/CI環境 | **.NET SDKが新規に必要**（npm/pnpmの管理外）。この環境（Claude Code実行環境）では
  .NET SDKのインストール自体が現時点で未確認。導入時は別途調査すること |

## npm/pnpm依存

- 追加候補: `fable-compiler`（npm経由でFableコンパイラを実行するラッパー）
- Fableコンパイラ自体はF#/.NETのツールであり、`dotnet tool install fable` で
  取得するのが本来の形。npm経由の `fable-compiler` パッケージはこれをラップしたもの
- **この環境ではpnpm installが403で完了しないため（`docs/ai/05-VERIFICATION.md`）、
  新規npm依存の追加自体が現状この環境では検証できない。** 通常pnpm環境での
  検証が導入の前提条件になる

## ビルド影響

- `pnpm build`（`typecheck && vite build`）に、Fableのビルドステップ
  （`dotnet fable` 実行 → JS生成）を追加する必要がある
- 案: `pnpm build` の前段に `fable:build` スクリプトを追加し、
  `"build": "npm run fable:build && npm run typecheck && vite build"` のように
  直列実行する（Fable出力がTypeScript側からimportされるため、typecheckより前に
  生成が終わっている必要がある）
- Fable出力先ディレクトリ（例: `src/renderers/fable-fsharp/dist/` や
  `.fable-build/`）は `.gitignore` に追加し、生成物をコミットしない
- 既存の `pnpm dev`（`concurrently` で `tsx watch` + `vite`）に、
  Fableの watch モード（`dotnet fable watch`）を第3プロセスとして追加するかは
  実装時に判断する

## Reactとの共存方針

- **置き換えではなく併存。** 既存React画面（`src/App.tsx`）はFable導入後も
  そのまま動き続ける
- Real Fable Rendererは、既存Reactコンポーネントの中に
  「Fableが生成した小さなコンポーネントを1つ埋め込む」形で導入する
  （例: Opportunity Cardの表示部分だけをFable製に差し替える）
- 画面全体をFableに置き換えることはしない（`docs/ai/06-FABLE-READINESS.md`の方針通り）
- Presentation Layer（`src/presentation/`）から見れば、ReactもFableも
  同じ `PresentationRenderer<T>` の実装の1つに過ぎない。どちらのrendererを
  使うかは呼び出し側（画面）が選ぶ

## Rollback方法

Fable導入は以下の手順で完全に取り消せる設計にする。

1. `src/renderers/fable-fsharp/` ディレクトリを削除する
2. `package.json` から `fable-compiler` 等のdevDependenciesを削除する
3. `package.json` の `build`/`dev` スクリプトからFableビルドステップを削除する
4. `vite.config.ts` に追加した設定（あれば）を削除する
5. Fable製コンポーネントを埋め込んだReact箇所を、埋め込み前の状態
   （TypeScript stand-in PoCまたは素のReact実装）に戻す

これらはすべて `src/domain` / `src/view-models` / `src/presentation` に
触れないため、ロールバックしても既存のROI/Rule Lifecycle/Research Engineの
挙動には一切影響しない。**rollbackが安全である根拠は、Presentation Layerの
責務分離（計算とrendererを分離する設計）そのもの。**

rollback判断基準（どれか1つでも該当したら即rollbackを検討）:

- `pnpm build` / `pnpm dev` がFable導入後に不安定になる
- .NET SDKのローカル/CI環境構築コストが見合わない
- Real Fable Rendererの実装速度が TypeScript stand-in PoC を明確に上回らない
- チームメンバーがF#に不慣れで保守コストが高いと判断される

## 最小PoC手順（本物のFableを試す最初の一歩）

本物のFableを試すと決めた場合、以下の順で最小規模から始める。

1. ローカル環境に.NET SDKをインストールし、`dotnet --version` が通ることを確認する
   （この環境=Claude Code実行環境でできるかは未確認。まず別環境で試す）
2. 空の `.fsproj` を1つ作り、`dotnet fable` で「Hello World」相当のJSが
   生成されることだけを確認する（Presentation Layerにはまだ触れない）
3. `OpportunityPresentation` 相当の型をF#のrecord型として1つだけ定義し、
   TypeScript stand-in PoC（`fableOpportunityRenderer.ts`）と全く同じ入力
   （`docs/ai/presentation.sample.json` の値）に対して、同じ出力形状
   （`scoreLabel`/`score`/`riskLevel`/`riskColor`/`summary`/`warningsCount`）
   が得られることを確認する
4. 生成されたJSをVite経由で読み込み、既存Reactコンポーネントの中に
   1つだけ埋め込んで表示確認する（画面全体は作らない）
5. ここまでで問題なければ、`docs/ai/06-FABLE-READINESS.md` の
   「将来Fableを使うならどの画面から試すべきか」の順に対象を広げる

## 次の本物Fable導入条件（すべて満たすまで着手しない）

- [ ] 通常pnpm環境で `pnpm typecheck` / `pnpm test` が正式合格している
      （`docs/ai/05-VERIFICATION.md` のPhase 3着手前提と同じ基準）
- [ ] Presentation JSON（`--presentation-json` / `docs/ai/presentation.sample.json`）が
      複数カード・複数CLI呼び出しを経て安定している
      （現状は単一カードのみで検証、`docs/ai/07-PRESENTATION-LAYER.md` 参照）
- [ ] Fableを導入する具体的な画面が1つ決まっている
      （「なんとなく」ではなく、対象コンポーネント名まで決める。
      最有力候補はOpportunity Card、次点はRule Lifecycle Timeline）
- [ ] 依存追加のrollback方針が確認されている（本ドキュメントの「Rollback方法」に
      実際に従える環境であること。.NET SDK未導入環境でも安全に元へ戻せるか確認する）
- [ ] Reactでの実装コストが具体的に問題になっている
      （`docs/ai/06-FABLE-READINESS.md` の既存条件、変更なし）

## 本物Fable導入時の最小スコープ

最初のReal Fable Rendererは、以下のスコープに厳密に限定する。

- **対象は `OpportunityPresentation` のみ。** Rule Card / Warning / Lifecycle /
  Research Summaryは対象外（TypeScript stand-in PoCと同じ制約）
- **`src/presentation` 以外のimport禁止。** F#側でもTypeScript側と同じ境界
  （domain / view-models / server / scripts を一切参照しない）を守る
- **ROI/DB/domain/scripts参照禁止。** 計算・判定・永続化には一切触れない
- **既存Reactは壊さない。** 既存の `src/App.tsx` / `src/components/` の
  動作・見た目に変更を加えない。Fable製コンポーネントは新規に追加するのみ

## テスト方針

Real Fable Renderer導入時に必須とするテスト4種類。TypeScript stand-in PoCの
`src/renderers/fable/fableOpportunityRenderer.test.ts` が既に前例を示している。

### 1. Dependency boundary test

Fable側のソース（F#ファイルまたはビルド後のJS）が `src/presentation` 以外
（domain/view-models/server/scripts）を参照していないことを機械的に確認する。
TypeScript stand-in PoCと同様、ソースを静的に読んでimport/openを検査する形を
基本とする。

### 2. Presentation JSON contract test

`docs/ai/presentation.sample.json`（または `--presentation-json` の実出力）を
Real Fable Rendererにそのまま渡し、`scoreLabel`/`score`/`riskLevel`/`summary`が
一切変更されずに描画結果へ反映されることを確認する。TypeScript stand-in PoCの
「scoreLabelは再計算されず入力の値がそのまま使われる」テストと同じ意図。

### 3. Renderer smoke test

Real Fable Rendererが実際にビルド・実行でき、クラッシュせずに描画結果
（またはDOM相当の出力）を返すことを確認する最小テスト。React側への
埋め込み後は、埋め込んだコンポーネントが画面に表示されることを目視確認する
（Manual smoke testの一種、`docs/ai/05-VERIFICATION.md` 参照）。

### 4. Rollback test

上記「Rollback方法」の手順を実際に実行し、rollback後に
`pnpm typecheck` / `pnpm test` / `pnpm build` が
Fable導入前と同じ結果で通ることを確認する。rollbackできることを
「文書に書いてあるだけ」で終わらせず、実際に1回試す。

## 完了条件（このドキュメントの使い方）

このドキュメントは「次にFableを導入するか」を判断する材料であり、
着手指示ではない。実際に着手する場合は、上記「次の本物Fable導入条件」を
すべて満たしたことを確認してから、`docs/ai/04-ROADMAP.md` に新しいPhaseとして
追記してから始めること。
