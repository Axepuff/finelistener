# finelistener
App that converts audio to txt

## Audio and speaker labels

Sessions default to Optimized audio. Original/Optimized is remembered per session and applies to playback and subsequent recognition/analysis; original recordings and existing transcripts are preserved. Transcribe saves Whisper recognition before local speaker analysis. Speaker labels default on, with a remembered opt-out. Microphone-only sessions use a fixed identity without downloading or running a speaker model.

Plain Text contains speech only. Timecodes groups adjacent same-speaker/source fragments across gaps up to five seconds; expand a turn to edit original fragments. Search, copy and TXT export use the selected view. A failed or stopped analysis retains saved text and can be retried separately.

All builds use **Nemotron 3 Diarization Q8 with NeMo-Speech.cpp 0.3.0**. Speaker count is automatic.

| Build | Speaker analysis devices |
| --- | --- |
| Windows x64 CPU | CPU; no graphics card required |
| Windows x64 GPU | Vulkan GPU or CPU |
| macOS Apple Silicon (arm64) | Metal GPU or CPU |

The remembered **Speaker analysis device** setting applies to automatic analysis and standalone retry. Auto selects an available GPU before inference, otherwise CPU. CPU forces CPU even on a GPU-capable computer; GPU requires a compatible device. An inference failure preserves the saved transcript and existing labels. A failed GPU run is not silently retried on CPU: select CPU and retry explicitly.

Packaged builds download a pinned component on first use and reuse it offline after verification; size, preparation, progress and cancellation are available in the UI. System Python, CUDA Toolkit and Hugging Face login are not required for speaker inference. Native overlapping intervals remain acoustic evidence; ambiguous text retains Unknown. The sherpa and Community runtimes, workers and build dependencies have been removed. Their saved results remain readable without reanalysis or deleting user data.

## Preparing speaker release assets

Each `prebuild:assets:*` command runs `python scripts/prepare-nemotron.py <win-x64-cpu|win-x64-gpu|mac-arm64>`. The lock is `scripts/nemotron-assets.json`. Python 3.12 and its standard library are sufficient for acquisition; no gated credentials, pip packages or Python runtime are shipped. Windows preparation enables UTF-8 paths in the executable manifest (Windows 10 1903 or later) and records the modification. macOS preparation preserves executable permissions and copies the upstream dylib aliases as regular files. Runtime libraries stay isolated from Whisper.

Build resources contain manifests and notices; runtime/model ZIPs are release-associated downloads (about 110 MB CPU, 124 MB Vulkan, 117 MB Metal). `npm run measure:speaker:installer -- win-x64-gpu` (or `win-x64-cpu`) produces matched Windows baseline/component installer measurements and enforces the 200000000-byte addition limit. `scripts/verify-speaker-release.py` validates all three platform manifests and every archive member before upload. The Nemotron components PR workflow prepares each platform and runs `scripts/smoke-nemotron.py` against the extracted archive on its target OS. The smoke check uses only three seconds of generated audio on CPU and, when available, GPU; it is not a performance benchmark.

See [Nemotron acceptance](docs/testing/nemotron-acceptance.md), [ADR 0008](docs/adr/0008-nemotron-vulkan-speaker-analysis.md), and the historical [Community-1 acceptance](docs/testing/community-1-acceptance.md) for evidence and release checks.

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

## Storybook

Run `npm run storybook` and open [Storybook](http://127.0.0.1:6006). It binds to loopback only and uses the renderer's Mantine theme. The workspace and recorder stories use real components and isolated AppStore instances with demo services, so recording, importing, recognition, and preferences stay inside the story. Playback uses the real WaveSurfer adapter with a generated 12-second WAV tone sequence; transcript text is illustrative.

Use the workspace stories to discuss empty, audio-ready, transcript, long-transcript, processing, and error states. Recorder stories cover ready, recording, and device failure. Add scenarios for UI changes here instead of maintaining a separate mock UI.

The official Storybook MCP addon serves `http://127.0.0.1:6006/mcp` while the development server runs. Project-scoped Codex configuration is in `.codex/config.toml`; load this trusted project in a fresh Codex session after changing that configuration. The server provides component documentation, story preview links, and story tests. Browser control is a separate capability.

Run `npm run test:storybook -- --run` for rendered stories and interaction checks, and `npm run build-storybook` for a static build. The browser tests use installed Microsoft Edge on Windows; on other platforms run `npx playwright install chromium` once. Set `STORYBOOK_BROWSER_CHANNEL` to override the browser channel. Existing Node tests remain under `npm run test -- --run`. Automated story clicks cannot grant browser audio permission; verify Play/Pause with a real click in the preview.

## Build miniaudio loopback helper (Windows)
This project uses a small helper binary for capturing system audio on Windows.

```
cmake -S miniaudio-loopback -B miniaudio-loopback/build
cmake --build miniaudio-loopback/build --config Release
```

The binary is written to `miniaudio-loopback/bin/`.
