import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { createStoryWorkspace, type WorkspaceScenario, type StoryWorkspace } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Settings', component: Home,
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'settings-models', docs: { description: { component: 'Real Settings with isolated adapter fixtures. Download progress and errors are illustrative; no model or user file is downloaded.' } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ModelCards: Story = {
    play: async ({ canvas, canvasElement }) => {
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        const source = within(settings.getByRole('group', { name: 'Audio source' }));
        const transcribe = source.getByRole('button', { name: 'Transcribe' });
        await expect(source.getByText('00:12 · 16 kHz · mono')).toBeVisible();
        await userEvent.click(settings.getByRole('button', { name: 'Download Large' }));
        await waitFor(() => expect(settings.getByRole('alert')).toHaveTextContent('Check your connection'));
        await userEvent.click(settings.getByRole('button', { name: 'Show in log' }));
        await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('Whisper model large download failed');
        await expect(canvas.getByRole('region', { name: 'Process log' })).toHaveTextContent('Illustrative download failure');
        await userEvent.click(canvas.getByRole('button', { name: 'Log' }));
        await expect(settings.getByRole('radio', { name: 'Base' })).toBeChecked();
        await expect(transcribe).toBeEnabled();
        await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.click(settings.getByRole('button', { name: 'Retry download Large' }));
        await waitFor(() => expect(settings.queryByRole('alert')).not.toBeInTheDocument());
        const large = settings.getByRole('radio', { name: 'Large' });
        large.focus();
        await userEvent.keyboard(' ');
        await expect(large).toBeChecked();
        await expect(transcribe).toBeEnabled();
        await userEvent.click(settings.getByRole('button', { name: 'Use a local model file instead' }));
        await expect(settings.getByText('custom.bin')).toBeVisible();
        await expect(large).not.toBeChecked();
        await expect(transcribe).toBeEnabled();
        await userEvent.click(settings.getByRole('radio', { name: 'Small' }));
        await expect(transcribe).toBeDisabled();
        await expect(transcribe).toHaveAccessibleDescription('Download the selected model to transcribe.');
        const advanced = settings.getByRole('button', { name: 'Advanced settings' });
        advanced.focus();
        await userEvent.keyboard('{Enter}');
        await expect(advanced).toHaveAttribute('aria-expanded', 'true');
        await expect(await settings.findByRole('textbox', { name: 'Max context' })).toBeVisible();
        await expect(settings.getByRole('textbox', { name: 'Max segment length' })).toBeVisible();
        await expect(settings.getByRole('checkbox', { name: 'Split on words' })).toBeChecked();
        await expect(settings.getByRole('checkbox', { name: 'Use voice activity detection' })).toBeChecked();
        await expect(settings.getByRole('checkbox', { name: 'Reduce speaker bleed in microphone transcription' })).toBeChecked();
        await userEvent.click(advanced);
    },
};
export const CancelDownload: Story = {
    parameters: { scenario: 'settings-downloading' },
    play: async ({ canvas }) => {
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        const source = within(settings.getByRole('group', { name: 'Audio source' }));
        await expect(settings.getByText('Downloading… 38%')).toBeVisible();
        await expect(settings.getByRole('radio', { name: 'Small' })).toBeDisabled();
        await expect(source.getByRole('button', { name: 'Transcribe with Large' })).toBeDisabled();
        await expect(source.getByText('Large can transcribe once it is downloaded. You can start now with Base or wait.')).toBeVisible();
        await userEvent.click(settings.getByRole('button', { name: 'Cancel download' }));
        await waitFor(() => expect(settings.getByRole('button', { name: 'Download Large' })).toBeEnabled());
        await expect(settings.queryByRole('alert')).not.toBeInTheDocument();
        await userEvent.click(settings.getByRole('radio', { name: 'Base' }));
        await expect(source.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
    },
};
export const Failed: Story = { parameters: { scenario: 'settings-failed' } };

export const Downloading: Story = {
    parameters: { scenario: 'settings-downloading' },
    play: async ({ canvas, loaded }) => {
        const { store } = loaded.workspace as StoryWorkspace;
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        const source = within(settings.getByRole('group', { name: 'Audio source' }));
        await userEvent.click(source.getByRole('button', { name: 'Use Base now' }));
        await expect(settings.getByRole('radio', { name: 'Base' })).toBeChecked();
        await expect(settings.getByText('Downloading… 38%')).toBeVisible();
        await userEvent.click(source.getByRole('button', { name: 'Transcribe' }));
        await waitFor(() => expect(store.transcription.runOutcome).toBe('success'));
        await expect(settings.getByText('Downloading… 38%')).toBeVisible();
    },
};


export const RecorderWithOpenSession: Story = {
    parameters: { scenario: 'settings-recording-error' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const page = within(canvasElement.ownerDocument.body);
        const { store, adapter } = loaded.workspace as StoryWorkspace;
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        // The controls must remain mounted in Home when an existing session is open.
        await expect(settings.queryByLabelText('System audio')).not.toBeNull();
        const disclosure = settings.getByText('Recording settings', { selector: 'summary' });
        disclosure.focus();
        await userEvent.keyboard('{Enter}');
        const recorder = within(settings.getByRole('region', { name: 'Recording controls' }));
        await waitFor(() => expect(recorder.getByRole('textbox', { name: 'System audio' })).toBeEnabled());
        await userEvent.click(recorder.getByRole('textbox', { name: 'System audio' }));
        await userEvent.click(page.getByRole('option', { name: 'Off' }));
        await expect(recorder.getByRole('textbox', { name: 'System audio' })).toHaveValue('Off');
        await userEvent.click(disclosure);
        const start = spyOn(adapter, 'startSystemRecording');
        try {
            const header = within(canvas.getByRole('banner'));
            await userEvent.click(header.getByRole('button', { name: 'Start recording' }));
            await waitFor(() => expect(recorder.getByText('Could not start recording. Check the selected devices.')).toBeVisible());
            await expect(store.workspace.activeSessionId).toBe('storybook-session');
            await expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ sources: { system: null, microphone: 'demo-microphone' } }));
            await userEvent.click(recorder.getByRole('textbox', { name: 'System audio' }));
            await userEvent.click(page.getByRole('option', { name: 'Default device' }));
            await userEvent.click(recorder.getByRole('button', { name: 'Start recording' }));
            const sources = within(settings.getByRole('group', { name: 'Recording sources' }));
            await expect(settings.getByRole('checkbox', { name: 'Transcribe when recording stops' })).not.toBeChecked();
            await expect(sources.getByRole('textbox', { name: 'System audio' })).toBeDisabled();
            await expect(canvas.queryByRole('button', { name: 'Transcribe' })).not.toBeInTheDocument();
            await expect(settings.queryByRole('button', { name: 'Clear workspace' })).not.toBeInTheDocument();
            const language = settings.getByRole('textbox', { name: 'Language' });
            await userEvent.click(language);
            await userEvent.click(page.getByRole('option', { name: 'French' }));
            await expect(settings.getByRole('switch', { name: /^Identify speakers/ })).toBeEnabled();
            await userEvent.click(header.getByRole('button', { name: 'Stop recording' }));
            await waitFor(() => expect(recorder.getByRole('textbox', { name: 'Microphone' })).toBeEnabled());
            await expect(language).toHaveValue('French');
            const source = within(settings.getByRole('group', { name: 'Audio source' }));
            await expect(source.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
        } finally { start.mockRestore(); }
    },
};

export const RecorderWarningInWorkspace: Story = {
    parameters: { scenario: 'settings-recording-silence' },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const privacy = spyOn(adapter, 'openRecordingPreferences');
        try {
            const header = within(canvas.getByRole('banner'));
            await userEvent.click(header.getByRole('button', { name: 'Start recording' }));
            const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
            await waitFor(() => expect(settings.getByText(/No system audio detected/)).toBeVisible(), { timeout: 5000 });
            await expect(canvas.getByText(/No audio from system audio for 30 s/)).toBeVisible();
            await userEvent.click(settings.getByRole('button', { name: 'Open privacy settings' }));
            await expect(privacy).toHaveBeenCalledOnce();
            await userEvent.click(header.getByRole('button', { name: 'Stop recording' }));
            await waitFor(() => expect(settings.queryByText(/No system audio detected/)).not.toBeInTheDocument());
        } finally { privacy.mockRestore(); }
    },
};
export const RecordingInWorkspace: Story = { parameters: { scenario: 'settings-recording' } };

export const RecorderSetup: Story = { parameters: { scenario: 'settings-recording-error' } };
