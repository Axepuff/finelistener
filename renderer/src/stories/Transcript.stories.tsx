import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent } from 'storybook/test';
import { Home } from '../Home';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Transcript views',
    component: Home,
    loaders: [async ({ parameters }) => {
        const workspace = await createStoryWorkspace(parameters.scenario as WorkspaceScenario);
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
