# Renderer state

Start with [AppStore](appStore.ts) for a workflow that changes several stores. For a change within one responsibility, use its owner below. React receives one stable AppStore through [AppContext](../AppContext.ts); observable consumers use `observer`.

| Responsibility | Owner | Change here when… |
| --- | --- | --- |
| Composition and cross-store commands | [AppStore](appStore.ts) | Opening/importing/deleting a session, switching audio, starting/stopping transcription, or clearing the workspace |
| Session list | [SessionsStore](sessionsStore.ts) | Loading the sidebar, refreshing metadata, handling list errors or stale responses |
| Active audio, segment and playback | [WorkspaceStore](workspaceStore.ts) | Selecting a segment, switching audio paths, resetting or seeking playback |
| Transcription execution and output | [TranscriptionStore](transcriptionStore.ts) | Processing streaming events, stopping a run, managing draft/saved output or progress |
| Models | [WhisperModelStore](whisperModelStore.ts) | Listing/downloading models or importing a local model |
| Transcription settings and preparation | [TranscriptionControlStore](../features/transcribe-control/src/model/transcriptionControlStore.ts) | Editing settings, confirming a missing model download, or cancelling the pending start |
| Foreground ownership | [ForegroundOperationStore](foregroundOperationStore.ts) | Coordinating mutually exclusive workspace operations |
| Activity log | [ActivityLogStore](activityLogStore.ts) | Appending user-visible events or process output |

## Interfaces and ownership

Commands mutate state; getters expose readonly data. AppStore coordinates transitions that affect multiple owners. Child stores receive the typed [RendererAdapter](rendererAdapter.ts) or specific callbacks, not the root store. Components perform system work through store commands.

The session list is persisted metadata, separate from the active workspace. Transcription owns the current saved transcript and its draft. Starting another run clears the draft while preserving saved output; success replaces saved output atomically. Failure or stop retains the draft. Replacing or clearing the workspace discards both previous outputs.

Only one foreground operation owns the workspace. Playback is independent. The operation token protects cross-store transitions; transcription run identity protects streaming and completion; the session-list request identity protects refresh results. Finishing an old operation cannot release a newer one.

AppStore starts and disposes child lifecycles. Listener owners retain their unsubscribe functions. Reinitialization must not duplicate subscriptions or make an old request current again. Tests exercise `initialize → dispose → initialize` and commands before the first initialization.

The transcription store owns text/progress subscriptions; AppStore owns process-log and model-progress subscriptions. The recorder manages its own listeners. A pending model download does not reserve the workspace. Continuing transcription uses the latest control settings and the workspace active at the actual start; cancelling preparation or disposing invalidates that continuation. Downloading a model independently does not start transcription.

## Tests

Use [the fake adapter](testing/fakeRendererAdapter.ts) to control responses and emit events without Electron. Keep local scenarios beside their owning store. [AppStore tests](appStore.test.ts) cover cross-store coordination, operation ownership and recording integration; [the bridge test](transcriptionBridge.test.ts) verifies controller/preload streaming. [Interface tests](storeInterfaces.test.ts) protect readonly state.

[Workspace lifecycle tests](workspaceLifecycle.test.ts) check atomic session changes and transcript ownership when audio changes. [Control-store tests](../features/transcribe-control/src/model/transcriptionControlStore.test.ts) check preparation and cancellation independently of React.

[Preparation integration tests](transcriptionPreparation.test.ts) exercise AppStore's download/start sequence, latest settings and workspace, cancellation, competing operations, and stale button results after stopping. The control store's synchronous intent commands are called by AppStore; React does not coordinate completion through effects.

For async changes, check both successful and rejected late responses, including stop/dispose followed by a new run. Use the verification commands in the repository's [AGENTS.md](../../../AGENTS.md).
