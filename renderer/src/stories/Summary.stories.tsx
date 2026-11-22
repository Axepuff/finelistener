import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SummaryGenerationResult } from 'electron/src/types/sessions';
import { observer } from 'mobx-react-lite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { Player } from '../features/player';
import { TranscribedText } from '../features/transcribed-text';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';
import { stoppedSummaryOptions } from './storySummary';

const meta = {
    title: 'Workspace/Summary',
    component: Home,
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'summary-ready' },
} satisfies Meta<typeof Home>;

export default meta;
type Story = StoryObj<typeof meta>;
type Play = NonNullable<Story['play']>;

const openSummary: Play = async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('radio', { name: 'Summary' }));
};
const openDetailed: Play = async (context) => {
    await openSummary(context);
    await userEvent.click(await context.canvas.findByRole('tab', { name: 'Detailed notes' }));
};
const PanelPreview: React.FC<{ width: 440 | 780; children: React.ReactNode }> = ({ width, children }) => <>
    <section aria-label="Audio player" style={{ maxWidth: 780, overflowX: 'auto' }}><Player /></section>
    <div style={{ width: `min(100%, ${width}px)`, height: 600 }}>{children}</div>
</>;
const panel = (width: 440 | 780): NonNullable<Story['render']> =>
    () => <PanelPreview width={width}><TranscribedText /></PanelPreview>;

export const NeedsTranscript: Story = {
    parameters: { scenario: 'ready' },
    play: async (context) => {
        await openSummary(context);
        await expect(context.canvas.getByText('Transcribe this recording to generate a summary.')).toBeVisible();
        await expect(context.canvas.queryByRole('button', { name: /^Download model/ })).not.toBeInTheDocument();
    },
};

export const IncompleteTranscript: Story = {
    parameters: { scenario: 'summary-incomplete' },
    play: async (context) => {
        await openSummary(context);
        await expect(context.canvas.getByText('Complete the transcription before generating a summary.')).toBeVisible();
        await expect(context.canvas.queryByRole('button', { name: 'Generate summary' })).not.toBeInTheDocument();
    },
};

export const DownloadRequired: Story = { parameters: { scenario: 'summary-install' }, play: openSummary };
export const Downloading: Story = { parameters: { scenario: 'summary-downloading' }, play: openSummary };
export const DownloadFailed: Story = { parameters: { scenario: 'summary-download-error' }, play: openSummary };
export const DiskFull: Story = { parameters: { scenario: 'summary-disk-full' }, play: openSummary };
export const Ready: Story = { play: openSummary };

export const CancelThenRetryDownload: Story = {
    parameters: { scenario: 'summary-downloading' },
    play: async (context) => {
        const { canvas } = context;
        await openSummary(context);
        await userEvent.click(await canvas.findByRole('button', { name: 'Cancel download' }));
        await expect(canvas.getByText('Summary model download stopped at 61%')).toBeVisible();
        await expect(canvas.getByText('1.52 / 2.50 GB')).toBeVisible();
        await expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeDisabled();
        await userEvent.click(canvas.getByRole('button', { name: 'Retry download' }));
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled());
        await expect(canvas.queryByRole('tabpanel')).not.toBeInTheDocument();
    },
};

export const DownloadThenGenerate: Story = {
    parameters: { scenario: 'summary-install' },
    play: async (context) => {
        const { canvas, loaded } = context;
        await openSummary(context);
        const generate = canvas.getByRole('button', { name: 'Generate summary' });
        const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
        await expect(generate).toBeDisabled();
        await expect(prompt).toBeEnabled();
        await userEvent.click(await canvas.findByRole('button', { name: 'Download model · 2.50 GB' }));
        await waitFor(() => expect(generate).toBeEnabled());
        await expect(canvas.queryByRole('tabpanel')).not.toBeInTheDocument();
        await userEvent.clear(prompt);
        await expect(generate).toBeDisabled();
        const instruction = 'Describe how the speakers listen to recordings.';
        await userEvent.type(prompt, instruction);
        await userEvent.click(generate);
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toHaveTextContent('pilot a new search list');
        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
        await (loaded.workspace as StoryWorkspace).store.openSession('storybook-session');
        await openSummary(context);
        await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue(instruction);
        await expect(canvas.getByText('Chunks used: 2')).toBeVisible();
    },
};

export const PromptTooLong: Story = {
    play: async (context) => {
        const { canvas, loaded } = context;
        const { adapter } = loaded.workspace as StoryWorkspace;
        const reply = Promise.withResolvers<SummaryGenerationResult>();
        const generateSummary = adapter.generateSummary;
        adapter.generateSummary = () => {
            adapter.generateSummary = generateSummary;
            return reply.promise;
        };
        const longPrompt = 'Explain each topic with examples and quote the original passage in full. '.repeat(42);
        const message = 'The prompt is too long for the available context. Shorten it and try again.';
        await openSummary(context);
        const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
        await userEvent.clear(prompt);
        await userEvent.paste(longPrompt);
        await waitFor(async () => expect(await canvas.findByRole('button', { name: 'Generate summary' })).toBeEnabled());
        await userEvent.click(canvas.getByRole('button', { name: 'Generate summary' }));
        await canvas.findByRole('button', { name: 'Stop generation' });
        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
        await openSummary(context);
        await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue(longPrompt);
        reply.resolve({ ok: false, reason: 'prompt-too-long' });
        await expect(await canvas.findByText(message)).toBeVisible();
        await expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeDisabled();

        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
        await openSummary(context);
        const reopenedPrompt = canvas.getByRole('textbox', { name: 'Prompt' });
        await expect(reopenedPrompt).toHaveValue(longPrompt);
        await expect(reopenedPrompt).toHaveAttribute('aria-invalid', 'true');
        await expect(reopenedPrompt).toHaveAccessibleDescription(message);
        await userEvent.clear(reopenedPrompt);
        await userEvent.paste('Summarize the decisions.');
        await expect(canvas.queryByText(message)).not.toBeInTheDocument();
        await expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
        await userEvent.clear(reopenedPrompt);
        await userEvent.paste(longPrompt);
        await expect(canvas.getByRole('button', { name: 'Generate summary' })).toBeDisabled();
    },
};

export const Generating: Story = {
    parameters: { scenario: 'summary-generating' },
    play: async (context) => {
        await openSummary(context);
        await userEvent.click(await context.canvas.findByRole('button', { name: 'Generate summary' }));
        await expect(await context.canvas.findByRole('button', { name: 'Stop generation' })).toBeEnabled();
        await expect(context.canvas.getByText('Reviewing chunk 2 of 2…')).toBeVisible();
    },
};

const StoppedPanel: React.FC<{ store: StoryWorkspace['store'] }> = observer(({ store }) => (
    <PanelPreview width={780}>
        <TranscribedText summaryContinuation={store.summary.stopped ? {
            options: stoppedSummaryOptions,
            onContinue: () => { void store.generateSummary(stoppedSummaryOptions); },
        } : undefined} />
    </PanelPreview>
));
const continuedPanel: NonNullable<Story['render']> = (_args, { loaded }) =>
    <StoppedPanel store={(loaded.workspace as StoryWorkspace).store} />;

const stopGeneration: Play = async (context) => {
    const { canvas } = context;
    await openSummary(context);
    const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
    await userEvent.clear(prompt);
    await userEvent.type(prompt, stoppedSummaryOptions.prompt);
    await userEvent.click(await canvas.findByRole('button', { name: 'Generate summary' }));
    await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
    await openSummary(context);
    await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue(stoppedSummaryOptions.prompt);
    await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toBeDisabled();
    await userEvent.click(await canvas.findByRole('button', { name: 'Stop generation' }));
    await expect(await canvas.findByText('Summary generation stopped.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Continue' })).toBeEnabled();
};

export const Stopped: Story = {
    parameters: { scenario: 'summary-cancel' }, render: continuedPanel, play: stopGeneration,
};

export const ContinueStoppedGeneration: Story = {
    ...Stopped,
    play: async (context) => {
        await stopGeneration(context);
        const { canvas } = context;
        const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
        await userEvent.type(prompt, ' Include examples.');
        await expect(canvas.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
        await userEvent.clear(prompt);
        await userEvent.type(prompt, stoppedSummaryOptions.prompt);
        await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
    },
};

export const GenerationFailed: Story = {
    parameters: { scenario: 'summary-error' },
    play: async (context) => {
        await openSummary(context);
        await userEvent.click(await context.canvas.findByRole('button', { name: 'Generate summary' }));
        const error = await context.canvas.findByRole('alert');
        await expect(error).toHaveTextContent('Could not generate the summary.');
        await expect(within(error).getByRole('button', { name: 'Generate summary' })).toBeEnabled();
    },
};

export const DetailedOnly: Story = {
    parameters: { scenario: 'summary-partial' },
    play: async (context) => {
        await openSummary(context);
        await expect(await context.canvas.findByRole('tabpanel', { name: 'Detailed notes' })).toBeVisible();
        await expect(await context.canvas.findByRole('button', { name: 'Generate brief summary' })).toBeEnabled();
        await userEvent.click(context.canvas.getByRole('button', { name: 'Edit prompt' }));
        await userEvent.type(context.canvas.getByRole('textbox', { name: 'Prompt' }), ' Keep examples.');
        await expect(context.canvas.getByRole('button', { name: 'Generate summary' })).toBeEnabled();
    },
};

export const SavedShortBrief: Story = {
    parameters: { scenario: 'summary-short' }, render: panel(780), play: openSummary,
};
export const SavedShortDetailed: Story = {
    ...SavedShortBrief, play: openDetailed,
};
export const SavedLongBrief: Story = { parameters: { scenario: 'summary-long' }, play: openSummary };
export const SavedLongDetailed: Story = { ...SavedLongBrief, play: openDetailed };

export const SavedWithoutModel: Story = {
    parameters: { scenario: 'summary-saved' },
    play: async (context) => {
        const { canvas } = context;
        await openSummary(context);
        await expect(await canvas.findByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
        await userEvent.click(canvas.getByRole('tab', { name: 'Detailed notes' }));
        await expect(canvas.getByRole('tabpanel', { name: 'Detailed notes' })).toHaveTextContent('pilot the new search list on Friday');
        await expect(canvas.queryByRole('button', { name: /^Download model/ })).not.toBeInTheDocument();
    },
};

export const RegenerateSavedSummary: Story = {
    parameters: { scenario: 'summary-saved' },
    play: async (context) => {
        const { canvas } = context;
        await openSummary(context);
        const brief = await canvas.findByRole('tabpanel', { name: 'Brief overview' });
        await userEvent.click(canvas.getByRole('button', { name: 'Regenerate summary' }));
        await expect(brief).toBeVisible();
        await userEvent.click(await canvas.findByRole('button', { name: /^Download model/ }));
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Regenerate summary' })).toBeEnabled());
        const prompt = canvas.getByRole('textbox', { name: 'Prompt' });
        const instruction = 'Use two paragraphs.';
        await userEvent.clear(prompt);
        await userEvent.type(prompt, instruction);
        await userEvent.click(canvas.getByRole('button', { name: 'Regenerate summary' }));
        await userEvent.click(canvas.getByRole('radio', { name: 'Text' }));
        await (context.loaded.workspace as StoryWorkspace).store.openSession('storybook-session');
        await openSummary(context);
        await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveValue(instruction);
        await expect(canvas.getByRole('tabpanel', { name: 'Brief overview' })).toBeVisible();
    },
};

export const LegacySaved: Story = {
    parameters: { scenario: 'summary-legacy' },
    play: async (context) => {
        await openDetailed(context);
        const { canvas } = context;
        await expect(canvas.getByRole('tabpanel', { name: 'Detailed notes' })).toHaveTextContent('pilot the new search list on Friday');
        await expect(canvas.queryByText(/Generated|Chunks used/)).not.toBeInTheDocument();
        await expect(canvas.queryByRole('button', { name: 'Show source' })).not.toBeInTheDocument();
    },
};

export const NarrowDetailed: Story = {
    parameters: { scenario: 'summary-long' }, render: panel(440),
    play: async (context) => {
        const { canvas } = context;
        await openSummary(context);
        await canvas.findByRole('tabpanel', { name: 'Brief overview' });
        canvas.getByRole('tab', { name: 'Brief overview' }).focus();
        await userEvent.keyboard('{ArrowRight}');
        const detailed = await canvas.findByRole('tabpanel', { name: 'Detailed notes' });
        const chunk = within(detailed).getByRole('article', { name: '00:08 – 00:16' });
        await expect(chunk).toHaveTextContent('Bob');
        await expect(chunk).toHaveTextContent('They agreed to pilot the new search list on Friday.');
        const source = within(chunk).getByRole('button', { name: 'Show source' });
        source.focus();
        await userEvent.keyboard('{Enter}');
        await expect(source).toHaveAttribute('aria-expanded', 'true');
        await expect(source).toHaveFocus();
        await expect(within(chunk).getByText('We’ll pilot on Friday 🎧.')).toBeVisible();
        await expect(chunk).not.toHaveTextContent('Earlier I said Thursday');
        await expect(chunk).not.toHaveTextContent('Has anybody booked');
        await userEvent.click(canvas.getByRole('button', { name: 'Edit prompt' }));
        await expect(canvas.getByRole('textbox', { name: 'Prompt' })).toHaveFocus();
        const region = canvas.getByRole('region', { name: 'Recording summary' });
        await expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth + 1);
        await expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
    },
};
