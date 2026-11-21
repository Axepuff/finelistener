import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { defaultRecordingSummaryOptions } from '../../../electron/src/types/summaryOptions';
import { Home } from '../Home';
import { TranscribedText } from '../features/transcribed-text';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';

const meta = {
    title: 'Workspace/Summary',
    component: Home,
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'summary-ready' },
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;
const openSummary: NonNullable<Story['play']> = async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
};

export const NeedsTranscript: Story = {
    parameters: { scenario: 'ready' },
    play: async (context) => {
        await openSummary(context);
        await expect(context.canvas.getByText('Transcribe this recording to generate a summary.')).toBeVisible();
        await expect(context.canvas.queryByRole('button', { name: 'Download model' })).not.toBeInTheDocument();
    },
};

export const DownloadRequired: Story = { parameters: { scenario: 'summary-install' }, play: openSummary };
export const Downloading: Story = { parameters: { scenario: 'summary-downloading' }, play: openSummary };
export const DownloadFailed: Story = { parameters: { scenario: 'summary-download-error' }, play: openSummary };
export const Ready: Story = { play: openSummary };

export const DownloadThenGenerate: Story = {
    parameters: { scenario: 'summary-install' },
    play: async (context) => {
        const { canvas, loaded } = context;
        await openSummary(context);
        await userEvent.click(await canvas.findByRole('button', { name: 'Download model' }));
        const generate = await canvas.findByRole('button', { name: 'Generate summary' });
        await expect(canvas.queryByRole('tab', { name: 'Brief overview' })).not.toBeInTheDocument();
        const prompt = canvas.getByLabelText('Prompt');
        await userEvent.clear(prompt);
        await expect(generate).toBeDisabled();
        const instruction = 'Describe how the speakers listen to recordings.';
        await userEvent.type(prompt, instruction);
        await userEvent.click(generate);
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent('reopen a recording');
        await userEvent.click(canvas.getByRole('tab', { name: 'Detailed notes' }));
        await expect(canvas.getByRole('tabpanel', { name: 'Detailed notes' })).toHaveTextContent('hear what was said');
        await userEvent.click(canvas.getByRole('radio', { name: 'Plain Text' }));
        await (loaded.workspace as StoryWorkspace).store.openSession('storybook-session');
        await openSummary(context);
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
        await expect(canvas.getByText('Chunks used: 2')).toBeVisible();
        await expect(canvas.getByLabelText('Prompt')).toHaveValue(instruction);
    },
};

export const Generating: Story = {
    parameters: { scenario: 'summary-generating' },
    play: async (context) => {
        await openSummary(context);
        await userEvent.click(await context.canvas.findByRole('button', { name: 'Generate summary' }));
        await expect(await context.canvas.findByRole('button', { name: 'Stop generation' })).toBeEnabled();
    },
};

export const Stopped: Story = {
    parameters: { scenario: 'summary-cancel' },
    play: async (context) => {
        await openSummary(context);
        const { canvas } = context;
        const prompt = canvas.getByLabelText('Prompt');
        const instruction = 'Describe the conversation in two sentences.';
        await userEvent.clear(prompt);
        await userEvent.type(prompt, instruction);
        await userEvent.click(await canvas.findByRole('button', { name: 'Generate summary' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Plain Text' }));
        await openSummary(context);
        await expect(canvas.getByLabelText('Prompt')).toHaveValue(instruction);
        await expect(canvas.getByLabelText('Prompt')).toBeDisabled();
        await userEvent.click(await canvas.findByRole('button', { name: 'Stop generation' }));
        await expect(await canvas.findByText('Summary generation stopped.')).toBeVisible();
        await expect(canvas.getByLabelText('Prompt')).toHaveValue(instruction);
        await expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
    },
};

export const GenerationFailed: Story = {
    parameters: { scenario: 'summary-error' },
    play: async (context) => {
        await openSummary(context);
        await userEvent.click(await context.canvas.findByRole('button', { name: 'Generate summary' }));
        await expect(await context.canvas.findByRole('alert')).toBeVisible();
        await expect(context.canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
    },
};

export const DetailedOnly: Story = {
    parameters: { scenario: 'summary-partial' },
    play: async (context) => {
        await openSummary(context);
        await expect(await context.canvas.findByRole('tabpanel', { name: 'Detailed notes' })).toBeVisible();
        await expect(await context.canvas.findByRole('button', { name: 'Generate brief summary' })).toBeEnabled();
        await userEvent.type(context.canvas.getByLabelText('Prompt'), ' Keep examples.');
        await expect(context.canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
    },
};

export const SavedWithoutModel: Story = {
    parameters: { scenario: 'summary-saved' },
    play: async (context) => {
        await openSummary(context);
        await expect(await context.canvas.findByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
        await expect(context.canvas.queryByRole('button', { name: 'Download model' })).not.toBeInTheDocument();
    },
};

export const RegenerateSavedSummary: Story = {
    parameters: { scenario: 'summary-saved' },
    play: async (context) => {
        const { canvas, loaded } = context;
        await openSummary(context);
        const originalBrief = 'Next week they will test';
        const prompt = 'Describe how the speakers compare ways to find a passage.';
        await expect(canvas.getByLabelText('Prompt')).toHaveValue(prompt);
        await expect(canvas.queryByLabelText('Number of chunks')).not.toBeInTheDocument();
        await expect(canvas.queryByLabelText('Chunk overlap (%)')).not.toBeInTheDocument();
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent(originalBrief);
        await userEvent.click(await canvas.findByRole('button', { name: 'Regenerate summary' }));
        await userEvent.click(await canvas.findByRole('button', { name: 'Download model' }));
        const regenerate = await canvas.findByRole('button', { name: 'Regenerate summary' });
        await expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent(originalBrief);
        await userEvent.click(regenerate);
        await waitFor(() => expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent('reopen a recording'));
        const saved = (loaded.workspace as StoryWorkspace).store.transcription.savedTranscript?.summary;
        await expect(saved?.options).toEqual({ ...defaultRecordingSummaryOptions, prompt });
    },
};

export const NarrowDetailed: Story = {
    parameters: { scenario: 'summary-saved' },
    render: () => <div style={{ width: 'min(100%, 340px)', height: 380 }}><TranscribedText /></div>,
    play: async (context) => {
        const { canvas } = context;
        await openSummary(context);
        canvas.getByRole('tab', { name: 'Brief overview' }).focus();
        await userEvent.keyboard('{ArrowRight}');
        const panel = await canvas.findByRole('tabpanel', { name: 'Detailed notes' });
        await expect(panel).toHaveTextContent('following week');
        const page = canvas.getByRole('region', { name: 'Recording summary' });
        await waitFor(() => expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth + 1));
        await expect(page.scrollHeight).toBeGreaterThan(page.clientHeight);
    },
};
