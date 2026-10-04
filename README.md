# finelistener
App that converts audio to txt

## Audio and speaker labels

Sessions default to Optimized audio. Original/Optimized is remembered per session and applies to playback and subsequent recognition/analysis; original recordings and existing transcripts are preserved. Transcribe saves recognition before local Community-1 speaker analysis. Speaker labels default on, with a remembered opt-out and optional exact system/file speaker count. Microphone-only sessions need no speaker model.

Plain Text contains speech only. Timecodes groups adjacent same-speaker/source fragments across gaps up to five seconds; expand a turn to edit original fragments. Search, copy and TXT export use the selected view. A failed or stopped analysis retains saved text and can be retried separately.

Community-1 runs in a private Python worker. Packaged builds download a pinned component on first use and reuse it offline after installation; size/status and cancellation are available in the UI. System Python and Hugging Face login are not required for inference. CUDA initialization failures retry once on CPU and remain visible.

## Preparing Community-1 release assets

Use Python 3.12 with pip to run scripts/prepare-community.py for win-x64-cpu, win-x64-gpu or mac-arm64 on the corresponding host. The script acquires hash-pinned private Python archives and wheels; model acquisition requires maintainer-approved gated access through HF_TOKEN or an already acquired --model-dir. Only pinned model files enter artifacts. The worker never receives acquisition credentials.

The build lock is scripts/community-assets.json. Build resources contain the component manifest; oversized runtime/model archives are release-associated downloads, split when needed. npm run measure:community:installer -- win-x64-cpu (or win-x64-gpu) produces matched Windows baseline/component installer measurements and enforces the 200000000-byte addition limit. scripts/verify-community-release.py validates components and all three platform manifests before release upload.

See [Community-1 acceptance](docs/testing/community-1-acceptance.md) for observed application checks, artifact sizes and unresolved clean-install, platform, listening and redistribution gates.

## TypeScript toolchain

Type checking and Electron compilation use TypeScript 7.0.2 through the
`@typescript/native` npm alias. The existing `tsc` commands in `npm run typecheck`
and `npm run build:electron` use this native compiler.

The `typescript` dependency aliases `@typescript/typescript6` for tools that still
need the JavaScript compiler API, including ts-node. This follows
the [TypeScript 7 migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
Keep both aliases: the compatibility package provides `tsc6`, so it does not
replace TypeScript 7's `tsc` command.

The scoped `application-loopback` override aligns its TypeScript peer dependency
with the compatibility package. Its distributed JavaScript does not load the
TypeScript compiler; its published peer range still requires TypeScript 5.

Run `npm run typecheck`, `npm run lint`, `npm run test -- --run`, and
`npm run build` to validate toolchain changes.

## Linting

`npm run lint` runs Oxlint with type-aware checks powered by `oxlint-tsgolint`.
Rules and exclusions are configured in `.oxlintrc.json`, including the migrated
TypeScript, React, React Hooks, and import checks. CI uses the same command.

`npm run lint:fix` applies available safe lint fixes. `npm run format` is an alias
for this command; it does not format whitespace or sort imports. The former
ESLint Stylistic rules are no longer enforced except for operator placement;
`import/order` is also not enforced. The unsupported
`react/jsx-no-leaked-render` rule and the nursery `react/require-render-return`
rule are also omitted. TypeScript checks cover the
removed strict-mode checks; JSX variable usage is covered by Oxlint's
unused-variable rule. React API deprecations are checked through
`typescript/no-deprecated`.

See the [Oxlint migration guide](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)
for rule compatibility details.

## Build miniaudio loopback helper (Windows)
This project uses a small helper binary for capturing system audio on Windows.

```
cmake -S miniaudio-loopback -B miniaudio-loopback/build
cmake --build miniaudio-loopback/build --config Release
```

The binary is written to `miniaudio-loopback/bin/`.
