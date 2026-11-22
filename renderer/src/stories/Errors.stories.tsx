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
            const alert = within(canvas.getByRole('alert'));
            await expect(alert.getByText(/GPU unavailable. Select CPU/)).toBeVisible();
            await userEvent.click(alert.getByRole('textbox', { name: 'Run on' }));
            await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('option', { name: /^CPU$/ }));
            await expect(retry).not.toHaveBeenCalled();
            await userEvent.click(alert.getByRole('button', { name: 'Retry speaker analysis' }));
            await waitFor(() => expect(store.speakers.status).toBe('success'));
            await expect(retry).toHaveBeenCalledWith('storybook-session', expect.objectContaining({ compute: 'cpu' }));
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
