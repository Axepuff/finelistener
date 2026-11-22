import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test';
import { parseVerboseJson } from '../../../electron/src/services/whisperServer/utils';
import { Home } from '../Home';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const partialTimingSpeech = 'First. Second missing timed. Third starts here.';

const meta = {
    title: 'Workspace/Transcript views',
    component: Home,
    loaders: [async ({ parameters }) => {
        const workspace = await createStoryWorkspace(parameters.scenario as WorkspaceScenario);
        if (parameters.partialTiming) {
            const { segments = [] } = parseVerboseJson({ segments: [{
                text: partialTimingSpeech, start: 0, end: 12,
                words: [
                    { text: 'First. ', start: 0, end: 1 },
                    { text: 'Second missing ' },
                    { text: 'timed. ', start: 8, end: 9 },
                    { text: 'Third starts here.', start: 10, end: 12 },
                ],
            }] });
            workspace.store.transcription.replaceSavedTranscript({ version: 1, segments });
        }
        if (parameters.manySpeakers) {
            const transcript = workspace.store.transcription.savedTranscript;
            if (!transcript) throw new Error('The long transcript fixture is missing.');
            const speakers = Array.from({ length: 14 }, (_, index) => ({
                id: String(index), name: `Guest ${index + 1} · Listening workshop`,
            }));
            workspace.store.transcription.replaceSavedTranscript({
                version: 1,
                recognitionRevision: 'demo-revision',
                segments: transcript.segments.map(({ startSec, endSec, text }, index) => ({
                    startSec, endSec, text,
                    speakerId: index % 15 === 14 ? null : String(index % 15),
                })),
                speakers: {
                    version: 1, recognitionRevision: 'demo-revision', generation: 'demo-generation',
                    settings: {}, intervals: [], corrections: [], status: 'completed', speakers,
                },
            });
        }
        return { workspace };
    }],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'nemotron-reading' },
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TimedSpeakers: Story = {};

export const RenameTimedSpeaker: Story = {
    play: async ({ canvas, canvasElement }) => {
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        await userEvent.click(canvas.getByRole('button', { name: 'Rename speakers' }));
        const page = within(canvasElement.ownerDocument.body);
        const dialog = within(await page.findByRole('dialog', { name: 'Rename speaker' }));
        const name = dialog.getByRole('textbox', { name: 'Name' });
        await userEvent.clear(name);
        await userEvent.type(name, 'Mira');
        await userEvent.click(dialog.getByRole('button', { name: 'Save name' }));
        await waitFor(() => expect(canvas.getByRole('list', { name: 'Speaker colors' })).toHaveTextContent('Mira'));
        await expect(canvas.getByRole('button', { name: 'Could · Mira' })).toBeVisible();

        await userEvent.click(canvas.getByRole('radio', { name: 'Dialogue' }));
        await expect(canvas.getAllByRole('button', { name: "Seek to Mira's turn" })[0]).toBeVisible();
        await expect(canvas.queryByRole('button', { name: "Seek to Alice's turn" })).not.toBeInTheDocument();
    },
};

export const PartialTiming: Story = {
    parameters: { scenario: 'transcript', partialTiming: true },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const save = spyOn(adapter, 'saveText');
        const copy = spyOn(navigator.clipboard, 'write').mockResolvedValue(undefined);
        try {
            const transcript = within(canvas.getByRole('main'));
            await expect(transcript.getByText('Second missing timed.')).toBeVisible();
            await userEvent.type(transcript.getByRole('textbox', { name: 'Search transcript' }), 'missing timed');
            await expect(transcript.getByRole('status')).toHaveTextContent('1 of 1');
            await expect(transcript.getByText('missing timed', { selector: 'mark' })).toBeVisible();

            await userEvent.click(transcript.getByRole('button', { name: 'Export' }));
            await expect(save).toHaveBeenCalledWith(partialTimingSpeech);
            await userEvent.click(transcript.getByRole('button', { name: 'Copy transcript' }));
            const item = copy.mock.lastCall?.[0][0];
            if (!item) throw new Error('Copy did not write a clipboard item.');
            await expect((await item.getType('text/plain')).text()).resolves.toBe(partialTimingSpeech);
            await expect((await item.getType('text/html')).text()).resolves.toBe(partialTimingSpeech);
            await userEvent.click(transcript.getByRole('button', { name: 'Clear search' }));
        } finally {
            save.mockRestore();
            copy.mockRestore();
        }
    },
};

export const ManySpeakers: Story = { parameters: { scenario: 'long-transcript', manySpeakers: true } };

export const CopyAndExport: Story = {
    parameters: { scenario: 'speakers' },
    play: async ({ canvas, loaded }) => {
        const { adapter } = loaded.workspace as StoryWorkspace;
        const save = spyOn(adapter, 'saveText');
        const copy = spyOn(navigator.clipboard, 'write').mockResolvedValue(undefined);
        const passages = [
            'Let us review the recording workflow and make the next action clear.',
            'The transcript should stay easy to read while we listen and compare details.',
            'Search for recording, switch to timecodes, or click a passage to seek the audio.',
        ];
        const speech = passages.join(' ');
        try {
            for (const { view, layout, expected, htmlMarker } of [
                { view: 'Text', expected: speech, htmlMarker: 'Let us review' },
                { view: 'Timecodes', expected: passages.map((text, i) => `[00:00:${String(i * 4).padStart(2, '0')} --> 00:00:${String((i + 1) * 4).padStart(2, '0')}] ${text}\n`).join(''), htmlMarker: 'data-regions=' },
                { view: 'Speakers', layout: 'Dialogue', expected: `Alice: ${passages[0]} ${passages[1]}\nBob: ${passages[2]}\n`, htmlMarker: '<strong>Alice: </strong>' },
                { view: 'Speakers', layout: 'Reading', expected: speech, htmlMarker: 'title="Alice"' },
            ]) {
                await userEvent.click(canvas.getByRole('radio', { name: view }));
                if (layout) await userEvent.click(canvas.getByRole('radio', { name: layout }));

                await userEvent.click(canvas.getByRole('button', { name: 'Export' }));
                await expect(save).toHaveBeenLastCalledWith(expected);

                await userEvent.click(canvas.getByRole('button', { name: 'Copy transcript' }));
                const item = copy.mock.lastCall?.[0][0];
                if (!item) throw new Error('Copy did not write a clipboard item.');
                await expect((await item.getType('text/plain')).text()).resolves.toBe(expected);
                await expect((await item.getType('text/html')).text()).resolves.toContain(htmlMarker);
                save.mockClear();
                copy.mockClear();
            }
        } finally {
            save.mockRestore();
            copy.mockRestore();
        }
    },
};
