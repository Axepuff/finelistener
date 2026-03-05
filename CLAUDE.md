# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

FineListener is an Electron app that transcribes audio files and system recordings to text using a local whisper.cpp server.

## Commands

```bash
npm run dev           # Start both renderer (Vite) and Electron in development mode
npm run dev:renderer  # Start only the Vite dev server
npm run dev:electron  # Start only the Electron process
npm run build         # Build renderer + compile Electron TypeScript
npm run typecheck     # TypeScript type checking (run after changes)
npm run lint          # ESLint
npm run format        # ESLint with auto-fix
npm run test          # Run tests with vitest (covers electron/src/**/*.test.ts)
npm run make:mac      # Build macOS installer (arm64)
npm run make:win64    # Build Windows installer (x64)
```

## Architecture

The app follows the standard Electron three-context model:

**Main process** (`electron/src/`)
- `controllers/ipc.ts` — entry point that registers all IPC handlers; each controller covers a domain (transcription, recording, sessions, file, whisper models, UI preferences, debug)
- `services/` — business logic: `TranscriptionService` (whisper.cpp server wrapper), `RecordingService` (system audio capture), `SessionsService` (persisted session storage), `WhisperModelService`, `AudioPreprocessor`, `Loudnorm`
- Controllers are thin: they handle IPC routing and delegate to services

**Preload** (`electron/preload.ts`)
- Exposes `window.api` to the renderer via `contextBridge`
- All renderer↔main communication goes through this typed bridge
- IPC listeners return cleanup functions (remove the listener on return)

**Renderer** (`renderer/src/`)
- `Home.tsx` — root layout: Player + resizable sidebar (FileSelect + TranscribeControl on the left, SessionsSidebar on the right) + TranscribedText content area + ProcessLog footer
- `atoms.ts` — central Jotai state via `AtomRegistry` class grouping atoms by domain (`transcription`, `appState`, `player`, `sessions`). `transcriptionWorkflow` is a derived atom computing the UI workflow state. Import as `atoms.transcription.xyz`.
- Features are **npm workspace packages** under `renderer/src/features/` and imported with the `@~/` alias (e.g. `@~/player`, `@~/sessions`, `@~/transcribe-control`). Each feature exposes a `lib/index.ts`.

**whisper.cpp** (`whisper.cpp/`, `electron/src/services/whisperServer/`)
- Built as a local HTTP server; `TranscriptionService` starts/stops it and sends requests to it
- Models are stored in `whisper.cpp/models/`

**State flow for transcription:**
1. User picks audio → `atoms.transcription.audioToTranscribe` set
2. TranscribeControl invokes `window.api.transcribeStream` → IPC → `TranscriptionService`
3. Progress pushed via `transcribe:progress` IPC events → `atoms.transcription.plainText / renderedText`
4. `uiState` transitions: `initial` → `transcribing` → `ready`

## Key Conventions

See `AGENTS.md` for detailed coding rules. The critical ones:

- All user-visible text must be in **English**
- React components: `export const MyComponent: React.FC<Props> = ...` (no class components)
- Use `interface` for object shapes, `type` for unions/aliases
- Atoms go in `atoms.ts` or feature-local state modules; use the `AtomRegistry` class pattern
- Never call Node API or `ipcRenderer` directly from renderer components — always use `window.api`
- New IPC channels: add to preload, type the payload, register a controller handler
- After changes: run `npm run typecheck` and `npm run lint` and fix all errors
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`, etc.)
