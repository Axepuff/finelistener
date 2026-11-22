import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type FC } from 'react';
import { expect, fireEvent, spyOn, userEvent, waitFor, within } from 'storybook/test';
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
        await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('1 of 2'));
        const search = within(canvas.getByRole('search', { name: 'Transcript' }));
        await userEvent.keyboard('{Enter}');
        await expect(search.getByRole('status')).toHaveTextContent('2 of 2');
        await userEvent.click(search.getByRole('button', { name: 'Previous search result' }));
        await expect(search.getByRole('status')).toHaveTextContent('1 of 2');
        await userEvent.click(search.getByRole('button', { name: 'Clear search' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
        await waitFor(() => expect(canvas.getByLabelText('Current position: 00:04.00 / 00:12.00')).toBeVisible());
        await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
        await userEvent.click(canvas.getByText('00:00:08 – 00:00:12'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        await expect(canvas.getByText('Segment 00:04.00 — 00:08.00')).toBeVisible();
        await expect(canvas.getByRole('button', { name: 'Transcribe segment' })).toBeEnabled();
        canvas.getByRole('button', { name: 'Clear segment' }).focus();
        await userEvent.keyboard('{Enter}');
        await expect(canvas.queryByText('Segment 00:04.00 — 00:08.00')).not.toBeInTheDocument();
        await expect(canvas.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
        await userEvent.click(canvas.getByRole('radio', { name: 'Original' }));
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await expect(canvas.getByRole('radio', { name: 'Original' })).toBeChecked();
        canvas.getByRole('radio', { name: 'Original' }).focus();
        await userEvent.keyboard('{ArrowRight}');
        await waitFor(() => expect(canvas.getByRole('radio', { name: 'Optimized' })).toBeChecked());
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await userEvent.click(canvas.getByText('00:00:00 – 00:00:04'));
        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
    },
};
export const Empty: Story = { parameters: { scenario: 'empty' } };
export const RecordingStartError: Story = {
    parameters: { scenario: 'recording-start-error', docs: { description: { story: 'Recording started from the title bar fails; the recorder opens with the error. The developer console contains the expected failure log.' } } },
    play: async ({ canvas }) => {
        const start = within(canvas.getByRole('banner')).getByRole('button', { name: 'Start recording' });
        await waitFor(() => expect(start).toBeEnabled());
        await userEvent.click(start);
        await waitFor(() => expect(canvas.getByText('Could not start recording. Check the selected devices.')).toBeVisible());
    },
};
export const AudioReady: Story = { parameters: { scenario: 'ready' } };
export const SegmentResizing: Story = {
    play: async ({ canvas, canvasElement, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
        await expect(canvas.getByText('Segment 00:04.00 — …')).toBeVisible();
        await userEvent.click(canvas.getByText('00:00:08 – 00:00:12'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        const waveform = Array.from(canvasElement.querySelectorAll('*'), element => element.shadowRoot)
            .find(root => root?.querySelector('[part~="region"]'));
        if (!waveform) throw new Error('The waveform has no selected region.');
        const region = waveform.querySelector<HTMLElement>('[part~="region"]')!;
        const timeline = waveform.querySelector<HTMLElement>('[part="regions-container"]')!.getBoundingClientRect();
        for (const { side, delta, start, end } of [
            { side: 'left', delta: 1, start: 5, end: 8 },
            { side: 'right', delta: -1, start: 5, end: 7 },
            { side: 'left', delta: -2, start: 3, end: 7 },
            { side: 'right', delta: 2, start: 3, end: 9 },
        ]) {
            const handle = region.querySelector<HTMLElement>(`[part~="region-handle-${side}"]`)!;
            const rect = handle.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientY };
            await fireEvent.pointerDown(handle, { ...pointer, clientX });
            await fireEvent.pointerMove(canvasElement.ownerDocument, { ...pointer, clientX: clientX + delta * timeline.width / 12 });
            await waitFor(() => expect(canvas.getByText(`Segment 00:0${start}.00 — 00:0${end}.00`)).toBeVisible());
            await fireEvent.pointerUp(canvasElement.ownerDocument, pointer);
            const bounds = region.getBoundingClientRect();
            await expect((bounds.left - timeline.left) / timeline.width * 12).toBeCloseTo(start, 2);
            await expect((bounds.right - timeline.left) / timeline.width * 12).toBeCloseTo(end, 2);
        }
        const transcribe = spyOn(adapter, 'transcribe');
        try {
            await userEvent.click(canvas.getByRole('button', { name: 'Transcribe segment' }));
            await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
            const segment = transcribe.mock.calls[0][1].segment;
            await expect(segment?.start).toBeCloseTo(3, 2);
            await expect(segment?.end).toBeCloseTo(9, 2);
            await waitFor(() => expect(canvas.getByRole('button', { name: 'Transcribe segment' })).toBeEnabled());
            await expect(canvas.getByText('Segment 00:03.00 — 00:09.00')).toBeVisible();
            await userEvent.click(canvas.getByRole('button', { name: 'Clear segment' }));
            await expect(waveform.querySelector('[part~="region"]')).toBeNull();
            await userEvent.click(canvas.getByRole('button', { name: 'Transcribe' }));
            await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
            await expect(transcribe.mock.calls[1][1].segment).toBeUndefined();
            await waitFor(() => expect(canvas.getByRole('button', { name: 'Mark start' })).toBeEnabled());
            await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
            await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
            await expect(canvas.getByText('Invalid segment: end must follow start')).toBeVisible();
            await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
            await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
            await expect(canvas.getByText('Segment 00:04.00 — 00:08.00')).toBeVisible();
            await userEvent.click(canvas.getByRole('button', { name: 'Clear segment' }));
            await expect(waveform.querySelector('[part~="region"]')).toBeNull();
        } finally {
            transcribe.mockRestore();
        }
    },
};
export const TranscriptionMetadata: Story = {
    play: async ({ canvas }) => {
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        const header = within(canvas.getByRole('banner'));
        await expect(header.getByText('English')).toBeVisible();
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
        await userEvent.click(canvas.getByText('00:00:08 – 00:00:12'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        await userEvent.click(canvas.getByRole('button', { name: 'Transcribe segment' }));
        await waitFor(() => expect(header.getByText('Russian')).toBeVisible());
        await expect(canvas.getByLabelText('Current position: 00:08.00 / 00:12.00')).toBeVisible();
        await expect(canvas.getByText('Segment 00:04.00 — 00:08.00')).toBeVisible();
    },
};
export const Transcribing: Story = {
    parameters: { scenario: 'transcribing' },
    play: async ({ canvas }) => {
        await expect(within(canvas.getByRole('banner')).getByRole('status')).toHaveTextContent('Transcribing… 42%');
    },
};
export const Recording: Story = {
    parameters: { scenario: 'recording' },
    play: async ({ canvas }) => {
        const header = within(canvas.getByRole('banner'));
        await waitFor(() => expect(header.getByRole('status')).toHaveTextContent('Recording 00:42'));
        await expect(header.getByRole('button', { name: 'Stop recording' })).toBeEnabled();
        await userEvent.click(header.getByRole('button', { name: 'Stop recording' }));
        await waitFor(() => expect(header.getByRole('button', { name: 'Start recording' })).toBeEnabled());
        await expect(header.queryByRole('status')).not.toBeInTheDocument();
    },
};

export const PlayerStripMinimumWidth: Story = {
    render: () => <div style={{ width: 1024 }}><Home /></div>,
    play: async ({ canvas, canvasElement }) => {
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await expect(within(canvas.getByRole('banner')).getByText('English')).toBeVisible();
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
        await expect(canvas.getByRole('button', { name: 'Clear segment' })).toBeEnabled();
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        await expect(canvas.getByText('Invalid segment: end must follow start')).toBeVisible();
        await userEvent.click(canvas.getByText('00:00:08 – 00:00:12'));
        await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
        const player = canvas.getByRole('region', { name: 'Audio player' }).getBoundingClientRect();
        const waveform = canvasElement.querySelector('.player-strip__waveform')!.getBoundingClientRect();
        await expect(waveform.height).toBe(100);
        for (const element of within(canvas.getByRole('region', { name: 'Audio player' })).getAllByRole('button')) {
            const rect = element.getBoundingClientRect();
            await expect(rect.left).toBeGreaterThanOrEqual(player.left);
            await expect(rect.right).toBeLessThanOrEqual(player.right);
            await expect(rect.bottom).toBeLessThanOrEqual(waveform.top);
        }
        const original = canvas.getByRole('radio', { name: 'Original' }).parentElement!.getBoundingClientRect();
        await expect(original.right).toBeLessThanOrEqual(player.right);
        await expect(original.bottom).toBeLessThanOrEqual(waveform.top);
    },
};
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
        await expect(canvas.getByRole('button', { name: 'Export' })).toBeDisabled();
        await userEvent.type(canvas.getByRole('textbox', { name: 'Search transcript' }), 'recording');
        await expect(canvas.getByRole('status')).toHaveTextContent('0 results');
        await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
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
        await userEvent.click(canvas.getByText('00:00:04 – 00:00:08'));
        await waitFor(() => expect(canvas.getByLabelText('Current position: 00:04.00 / 00:12.00')).toBeVisible());
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await expect(canvas.getAllByTitle('Alice · No word timestamp')[0]).toBeVisible();
        await userEvent.click(canvas.getByRole('radio', { name: 'Dialogue' }));
        const alice = canvas.getByRole('button', { name: "Seek to Alice's turn" });
        const bob = canvas.getByRole('button', { name: "Seek to Bob's turn" });
        await expect(alice).toBeVisible();
        await expect(canvas.getByText('00:00:08', { exact: true })).toBeVisible();
        await expect(canvas.getAllByRole('button', { name: 'Assign speaker' })).toHaveLength(2);
        await expect(canvas.queryByRole('button', { name: 'Rename speaker' })).not.toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Merge speakers' })).not.toBeInTheDocument();
        await userEvent.click(bob);
        await waitFor(() => expect(canvas.getByLabelText('Current position: 00:08.00 / 00:12.00')).toBeVisible());
        alice.focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(canvas.getByLabelText('Current position: 00:00.00 / 00:12.00')).toBeVisible());
        await userEvent.click(canvas.getByText('Show original fragments'));
        await expect(canvas.queryByText(/^\d+\.\d+s$/)).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('button', { name: 'The transcript should stay easy to read while we listen and compare details.' }));
        await waitFor(() => expect(canvas.getByLabelText('Current position: 00:04.00 / 00:12.00')).toBeVisible());
        await userEvent.click(canvas.getByText('Show original fragments'));
    },
};

export const SpeakerReading: Story = {
    parameters: { scenario: 'nemotron-reading' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const { store } = loaded.workspace as StoryWorkspace;
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await expect(canvas.queryByRole('radio', { name: 'Reading' })).not.toBeInTheDocument();
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await expect(canvas.getByRole('radio', { name: 'Reading' })).toBeChecked();
        await expect(canvas.getByRole('list', { name: 'Speaker colors' })).toHaveTextContent('AliceBob');
        const word = canvas.getByRole('button', { name: 'Friday · Bob · Overlapping voices · Estimated from voice activity' });
        await expect(word).toBeVisible();
        await userEvent.type(canvas.getByRole('textbox', { name: 'Search transcript' }), 'afternoon? Friday');
        await expect(canvas.getByRole('status')).toHaveTextContent('1 of 1');
        await expect(word.querySelector('mark')).toHaveTextContent('Friday');
        await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
        const audio = Array.from(canvasElement.querySelectorAll('*'), element => element.shadowRoot?.querySelector('audio')).find(Boolean);
        if (!audio) throw new Error('The waveform has no audio element.');
        // A synthetic click reaches the real media element even when the browser denies autoplay.
        const play = spyOn(audio, 'play');
        try {
            await userEvent.click(word);
            await expect(play).toHaveBeenCalled();
            audio.currentTime = 8;
            await userEvent.click(word);
            await expect(audio.currentTime).toBeGreaterThanOrEqual(5.69);
            await expect(audio.currentTime).toBeLessThan(6.3);
            await userEvent.click(canvas.getByRole('textbox', { name: 'Search transcript' }));
            await expect(word).toHaveAttribute('aria-current', 'true');
            const result = await store.openSession('storybook-session');
            await expect(result.ok).toBe(true);
            await waitFor(() => expect(audio.paused).toBe(true));
            await waitFor(() => expect(audio.currentTime).toBe(0));
        } finally {
            audio.pause();
            play.mockRestore();
        }
    },
};

export const SpeakerSettings: Story = {
    parameters: { scenario: 'speakers' },
    play: async ({ canvas, canvasElement }) => {
        const page = within(canvasElement.ownerDocument.body);
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await userEvent.click(canvas.getByRole('button', { name: 'Rename speakers' }));
        await waitFor(() => expect(page.getByRole('dialog', { name: 'Rename speaker' })).toBeVisible());
        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Rename speakers' })).toHaveFocus());
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        await userEvent.click(await page.findByRole('button', { name: 'Merge speakers' }));
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

const PANEL_TEST_WIDTH = 1185;

const RemountableWorkspace: FC = () => {
    const [mountKey, setMountKey] = useState(0);

    return (
        <div style={{ width: PANEL_TEST_WIDTH }}>
            <button type="button" onClick={() => setMountKey((key) => key + 1)}>{'Remount workspace'}</button>
            <Home key={mountKey} />
        </div>
    );
};

export const RememberedPanelWidths: Story = {
    render: () => <RemountableWorkspace />,
    play: async ({ canvas, canvasElement, loaded }) => {
        const { store } = loaded.workspace as StoryWorkspace;
        const widths = () => ['nav[aria-label="Sessions"]', 'main', 'aside'].map((selector) => (
            Math.round(canvasElement.querySelector(selector)?.getBoundingClientRect().width ?? 0)
        ));
        await waitFor(() => expect(widths()).toEqual([300, 525, 360]));
        const separator = canvas.getByRole('separator', { name: 'Resize sessions panel' });
        const startX = separator.getBoundingClientRect().left + 5;
        await fireEvent.pointerDown(separator, { clientX: startX });
        // The move listener is attached by an effect after the resize state updates.
        await new Promise((resolve) => setTimeout(resolve, 50));
        await fireEvent.pointerMove(window, { clientX: startX + 300 });
        await fireEvent.pointerUp(window);
        // Sessions grows until Settings reaches its 320px minimum; the transcript keeps 440px.
        await waitFor(() => expect(widths()).toEqual([425, 440, 320]));
        await waitFor(async () => expect([
            await store.getUiPreference('homeSidebarWidth'),
            await store.getUiPreference('homeRightSidebarWidth'),
        ]).toEqual([425, 320]));
        await userEvent.click(canvas.getByRole('button', { name: 'Remount workspace' }));
        await waitFor(() => expect(widths()).toEqual([425, 440, 320]));
    },
};
