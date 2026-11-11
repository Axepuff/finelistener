import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Home } from '../Home';
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
