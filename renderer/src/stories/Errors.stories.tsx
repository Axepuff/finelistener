import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { createErrorWorkspace, type ErrorScenario } from './storyErrors';
import type { StoryWorkspace } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Errors', component: Home,
    loaders: [async ({ parameters }) => ({ workspace: await createErrorWorkspace(parameters.errorScenario as ErrorScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { errorScenario: 'incomplete', docs: { description: { component: 'Real renderer recovery paths with controlled IPC. No hardware, inference, downloads or OS settings are accessed.' } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Incomplete: Story = {
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const retry = spyOn(adapter, 'transcribeSession');
        try {
            const alert = within(canvas.getByRole('alert'));
            await expect(alert.getByText('System audio: Saved')).toBeVisible();
            await expect(alert.getByText('Microphone: Failed')).toBeVisible();
            const log = alert.getByRole('button', { name: 'Show in log' });
            log.focus();
            await userEvent.keyboard('{Enter}');
            await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveFocus();
            await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('source=microphone; status=failed');
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            await userEvent.click(alert.getByRole('button', { name: 'Retry remaining sources' }));
            await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument());
            await expect(retry).toHaveBeenCalledWith('storybook-session', expect.objectContaining({ retryFailed: true, language: 'en', model: 'base' }));
            await expect(canvas.getByText('Saved system audio.')).toBeVisible();
            await expect(canvas.getByText('Recovered microphone.')).toBeVisible();
        } finally { retry.mockRestore(); }
    },
};
export const NothingTranscribed: Story = {
    parameters: { errorScenario: 'nothing' },
    play: async ({ canvas }) => {
        const alert = within(canvas.getByRole('alert'));
        await expect(alert.queryByText(/previous transcript/)).not.toBeInTheDocument();
        await userEvent.click(alert.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument());
    },
};
export const PartialPreparationFailure: Story = {
    parameters: { errorScenario: 'partial-preparation' },
    play: async ({ canvas, loaded }) => {
        const { store, adapter } = loaded.workspace as StoryWorkspace;
        const retry = spyOn(adapter, 'transcribeSession');
        try {
            const alert = within(canvas.getByRole('alert'));
            await expect(alert.getByText('Incomplete transcription')).toBeVisible();
            await expect(alert.getByText('System audio: Saved')).toBeVisible();
            await expect(alert.getByText('Microphone: Failed')).toBeVisible();
            alert.getByRole('button', { name: 'Show in log' }).focus();
            await userEvent.keyboard('{Enter}');
            const log = canvas.getByRole('region', { name: 'Process log' });
            await expect(log).toHaveFocus();
            await expect(log).toHaveTextContent('microphone: Error: Synthetic microphone conversion failed; caused by Error (ENOSPC): Synthetic disk is full');
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            await userEvent.click(alert.getByRole('button', { name: 'Retry remaining sources' }));
            await waitFor(() => expect(store.transcription.isIncomplete).toBe(false));
            await expect(retry).toHaveBeenCalledWith('storybook-session', expect.objectContaining({ retryFailed: true, language: 'en', model: 'base' }));
            await expect(canvas.getByText('Saved system audio.')).toBeVisible();
            await expect(canvas.getByText('Recovered microphone.')).toBeVisible();
            await expect(store.operations.isBusy).toBe(false);
        } finally { retry.mockRestore(); }
    },
};
export const PreviousKept: Story = {
    parameters: { errorScenario: 'previous' },
    play: async ({ canvas }) => {
        const alert = within(canvas.getByRole('alert'));
        await expect(alert.getByText('The previous transcript is kept.')).toBeVisible();
        await userEvent.click(alert.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(canvas.queryByRole('alert')).not.toBeInTheDocument());
    },
};
export const SpeakerFailure: Story = {
    parameters: { errorScenario: 'speaker' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const { adapter, store } = loaded.workspace as StoryWorkspace;
        const retry = spyOn(adapter, 'analyzeSpeakers');
        try {
            const alert = within((await canvas.findByText('Speaker analysis failed')).closest('[role="alert"]') as HTMLElement);
            await expect(alert.getByRole('textbox', { name: 'Run on' })).toHaveValue('GPU (Vulkan)');
            const busy = store.operations.begin('optimizing-audio')!;
            await waitFor(() => expect(alert.getByRole('textbox', { name: 'Run on' })).toBeDisabled());
            await expect(alert.getByRole('button', { name: 'Retry speaker analysis' })).toBeDisabled();
            await expect(alert.getByRole('button', { name: 'Show in log' })).toBeEnabled();
            store.operations.finish(busy);
            await expect(alert.getByText(/GPU unavailable. Select CPU/)).toBeVisible();
            await userEvent.click(alert.getByRole('button', { name: 'Show in log' }));
            await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('SPEAKER_GPU_UNAVAILABLE');
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            await userEvent.click(alert.getByRole('textbox', { name: 'Run on' }));
            await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('option', { name: /^CPU$/ }));
            await expect(retry).not.toHaveBeenCalled();
            await userEvent.click(alert.getByRole('button', { name: 'Retry speaker analysis' }));
            await waitFor(() => expect(store.speakers.status).toBe('success'));
            await expect(retry).toHaveBeenCalledWith('storybook-session', expect.objectContaining({ compute: 'cpu' }));
            await expect(store.speakers.compute).toBe('cpu');
            await expect(store.transcription.savedTranscript?.speakers?.status).toBe('completed');
        } finally { retry.mockRestore(); }
    },
};
export const ComponentFailure: Story = {
    parameters: { errorScenario: 'preparation' },
    play: async ({ canvas, loaded }) => {
        const { adapter, store } = loaded.workspace as StoryWorkspace;
        const retry = spyOn(adapter, 'prepareSpeakerAssets');
        const analyze = spyOn(adapter, 'analyzeSpeakers');
        try {
            const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
            await userEvent.click(settings.getByRole('button', { name: 'Show in log' }));
            await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('Synthetic component failure');
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            await userEvent.click(settings.getByRole('button', { name: 'Retry download' }));
            await waitFor(() => expect(store.speakers.componentReady).toBe(true));
            await expect(retry).toHaveBeenCalledOnce();
            await expect(analyze).not.toHaveBeenCalled();
        } finally { retry.mockRestore(); analyze.mockRestore(); }
    },
};
export const MacPermission: Story = {
    parameters: { errorScenario: 'permission' },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const open = spyOn(adapter, 'openRecordingPreferences');
        try {
            const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
            const disclosure = settings.getByText('Recording settings', { selector: 'summary' });
            if (!disclosure.closest('details')?.open) await userEvent.click(disclosure);
            await expect(settings.getByText(/Turn on FineListener in System Settings/)).toBeVisible();
            await userEvent.click(settings.getByRole('button', { name: 'Open System Settings' }));
            await expect(open).toHaveBeenCalledOnce();
        } finally { open.mockRestore(); }
    },
};
export const StorageFull: Story = {
    parameters: { errorScenario: 'storage' },
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole('button', { name: 'Show unfinished recordings' }));
        await waitFor(() => expect(canvas.getByText('Unfinished recording').closest('[role="alert"]')).toHaveFocus());
    },
};
export const SourceStopped: Story = {
    parameters: { errorScenario: 'source-stopped' },
    play: async ({ canvas, loaded }) => {
        const { store } = loaded.workspace as StoryWorkspace;
        await userEvent.click(canvas.getByRole('button', { name: 'Play captured audio' }));
        await expect(store.workspace.playbackRequest?.action).toBe('play');
    },
};


export const SpeakerReplacementGuard: Story = {
    parameters: { errorScenario: 'speaker-existing' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const { adapter, store } = loaded.workspace as StoryWorkspace;
        const retry = spyOn(adapter, 'analyzeSpeakers');
        const page = within(canvasElement.ownerDocument.body);
        try {
            await userEvent.click(canvas.getByRole('button', { name: 'Retry speaker analysis' }));
            await waitFor(() => expect(page.getByRole('dialog', { name: 'Replace speaker labels?' })).toBeVisible());
            await expect(retry).not.toHaveBeenCalled();
            await store.openSession('replacement-session');
            await userEvent.click(page.getByRole('button', { name: 'Replace and analyze' }));
            await expect(retry).not.toHaveBeenCalled();
            await expect(store.workspace.activeSessionId).toBe('replacement-session');
        } finally { retry.mockRestore(); }
    },
};


const recoverActiveStop: NonNullable<Story['play']> = async ({ canvas, loaded }) => {
    const { adapter, store } = loaded.workspace as StoryWorkspace;
    const analyzing = store.operations.kind === 'analyzing-speakers';
    const stop = spyOn(adapter, analyzing ? 'stopSpeakerAnalysis' : 'stopTranscription');
    const operationId = store.operations.active?.id;
    store.activityLog.appendProcessOutput('Earlier diagnostic output\n'.repeat(120));
    try {
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        await userEvent.click(settings.getByRole('button', { name: analyzing ? 'Skip speaker analysis' : 'Stop transcription' }));
        const alert = within(await settings.findByRole('alert'));
        await expect(store.operations.active?.id).toBe(operationId);
        const log = alert.getByRole('button', { name: 'Show in log' });
        log.focus();
        await userEvent.keyboard('{Enter}');
        await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveFocus();
        const logRegion = canvas.getByRole('region', { name: 'Process log' });
        await expect(logRegion).toHaveTextContent('Synthetic stop failure');
        const logText = within(logRegion).getByText(/Synthetic stop failure/);
        await expect(logText.scrollTop).toBeGreaterThan(0);
        await expect(logText.scrollHeight - logText.clientHeight - logText.scrollTop).toBeLessThanOrEqual(1);
        await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent(analyzing ? 'Speaker stop failed' : 'Transcription stop failed');
        await expect(alert.queryByText(/Synthetic stop failure/)).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
        await userEvent.click(alert.getByRole('button', { name: analyzing ? 'Retry skipping' : 'Retry stop' }));
        await waitFor(() => expect(store.operations.isBusy).toBe(false));
        await expect(stop).toHaveBeenCalledTimes(2);
        await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    } finally { stop.mockRestore(); }
};

export const ActiveTranscriptionStopFailure: Story = {
    parameters: { errorScenario: 'stop-transcription' }, play: recoverActiveStop,
};
export const ActiveSpeakerSkipFailure: Story = {
    parameters: { errorScenario: 'stop-speakers' }, play: recoverActiveStop,
};
export const LateStopFailure: Story = {
    parameters: { errorScenario: 'stop-transcription' },
    play: async ({ canvas, loaded }) => {
        const { adapter, store } = loaded.workspace as StoryWorkspace;
        let rejectStop!: (error: Error) => void;
        let rejectSkip!: (error: Error) => void;
        let finishAnalysis!: (session: Awaited<ReturnType<typeof adapter.getSession>>) => void;
        let analysis: ReturnType<typeof store.analyzeSpeakers> | undefined;
        const stop = spyOn(adapter, 'stopTranscription').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStop = reject; }));
        const analyze = spyOn(adapter, 'analyzeSpeakers').mockImplementationOnce(() => new Promise((resolve) => { finishAnalysis = resolve; }));
        const skip = spyOn(adapter, 'stopSpeakerAnalysis').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSkip = reject; }));
        try {
            await userEvent.click(canvas.getByRole('button', { name: 'Stop transcription' }));
            await expect(stop).toHaveBeenCalledOnce();
            const previous = store.operations.active!;
            store.operations.transition(previous, 'analyzing-speakers');
            await waitFor(() => expect(canvas.getByRole('button', { name: 'Skip speaker analysis' })).toBeEnabled());
            await expect(store.operations.active?.id).toBe(previous.id);
            store.operations.finish(previous);
            store.transcription.replaceSavedTranscript({ version: 1, segments: [{ startSec: 0, endSec: 1, text: 'Synthetic saved transcript.' }] });
            analysis = store.analyzeSpeakers();
            await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
            await userEvent.click(canvas.getByRole('button', { name: 'Skip speaker analysis' }));
            await expect(skip).toHaveBeenCalledOnce();
            rejectStop(new Error('Synthetic late stop failure'));
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            await expect(canvas.getByRole('button', { name: 'Skip speaker analysis' })).toBeDisabled();
            await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
            await expect(store.activityLog.content).not.toContain('Synthetic late stop failure');
            await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
            rejectSkip(new Error('Synthetic current skip failure'));
            const alert = within(await canvas.findByRole('alert'));
            await expect(alert.getByRole('button', { name: 'Retry skipping' })).toBeEnabled();
            await userEvent.click(alert.getByRole('button', { name: 'Show in log' }));
            await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('Synthetic current skip failure');
            await expect(store.operations.kind).toBe('analyzing-speakers');
        } finally {
            store.operations.cancelActive();
            rejectStop?.(new Error('Synthetic cleanup'));
            rejectSkip?.(new Error('Synthetic cleanup'));
            finishAnalysis?.(await adapter.getSession('storybook-session'));
            await analysis;
            stop.mockRestore();
            analyze.mockRestore();
            skip.mockRestore();
        }
    },
};
