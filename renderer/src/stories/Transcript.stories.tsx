import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test';
import { parseVerboseJson } from '../../../electron/src/services/whisperServer/utils';
import { Home } from '../Home';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const partialTimingSpeech = 'First. Second missing timed. Third starts here.';
const longReadingTail = `Before ${'long'.repeat(18)} and after ${'wide'.repeat(18)} Closing beacon finishes the conversation.`;

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
        if (parameters.longReading) {
            const speakers = workspace.store.transcription.savedTranscript?.speakers;
            if (!speakers) throw new Error('The speaker fixture is missing.');
            const segments = Array.from({ length: 120 }, (_, index) => {
                const text = index === 0 ? 'Opening beacon starts this conversation.' :
                    index === 119 ? longReadingTail :
                    `Section ${index} contains another sentence in the recorded conversation.`;
                const startSec = index / 10;
                const endSec = (index + 1) / 10;
                const tokens = [...text.matchAll(/\w+/g)];
                return {
                    text, startSec, endSec, speakerId: 'alice',
                    words: tokens.map((token, i) => ({
                        text: token[0], startChar: token.index, endChar: token.index + token[0].length,
                        startSec: startSec + i / (10 * tokens.length), endSec: startSec + (i + 1) / (10 * tokens.length),
                    })).filter(word => word.text !== 'finishes'),
                };
            });
            workspace.store.transcription.replaceSavedTranscript({ version: 1, segments, speakers });
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

export const ExportToObsidian: Story = {
    parameters: { scenario: 'transcript' },
    play: async ({ canvas, canvasElement, loaded }) => {
        const page = within(canvasElement.ownerDocument.body);
        const { adapter } = loaded.workspace as StoryWorkspace;
        const open = spyOn(adapter.obsidian, 'openNote');
        const start = canvas.getByRole('button', { name: 'Export to Obsidian' });
        try {
            await userEvent.click(start);
            const options = within(await page.findByRole('dialog', { name: 'Obsidian export options' }));
            const confirm = options.getByRole('button', { name: 'Export note' });
            await expect(confirm).toBeDisabled();
            await userEvent.click(options.getByRole('button', { name: 'Choose folder' }));
            await expect(await options.findByText('Work / Meetings')).toBeVisible();
            await userEvent.click(options.getByRole('checkbox', { name: 'Timestamped transcript' }));
            await expect(confirm).toBeDisabled();
            await userEvent.click(options.getByRole('checkbox', { name: 'Plain text' }));
            await userEvent.click(confirm);
            await expect(await page.findByRole('button', { name: 'Open in Obsidian' })).toBeVisible();
            await expect(open).not.toHaveBeenCalled();

            await userEvent.click(start);
            const repeat = within(await page.findByRole('dialog', { name: 'Already exported' }));
            await waitFor(() => expect(repeat.getByRole('button', { name: 'Save new copy' })).toBeVisible());
            await userEvent.click(repeat.getByRole('button', { name: 'Open in Obsidian' }));
            await expect(open).toHaveBeenCalledTimes(1);
        } finally {
            open.mockRestore();
        }
    },
};

export const LongSpeakerReading: Story = {
    parameters: { longReading: true },
    render: () => <div style={{ width: 1024 }}><Home /></div>,
    play: async ({ canvas, canvasElement }) => {
        await userEvent.click(canvas.getByRole('radio', { name: 'Speakers' }));
        const opening = canvas.getByRole('button', { name: 'Opening · Alice' });
        const first = opening.closest('p')!;
        const last = first.parentElement!.querySelector<HTMLParagraphElement>('p:last-child')!;
        const document = canvasElement.ownerDocument;
        const selection = document.getSelection()!;
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

        const search = canvas.getByRole('textbox', { name: 'Search transcript' });
        await userEvent.type(search, 'beacon');
        await expect(canvas.getByRole('status')).toHaveTextContent('1 of 2');
        await userEvent.keyboard('{Enter}');
        await expect(canvas.getByRole('status')).toHaveTextContent('2 of 2');
        await waitFor(async () => {
            const word = within(last).getByRole('button', { name: 'beacon · Alice' });
            await expect(word.querySelector('mark')).toHaveAttribute('data-active', 'true');
            const rect = word.getBoundingClientRect();
            await expect(word.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))).toBe(true);
        });
        await userEvent.click(canvas.getByRole('button', { name: 'Previous search result' }));
        await waitFor(() => expect(within(first).getByRole('button', { name: 'beacon · Alice' }).querySelector('mark')).toHaveAttribute('data-active', 'true'));
        await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));

        // Dispatch in the same frame as the scrollbar jump, before observer delivery.
        const clickAfterJump = async (text: string, start = 0, length = text.length) => {
            first.scrollIntoView({ block: 'start' });
            await frame();
            await frame();
            const match = last.textContent?.indexOf(text) ?? -1;
            if (match === -1) throw new Error('The end of the transcript is missing.');
            // Nearby words may already be expanded into separate text nodes.
            const boundaryAt = (position: number) => {
                const cursor = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
                let offset = position;
                for (let node = cursor.nextNode(); node; node = cursor.nextNode()) {
                    const size = node.textContent?.length ?? 0;
                    if (offset <= size) return { node, offset };
                    offset -= size;
                }
                throw new Error('The text position is outside the transcript.');
            };
            const from = boundaryAt(match + start);
            const to = boundaryAt(match + start + length);
            const range = document.createRange();
            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);
            last.scrollIntoView({ block: 'end' });
            const rect = range.getBoundingClientRect();
            const point = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true };
            const target = document.elementFromPoint(point.clientX, point.clientY)!;
            target.dispatchEvent(new PointerEvent('pointerdown', point));
            target.dispatchEvent(new PointerEvent('pointerup', point));
            target.dispatchEvent(new MouseEvent('click', { ...point, detail: 1 }));
            await frame();
        };
        await clickAfterJump('Closing beacon', 'Closing'.length, 1);
        await expect(last.querySelector('[aria-current="true"]')).toBeNull();
        await clickAfterJump('finishes');
        await expect(last.querySelector('[aria-current="true"]')).toBeNull();
        await clickAfterJump('Closing');
        await expect(within(last).getByRole('button', { name: 'Closing \u00b7 Alice' })).toHaveAttribute('aria-current', 'true');
        first.scrollIntoView({ block: 'start' });
        await frame();
        await frame();
        try {
            selection.setBaseAndExtent(opening.firstChild!, 0, last, last.childNodes.length);
            const selected = selection.toString();
            await expect(selected).toContain('Opening beacon');
            await expect(selected).toContain('Section 60');
            await expect(selected).toContain('Closing beacon finishes the conversation.');
            last.scrollIntoView({ block: 'end' });
            await frame();
            await frame();
            await expect(selection.toString()).toBe(selected);
        } finally {
            selection.removeAllRanges();
        }

        first.scrollIntoView({ block: 'start' });
        await frame();
        await frame();
        // Keyboard users can enter an offscreen paragraph and continue from its first timed word.
        last.querySelector<HTMLElement>('[tabindex="0"]')!.focus();
        const entry = document.activeElement;
        await expect(last.contains(entry)).toBe(true);
        await expect(entry).toHaveRole('button');
        await userEvent.keyboard('{ArrowRight}');
        await expect(last.contains(document.activeElement)).toBe(true);
        await expect(document.activeElement).not.toBe(entry);
    },
};

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
