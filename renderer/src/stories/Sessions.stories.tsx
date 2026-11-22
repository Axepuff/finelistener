import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { createStoryWorkspace, type StoryWorkspace, type WorkspaceScenario } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Sessions', component: Home, tags: ['autodocs'],
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'sessions', docs: { description: { component: 'Real Sessions panel with demo persisted sessions, generated 12-second audio, and isolated file/recovery adapters.' } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Browse: Story = {
    play: async ({ canvas }) => {
        const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
        await expect(panel.getByRole('heading', { name: 'Sessions' })).toBeVisible();
        await expect(panel.getByLabelText('5 sessions')).toHaveTextContent('5');
        await expect(panel.getByRole('region', { name: 'Today' })).toBeVisible();
        await expect(panel.getByRole('region', { name: 'Yesterday' })).toBeVisible();
        await expect(panel.getByRole('region', { name: 'Earlier' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Design discussion.wav' })).toHaveAttribute('aria-current', 'true');
        await userEvent.type(panel.getByRole('searchbox', { name: 'Search sessions' }), 'INTERVIEW');
        await expect(panel.getByRole('button', { name: 'Customer interview' })).toBeVisible();
        await waitFor(() => expect(panel.queryByRole('button', { name: 'Weekly sync' })).not.toBeInTheDocument());
        panel.getByRole('button', { name: 'Customer interview' }).focus();
        await userEvent.keyboard('{Enter}');
        await waitFor(() => expect(panel.getByRole('button', { name: 'Customer interview' })).toHaveAttribute('aria-current', 'true'));
        await userEvent.click(panel.getByRole('button', { name: 'Clear session search' }));
        await expect(panel.getByRole('searchbox', { name: 'Search sessions' })).toHaveFocus();
        await userEvent.type(panel.getByRole('searchbox', { name: 'Search sessions' }), 'not present');
        await waitFor(() => expect(panel.getByText('No sessions match your search.')).toBeVisible());
        await userEvent.click(panel.getByRole('button', { name: 'Clear session search' }));
    },
};

export const DeleteSession: Story = {
    play: async ({ canvas, canvasElement }) => {
        const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
        const page = within(canvasElement.ownerDocument.body);
        const row = panel.getByRole('button', { name: 'Customer interview' }).parentElement!;
        const confirm = spyOn(window, 'confirm').mockReturnValue(false);
        try {
            await userEvent.click(within(row).getByRole('button', { name: 'Session actions' }));
            await waitFor(() => expect(page.getByRole('menuitem', { name: 'Delete session' })).toBeVisible());
            await userEvent.click(page.getByRole('menuitem', { name: 'Delete session' }));
            await waitFor(() => expect(page.queryByRole('menuitem', { name: 'Delete session' })).not.toBeInTheDocument());
            await expect(panel.getByRole('button', { name: 'Customer interview' })).toBeVisible();
            confirm.mockReturnValue(true);
            await userEvent.click(within(row).getByRole('button', { name: 'Session actions' }));
            await waitFor(() => expect(page.getByRole('menuitem', { name: 'Delete session' })).toBeVisible());
            await userEvent.click(page.getByRole('menuitem', { name: 'Delete session' }));
            await waitFor(() => expect(panel.queryByRole('button', { name: 'Customer interview' })).not.toBeInTheDocument());
            await expect(panel.getByLabelText('4 sessions')).toHaveTextContent('4');
            await expect(panel.getByRole('searchbox', { name: 'Search sessions' })).toHaveFocus();
        } finally { confirm.mockRestore(); }
    },
};

export const Empty: Story = { parameters: { scenario: 'sessions-empty' } };
export const SpeakerEdits: Story = { parameters: { scenario: 'sessions-speaker-edit', docs: { description: { story: 'A merge through the public AppStore service boundary updates the rendered sidebar and preserves player state before clearing the workspace.' } } }, play: async ({ canvas, loaded }) => {
    const { store } = loaded.workspace as StoryWorkspace;
    const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Play audio' })).toBeEnabled());
    await expect(within(panel.getByRole('region', { name: 'Yesterday' })).getByRole('button', { name: 'Design discussion.wav' })).toHaveAccessibleDescription('00:12 · 3 speakers');
    await userEvent.click(canvas.getByRole('radio', { name: 'Timecodes' }));
    await userEvent.click(canvas.getByText('[00:00:04 - 00:00:08]'));
    await userEvent.click(canvas.getByRole('button', { name: 'Mark start' }));
    await userEvent.click(canvas.getByText('[00:00:08 - 00:00:12]'));
    await userEvent.click(canvas.getByRole('button', { name: 'Mark end' }));
    await expect((await store.mergeSpeakers('alice', 'bob')).ok).toBe(true);
    await waitFor(() => expect(within(panel.getByRole('region', { name: 'Today' })).getByRole('button', { name: 'Design discussion.wav' })).toHaveAccessibleDescription('00:12 · 2 speakers'));
    await expect(canvas.getByLabelText('Current position: 00:08.00 / 00:12.00')).toBeVisible();
    await expect(canvas.getByText('Segment 00:04.00 — 00:08.00')).toBeVisible();
    await expect(store.clearWorkspace().ok).toBe(true);
    await waitFor(() => expect(within(panel.getByRole('region', { name: 'Today' })).getByRole('button', { name: 'Design discussion.wav' })).toHaveAccessibleDescription('00:12 · 2 speakers'));
    await expect(panel.getByRole('button', { name: 'Design discussion.wav' })).not.toHaveAttribute('aria-current');
} };
export const UnfinishedRecording: Story = { parameters: { scenario: 'sessions-recovery' } };
export const DiscardRecording: Story = { parameters: { scenario: 'sessions-recovery' }, play: async ({ canvas, canvasElement }) => {
    const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(panel.getByRole('button', { name: 'Delete' })).toBeEnabled());
    await userEvent.click(panel.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Delete unfinished recording?' })).toBeVisible());
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Delete unfinished recording?' })).not.toBeInTheDocument());
    await expect(panel.getByRole('alert')).toBeVisible();
    await userEvent.click(panel.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Delete unfinished recording?' })).toBeVisible());
    await userEvent.click(page.getByRole('button', { name: 'Delete recording' }));
    await waitFor(() => expect(panel.queryByRole('alert')).not.toBeInTheDocument());
    await expect(panel.getByLabelText('5 sessions')).toHaveTextContent('5');
} };
export const Running: Story = { parameters: { scenario: 'sessions-transcribing' }, play: async ({ canvas }) => {
    const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
    await expect(panel.getByText('Transcribing… 42%')).toBeVisible();
    await expect(panel.getByRole('progressbar', { name: 'Transcription progress' })).toHaveAttribute('aria-valuenow', '42');
} };
export const Recovery: Story = { parameters: { scenario: 'sessions-recovery' }, play: async ({ canvas }) => {
    const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
    await waitFor(() => expect(panel.getByRole('alert')).toHaveTextContent('Unfinished recording'));
    await userEvent.click(panel.getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(panel.queryByRole('alert')).not.toBeInTheDocument());
    await expect(panel.getByRole('button', { name: 'Design discussion.wav' })).toHaveAttribute('aria-current', 'true');
} };
export const RecoveryError: Story = { parameters: { scenario: 'sessions-recovery-error' }, play: async ({ canvas }) => {
    const panel = within(canvas.getByRole('navigation', { name: 'Sessions' }));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Recover' })).toBeEnabled());
    await userEvent.click(panel.getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(panel.getByText('Could not recover the recording.')).toBeVisible());
} };
export const Narrow: Story = { render: () => <div style={{ width: 1024 }}><Home /></div>, play: async ({ canvas }) => {
    const panel = canvas.getByRole('navigation', { name: 'Sessions' });
    const bounds = panel.getBoundingClientRect();
    const title = within(panel).getByRole('button', { name: /^A very long session title/ });
    const text = title.querySelector('.session-row__title')!;
    await expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
    await expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(bounds.right);
    title.focus();
    await userEvent.tab();
    await expect(within(title.parentElement!).getByRole('button', { name: 'Session actions' })).toHaveFocus();
    await expect(within(title.parentElement!).getByRole('button', { name: 'Session actions' })).toBeVisible();
} };
