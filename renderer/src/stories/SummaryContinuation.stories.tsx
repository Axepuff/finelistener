import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SessionSummary, SessionSummaryDraft } from 'electron/src/types/sessions';
import type { RecordingSummaryOptions } from 'electron/src/types/summaryOptions';
import { expect, spyOn, userEvent } from 'storybook/test';
import { Home } from '../Home';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';
import { createStoryWorkspace, type StoryWorkspace } from './storyWorkspace';
import { stoppedSummaryOptions } from './storySummary';

const checkpointOptions = { ...stoppedSummaryOptions, chunkCount: 4, overlapPercent: 17 };
const meta = {
    title: 'Workspace/Summary integration',
    component: Home,
    loaders: [async ({ parameters }) => {
        const workspace = await createStoryWorkspace(parameters.modelMissing ? 'summary-saved' : 'summary-short');
        const saved = JSON.parse(JSON.stringify(workspace.store.transcription.savedTranscript!.summary)) as SessionSummary;
        // Synthetic validated IPC input; controller/disk continuation is exercised in the integration test.
        const draft: SessionSummaryDraft = { detailed: saved.detailed, inputHash: saved.inputHash,
            model: parameters.incompatibleModel ? 'Different model' : saved.model,
            sourceRevision: saved.sourceRevision!, generationVersion: saved.generationVersion!, options: checkpointOptions,
            reviewedChunks: saved.reviewedChunks!, progress: { version: 1, phase: 'brief',
                cursors: saved.reviewedChunks!.map((_, index) => ({ groupIndex: index, startChar: 0, endChar: 1 })) },
        };
        workspace.store.transcription.setSummaryDraft(draft);
        const requested: Array<RecordingSummaryOptions | undefined> = [];
        const generate = workspace.adapter.generateSummary;
        workspace.adapter.generateSummary = (sessionId, options) => {
            requested.push(options);
            return generate(sessionId, options);
        };
        return { workspace, requested };
    }],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToContinue: Story = {
    play: async ({ canvas }) => {
        await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
        await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled();
    },
};

export const ReopenedCheckpoint: Story = {
    play: async ({ canvas, loaded }) => {
        const workspace = loaded.workspace as StoryWorkspace;
        await expect(workspace.store.summary.stopped).toBe(false);
        await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
        const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
        await expect(prompt).toHaveValue(checkpointOptions.prompt);
        await expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent('pilot a new search list on Friday');
        await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled();
        await userEvent.type(prompt, ' A different request.');
        await expect(canvas.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        await userEvent.clear(prompt);
        await userEvent.paste(checkpointOptions.prompt);
        canvas.getByRole('button', { name: 'Continue' }).focus();
        await userEvent.keyboard('{Enter}');
        await expect(loaded.requested).toEqual([checkpointOptions]);
        await expect(workspace.store.transcription.savedTranscript?.summaryDraft).toBeUndefined();
        await expect(canvas.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        await expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
    },
};

export const CheckpointWithoutModel: Story = {
    parameters: { modelMissing: true },
    play: async ({ canvas, loaded }) => {
        await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
        await expect(canvas.getByRole('button', { name: 'Continue' })).toBeDisabled();
        await expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
        await expect(loaded.requested).toEqual([]);
    },
};

export const IncompatibleModel: Story = {
    parameters: { incompatibleModel: true },
    play: async ({ canvas }) => {
        await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
        await expect(canvas.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        await expect(canvas.getByRole('button', { name: 'Regenerate summary' })).toBeEnabled();
    },
};

export const SelectedOutputActions: Story = {
    play: async ({ canvas, loaded }) => {
        const workspace = loaded.workspace as StoryWorkspace;
        const copy = spyOn(navigator.clipboard, 'write').mockResolvedValue(undefined);
        const save = spyOn(workspace.adapter, 'saveText').mockResolvedValue({ ok: true });
        try {
            await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
            for (const format of ['brief', 'detailed'] as const) {
                if (format === 'detailed') await userEvent.click(canvas.getByRole('tab', { name: 'Detailed notes' }));
                const expected = workspace.store.transcription.savedTranscript!.summary![format];
                await userEvent.click(canvas.getByRole('button', { name: 'Copy summary' }));
                const item = copy.mock.calls.at(-1)![0][0];
                await expect(await (await item.getType('text/plain')).text()).toBe(expected);
                await expect(await (await item.getType('text/html')).text()).toContain(expected);
                await userEvent.click(canvas.getByRole('button', { name: 'Export summary' }));
                await expect(save).toHaveBeenLastCalledWith(expected);
            }
        } finally {
            copy.mockRestore();
            save.mockRestore();
        }
    },
};
