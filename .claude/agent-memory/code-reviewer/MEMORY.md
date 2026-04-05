# Code Reviewer Memory

## Project Structure
- Feature packages: `renderer/src/features/<name>/` with `package.json` (`@~/<name>`), `lib/index.ts`, `src/ui/`
- Atoms: `renderer/src/atoms.ts` uses `AtomRegistry` class pattern with domain groups
- IPC: preload at `electron/preload.ts`, controllers in `electron/src/controllers/`, services in `electron/src/services/`
- Types: `electron/src/types/` for shared types (transcription, sessions, whisper, uiPreferences)
- Build config: `forge.config.js` with `BUILD_VARIANT` env var for platform-specific builds
- Build scripts: `scripts/build-whisper.sh`, `scripts/build-miniaudio.sh`, `scripts/prepare-models.sh`
- CI: `.github/workflows/release.yml` - builds mac-arm64, win-x64-gpu, win-x64-cpu

## Known Issues (Pre-existing)
- `AudioPreprocessor.ts:246-248`: Error messages in Russian (`normalizeFrequency` method) - violates English-only convention
- `preload.ts:25,35`: `any` types used for `convertAudio` args and `transcribeStream` opts
- `whisper.ts:97,151`: Russian JSDoc comments

## Conventions Confirmed
- Controllers validate IPC inputs with `typeof x !== 'string'` guards
- `deleteSession` has full path traversal protection (resolve + startsWith check)
- Write atoms use pattern: `atom(null, (get, set) => { ... })`
- Cleanup pattern for temp files: `cleanup().catch(() => void 0)` in finally blocks
- Session IDs are UUIDs from `randomUUID()`
- Component export style: `export const X: React.FC<Props> = ...` for most, but `TranscribeControl` uses non-default named export at bottom

## Patterns to Watch
- `set(atoms.clearTranscriptionOutput)` in Jotai store class - calling write atom with just `set(atom)` triggers it
- Duplicated "import audio as session" logic in FileSelect and TranscribedText - potential DRY violation
- `getSession`/`optimizeSessionAudio`/`saveTranscript` lack path traversal validation unlike `deleteSession`
- State machine phases: verify all phase values are actually entered via setState, not just defined and checked
- Ref-based callback pattern (handleStartRef) can capture stale React state -- watch for race conditions
- forge.config.js Electron fuses: `EnableCookieEncryption` should be `true` unless documented otherwise

## Build System (bundle-optimize branch)
- `build-assets/<variant>/whisper/` layout: flat binary + dylibs/dlls, no nested build/bin/
- `build-assets/models/` shared across variants, contains only ggml-base.bin and ggml-silero VAD
- Whisper path resolution: new `resources/whisper` candidate before `resources/whisper.cpp`
- Server binary resolution: flat `base/name` before `base/build/bin/name`
- Default model: backend='base' (whisper.ts), UI='large' (TranscribeControl) -- mismatch to fix
