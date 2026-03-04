# Code Reviewer Memory

## Project Structure
- Feature packages: `renderer/src/features/<name>/` with `package.json` (`@~/<name>`), `lib/index.ts`, `src/ui/`
- Atoms: `renderer/src/atoms.ts` uses `AtomRegistry` class pattern with domain groups
- IPC: preload at `electron/preload.ts`, controllers in `electron/src/controllers/`, services in `electron/src/services/`
- Types: `electron/src/types/` for shared types (transcription, sessions, whisper, uiPreferences)

## Known Issues (Pre-existing)
- `AudioPreprocessor.ts:246-248`: Error messages in Russian (`normalizeFrequency` method) - violates English-only convention
- `preload.ts:25,35`: `any` types used for `convertAudio` args and `transcribeStream` opts

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
