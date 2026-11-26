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
export const Empty: Story = {
    parameters: { scenario: 'empty' },
    play: async ({ canvas }) => {
        await expect(canvas.getByRole('heading', { level: 1, name: 'Record or import audio' })).toBeVisible();
        await expect(canvas.getByRole('navigation', { name: 'Sessions' })).toBeVisible();
        await expect(canvas.getByRole('region', { name: 'Record a meeting' })).toBeVisible();
        await expect(canvas.getByRole('region', { name: 'Import a file' })).toBeVisible();
        await expect(canvas.queryByRole('region', { name: 'Audio player' })).not.toBeInTheDocument();
        await expect(canvas.queryByRole('complementary', { name: 'Transcription settings' })).not.toBeInTheDocument();
    },
};

export const EmptyRecording: Story = {
    parameters: { scenario: 'empty' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const page = within(canvasElement.ownerDocument.body);
        const recorder = within(canvas.getByRole('region', { name: 'Record a meeting' }));
        const systemAudio = recorder.getByRole('textbox', { name: 'System audio' });
        const microphone = recorder.getByRole('textbox', { name: 'Microphone' });
        const start = recorder.getByRole('button', { name: 'Start recording' });
        const record = spyOn(adapter, 'startSystemRecording');
        const importDrop = spyOn(adapter, 'importDroppedAudio');
        try {
            await waitFor(() => expect(start).toBeEnabled());
            await userEvent.click(systemAudio);
            await userEvent.click(page.getByRole('option', { name: 'Off' }));
            await userEvent.click(microphone);
            await userEvent.click(page.getByRole('option', { name: 'Off' }));
            await expect(start).toBeDisabled();
            await userEvent.click(systemAudio);
            await userEvent.click(page.getByRole('option', { name: 'Default device' }));
            await userEvent.click(microphone);
            await userEvent.click(page.getByRole('option', { name: 'Default device' }));
            microphone.focus();
            await userEvent.tab();
            await expect(start).toHaveFocus();
            await userEvent.keyboard('{Enter}');
            const header = within(canvas.getByRole('banner'));
            const stop = await header.findByRole('button', { name: 'Stop recording' });
            await expect(stop).toBeEnabled();
            await expect(record).toHaveBeenCalledWith(expect.objectContaining({ sources: { system: '', microphone: '' } }));
            const monitor = within(canvas.getByRole('region', { name: 'Recording monitor' }));
            await expect(monitor.getByText('1.3 MB')).toBeVisible();
            await expect(monitor.getByRole('meter', { name: 'System audio peak level' })).toHaveAttribute('aria-valuetext', '-8 dB');
            await expect(monitor.getByRole('meter', { name: 'Microphone peak level' })).toHaveAttribute('aria-valuetext', '-14 dB');
            const sources = within(canvas.getByRole('group', { name: 'Recording sources' }));
            await expect(sources.getByRole('textbox', { name: 'System audio' })).toBeDisabled();
            await expect(sources.getByRole('textbox', { name: 'Microphone' })).toBeDisabled();
            await expect(header.getByRole('button', { name: 'Import audio' })).toBeDisabled();
            const transfer = new DataTransfer();
            transfer.items.add(new File([], 'blocked.wav'));
            const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
            canvas.getByRole('main').dispatchEvent(drop);
            await expect(drop.defaultPrevented).toBe(true);
            await expect(importDrop).not.toHaveBeenCalled();
            await expect(stop).toHaveFocus();
            await userEvent.keyboard('{Enter}');
            await expect(await canvas.findByRole('region', { name: 'Audio player' })).toBeVisible();
            await expect(canvas.getByRole('complementary', { name: 'Transcription settings' })).toBeVisible();
        } finally {
            record.mockRestore();
            importDrop.mockRestore();
        }
    },
};

export const EmptyImport: Story = {
    parameters: { scenario: 'empty' },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const choose = canvas.getByRole('button', { name: 'Choose audio file' });
        const pickFile = spyOn(adapter, 'importAudio').mockResolvedValueOnce(null);
        try {
            choose.focus();
            await userEvent.keyboard('{Enter}');
            await expect(pickFile).toHaveBeenCalledOnce();
            await waitFor(() => expect(choose).toBeEnabled());
            await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
            await userEvent.click(choose);
            await expect(await canvas.findByRole('region', { name: 'Audio player' })).toBeVisible();
            await expect(canvas.getByRole('complementary', { name: 'Transcription settings' })).toBeVisible();
        } finally {
            pickFile.mockRestore();
        }
    },
};

export const EmptyDrop: Story = {
    parameters: { scenario: 'empty' },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const card = canvas.getByRole('region', { name: 'Import a file' });
        const importer = spyOn(adapter, 'importDroppedAudio')
            .mockResolvedValueOnce(null)
            .mockRejectedValueOnce(new Error('Corrupt demo audio'));
        const drop = (name: string) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(new File(['Synthetic fixture'], name));
            const eventInit = { dataTransfer, bubbles: true, cancelable: true };
            card.dispatchEvent(new DragEvent('dragover', eventInit));
            card.dispatchEvent(new DragEvent('drop', eventInit));
        };

        try {
            drop('unsupported.txt');
            await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('This file format is not supported.'));
            await expect(importer).not.toHaveBeenCalled();
            drop('missing.wav');
            await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('Could not access the dropped file.'));
            drop('corrupt.wav');
            await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('Failed to import the audio file.'));
            drop('Dropped fixture.WAV');
            const header = within(canvas.getByRole('banner'));
            await expect(await header.findByText('Dropped fixture.WAV')).toBeVisible();
            await expect(canvas.getByRole('region', { name: 'Audio player' })).toBeVisible();
        } finally {
            importer.mockRestore();
        }
    },
};
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
        const header = within(canvas.getByRole('banner'));
        await expect(header.getByRole('status')).toHaveTextContent('Transcribing… 42%');
        await expect(header.getByRole('button', { name: 'Import audio' })).toBeDisabled();
        await expect(header.getByRole('button', { name: 'Start recording' })).toBeDisabled();
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        await expect(settings.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
        await expect(settings.getByText('Settings for this run')).toBeVisible();
        await expect(settings.getByText('English')).toBeVisible();
        await expect(canvas.getByRole('radio', { name: 'Speakers' })).toBeDisabled();
        await expect(canvas.getByRole('radio', { name: 'Summary' })).toBeDisabled();
        await expect(canvas.getByRole('button', { name: 'Export' })).toBeDisabled();
        const playback = within(canvas.getByRole('region', { name: 'Audio player' }));
        await expect(playback.getByRole('radio', { name: 'Original' })).toBeDisabled();
        const markStart = playback.getByRole('button', { name: 'Mark start' });
        await expect(markStart).toBeDisabled();
        await expect(markStart).toHaveAccessibleDescription('Wait for transcription to finish, or stop it.');
        const textView = canvas.getByRole('radio', { name: 'Text' });
        textView.focus();
        await userEvent.keyboard('{ArrowRight}');
        await expect(canvas.getByRole('radio', { name: 'Timecodes' })).toBeChecked();
        await expect(canvas.getByText('00:00:00 – 00:00:04')).toBeVisible();
        await waitFor(() => expect(playback.getByRole('button', { name: 'Play audio' })).toBeEnabled());
        await userEvent.click(settings.getByRole('button', { name: 'Stop transcription' }));
        await waitFor(() => expect(header.getByRole('button', { name: 'Import audio' })).toBeEnabled());
        await expect(markStart).toBeEnabled();
        await expect(canvas.getByRole('radio', { name: 'Speakers' })).toBeEnabled();
    },
};
export const Recording: Story = {
    parameters: { scenario: 'recording' },
    play: async ({ canvas }) => {
        const header = within(canvas.getByRole('banner'));
        await waitFor(() => expect(header.getByRole('status')).toHaveTextContent(/Recording \d\d:\d\d:\d\d/));
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
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        const phase = within(settings.getByRole('list', { name: 'Speaker analysis phases' }));
        await expect(phase.getByText('Analyzing speakers')).toHaveAttribute('aria-current', 'step');
        await expect(settings.queryByRole('progressbar')).not.toBeInTheDocument();
        await expect(canvas.getByRole('radio', { name: 'Speakers' })).toBeDisabled();
        await expect(canvas.getByRole('button', { name: 'Export' })).toBeDisabled();
        await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
        await expect(canvas.getByText('00:00:04 – 00:00:08')).toBeVisible();
        const skip = settings.getByRole('button', { name: 'Skip speaker analysis' });
        skip.focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(settings.queryByRole('button', { name: 'Skip speaker analysis' })).not.toBeInTheDocument());
        await expect(settings.getByText(/Identify speakers · Skipped/)).toBeVisible();
        await expect(canvas.getByRole('radio', { name: 'Speakers' })).toBeEnabled();
        await expect(canvas.getByRole('button', { name: 'Export' })).toBeEnabled();
    },
};
export const SavedSummaryDuringSpeakerAnalysis: Story = {
    parameters: { scenario: 'summary-short' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const page = within(canvasElement.ownerDocument.body);
        let complete = () => {};
        const analyze = spyOn(adapter, 'analyzeSpeakers').mockImplementationOnce((id) =>
            new Promise((resolve) => { complete = () => { resolve(adapter.getSession(id)); }; }));
        const stop = spyOn(adapter, 'stopSpeakerAnalysis').mockImplementationOnce(() => {
            complete();
            return Promise.resolve(true);
        });

        try {
            await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
            await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
            await userEvent.click(page.getByRole('button', { name: 'Analyze speakers again' }));
            await userEvent.click(page.getByRole('button', { name: 'Analyze again' }));
            await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
            await userEvent.click(canvas.getByRole('radio', { name: 'Summary' }));
            const summary = within(canvas.getByRole('region', { name: 'Recording summary' }));
            await expect(summary.getByText(/The team compared ways to find a particular answer/)).toBeVisible();
            await expect(summary.getByRole('button', { name: 'Regenerate summary' })).toBeDisabled();
            await expect(canvas.getByRole('button', { name: 'Export summary' })).toBeDisabled();
            await userEvent.click(canvas.getByRole('button', { name: 'Skip speaker analysis' }));
            await waitFor(() => expect(summary.getByRole('button', { name: 'Regenerate summary' })).toBeEnabled());
            await expect(canvas.getByRole('button', { name: 'Export summary' })).toBeEnabled();
        } finally {
            complete();
            analyze.mockRestore();
            stop.mockRestore();
        }
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
            word.focus();
            await userEvent.keyboard('{Enter}');
            await expect(audio.currentTime).toBeGreaterThanOrEqual(5.69);
            await expect(audio.currentTime).toBeLessThan(6.3);
            audio.currentTime = 8;
            await userEvent.keyboard(' ');
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
        await waitFor(() => expect(page.queryByRole('dialog', { name: 'Rename speaker' })).not.toBeInTheDocument());
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Rename speakers' })).toHaveFocus());
        await userEvent.click(canvas.getByRole('button', { name: 'Speaker settings' }));
        const mergeAction = await page.findByRole('button', { name: 'Merge speakers' });
        await waitFor(() => expect(mergeAction).toBeVisible());
        await userEvent.click(mergeAction);
        const mergeDialog = within(await page.findByRole('dialog', { name: 'Merge speakers' }));
        await userEvent.click(mergeDialog.getByRole('textbox', { name: 'Merge this speaker' }));
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
