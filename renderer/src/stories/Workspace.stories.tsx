import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { TranscribedText } from '../features/transcribed-text';
import { createStoryWorkspace, type WorkspaceScenario, type StoryWorkspace } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Recording and transcript',
    component: Home,
    tags: ['autodocs'],
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: {
        scenario: 'transcript',
        docs: { description: { component: 'The real FineListener workspace with isolated Windows demo services. Audio is a generated 12-second tone sequence; transcript text is illustrative. File import, transcription, and recording actions use fixtures. Playback, seeking, search, view switching, and sidebar resizing use the real UI.' } },
    },
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Transcript: Story = {
    play: async ({ canvas }) => {
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await userEvent.type(canvas.getByRole('textbox', { name: 'Search transcript' }), 'recording');
        await expect(canvas.getByRole('status')).toHaveTextContent('1 of 2');
        await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await userEvent.click(canvas.getByText('[00:00:04 - 00:00:08]'));
        await waitFor(() => expect(canvas.getByText('Current position: 00:04.00')).toBeVisible());
        await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
        await userEvent.click(canvas.getByText('[00:00:08 - 00:00:12]'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        await expect(canvas.getByText('Selected segment: 00:04.00 — 00:08.00')).toBeVisible();
        await userEvent.click(canvas.getByRole('button', { name: 'Clear selection' }));
        await userEvent.click(canvas.getByText('[00:00:00 - 00:00:04]'));
        await userEvent.click(canvas.getByRole('radio', { name: 'Plain Text' }));
    },
};
export const Empty: Story = { parameters: { scenario: 'empty' } };
export const AudioReady: Story = { parameters: { scenario: 'ready' } };
export const Transcribing: Story = { parameters: { scenario: 'transcribing' } };
export const TranscriptionError: Story = { parameters: { scenario: 'error', docs: { description: { story: 'An intentional adapter failure demonstrates the real transcription error state. The developer console contains the expected failure log.' } } } };
export const LongTranscript: Story = { parameters: { scenario: 'long-transcript' } };
export const Nemotron: Story = {
    parameters: { scenario: 'nemotron' },
    play: async ({ canvas, canvasElement }) => {
        const page = within(canvasElement.ownerDocument.body);
        await expect(canvas.queryByRole('textbox', { name: 'System or file speakers' })).not.toBeInTheDocument();
        await expect(canvas.getByText('Nemotron 3 counts speakers automatically. Auto uses CPU when no GPU is available.')).toBeVisible();
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        await expect(page.queryByRole('textbox', { name: 'Speaker count' })).not.toBeInTheDocument();
        await waitFor(() => expect(page.getByText('Nemotron 3 · VULKAN · Optimized')).toBeVisible());
        await userEvent.click(page.getByRole('button', { name: 'Analyze speakers again' }));
        await waitFor(() => expect(page.getByRole('dialog', { name: 'Replace speaker labels?' })).toBeVisible());
        await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    },
};
export const NemotronDownloading: Story = { parameters: { scenario: 'nemotron-downloading' } };
export const NemotronAnalyzing: Story = {
    parameters: { scenario: 'nemotron-analyzing' },
    play: async ({ canvas }) => {
        await expect(canvas.getByText('Analyzing speakers', { exact: true })).toBeVisible();
        await expect(canvas.queryByText(/Analyzing speakers \(/)).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
        await expect(canvas.queryByText('Analyzing speakers', { exact: true })).not.toBeInTheDocument();
    },
};
export const NemotronError: Story = { parameters: { scenario: 'nemotron-error' } };
export const SpeakersBeforeAnalysis: Story = {
    play: async ({ canvas, canvasElement }) => {
        const page = within(canvasElement.ownerDocument.body);
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await expect(canvas.queryByText(/Let us review the recording workflow/)).not.toBeInTheDocument();
        await expect(canvas.getByText('The transcript will appear here after speaker analysis.')).toBeVisible();
        await expect(page.queryByRole('button', { name: 'Analyze speakers' })).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        await expect(page.getByRole('button', { name: 'Analyze speakers' })).toBeEnabled();
        const device = page.getByRole('textbox', { name: 'Speaker analysis device' });
        await expect(device).toHaveValue('Auto (GPU when available)');
        await userEvent.click(device);
        await userEvent.click(page.getByRole('option', { name: /^CPU$/ }));
        await userEvent.keyboard('{Escape}');
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        await expect(page.getByRole('textbox', { name: 'Speaker analysis device' })).toHaveValue('CPU');
        await userEvent.keyboard('{Escape}');
        await expect(canvas.getByRole('button', { name: 'Copy transcript' })).toBeDisabled();
        await expect(canvas.getByRole('button', { name: 'Save .txt' })).toBeDisabled();
        await userEvent.type(canvas.getByRole('textbox', { name: 'Search transcript' }), 'recording');
        await expect(canvas.getByRole('status')).toHaveTextContent('0 results');
        await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Plain Text' }));
        await expect(canvas.getByText(/Let us review the recording workflow/)).toBeVisible();
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
    },
};
export const Speakers: Story = {
    parameters: { scenario: 'speakers' },
    play: async ({ canvas }) => {
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await expect(canvas.queryByRole('button', { name: 'Rename speaker' })).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await expect(canvas.queryByRole('button', { name: "Seek to Alice's turn" })).not.toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Assign speaker' })).not.toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Analyze speakers again' })).not.toBeInTheDocument();
        await userEvent.click(canvas.getByText('[00:00:04 - 00:00:08]'));
        await waitFor(() => expect(canvas.getByText('Current position: 00:04.00')).toBeVisible());
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        const alice = canvas.getByRole('button', { name: "Seek to Alice's turn" });
        const bob = canvas.getByRole('button', { name: "Seek to Bob's turn" });
        await expect(alice).toBeVisible();
        await expect(canvas.queryByText(/\[00:00:/)).not.toBeInTheDocument();
        await expect(canvas.getAllByRole('button', { name: 'Assign speaker' })).toHaveLength(2);
        await expect(canvas.queryByRole('button', { name: 'Rename speaker' })).not.toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Merge speakers' })).not.toBeInTheDocument();
        await userEvent.click(bob);
        await waitFor(() => expect(canvas.getByText('Current position: 00:08.00')).toBeVisible());
        alice.focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(canvas.getByText('Current position: 00:00.00')).toBeVisible());
        await userEvent.click(canvas.getByText('Show original fragments'));
        await expect(canvas.queryByText(/^\d+\.\d+s$/)).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('button', { name: 'The transcript should stay easy to read while we listen and compare details.' }));
        await waitFor(() => expect(canvas.getByText('Current position: 00:04.00')).toBeVisible());
        await userEvent.click(canvas.getByText('Show original fragments'));
    },
};

export const SpeakerSettings: Story = {
    parameters: { scenario: 'speakers' },
    play: async ({ canvas, canvasElement }) => {
        const page = within(canvasElement.ownerDocument.body);
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        await expect(page.getByRole('button', { name: 'Rename speaker' })).toBeEnabled();
        await userEvent.click(page.getByRole('button', { name: 'Merge speakers' }));
        await userEvent.click(page.getByRole('textbox', { name: 'Merge this speaker' }));
        await userEvent.click(page.getByRole('option', { name: 'Unknown speaker' }));
        await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeEnabled();
        await userEvent.click(page.getByRole('textbox', { name: 'Into this speaker' }));
        await userEvent.click(page.getByRole('option', { name: 'Unknown speaker' }));
        await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeDisabled();
        await userEvent.click(page.getByRole('textbox', { name: 'Merge this speaker' }));
        await userEvent.click(page.getByRole('option', { name: 'Alice' }));
        await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeEnabled();
        await userEvent.keyboard('{Escape}');
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
    },
};

export const NarrowSpeakers: Story = {
    parameters: { scenario: 'speakers' },
    render: () => (
        <section aria-label="Narrow transcript" style={{ width: 300, height: 500, overflow: 'hidden' }}>
            <TranscribedText />
        </section>
    ),
    play: async ({ canvas, canvasElement }) => {
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        const pane = canvas.getByRole('region', { name: 'Narrow transcript' }).getBoundingClientRect();
        const settings = canvas.getByRole('button', { name: 'Speaker settings' });
        const button = settings.getBoundingClientRect();
        await expect(button.left).toBeGreaterThanOrEqual(pane.left);
        await expect(button.right).toBeLessThanOrEqual(pane.right);
        await userEvent.click(settings);
        const page = within(canvasElement.ownerDocument.body);
        await waitFor(() => expect(page.getByRole('textbox', { name: 'Speaker analysis device' })).toBeVisible());
        await expect(page.getByRole('button', { name: 'Merge speakers' })).toBeEnabled();
    },
};

export const SessionFolder: Story = {
    play: async ({ canvas, canvasElement, loaded }) => {
        const { store } = loaded.workspace as StoryWorkspace;
        store.clearWorkspace();
        await userEvent.click(canvas.getByRole('button', { name: 'Session actions' }));
        const page = within(canvasElement.ownerDocument.body);
        await waitFor(() => expect(page.getByRole('menuitem', { name: 'Reveal session folder' })).toBeVisible());
        await userEvent.click(page.getByRole('menuitem', { name: 'Reveal session folder' }));
        await waitFor(() => expect(page.queryByRole('menuitem', { name: 'Reveal session folder' })).not.toBeInTheDocument());
        await expect(store.workspace.activeSessionId).toBeNull();
    },
};
