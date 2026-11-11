import { Paper } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { SystemAudioRecorder } from '@~/recorder';
import { createStoryWorkspace, type WorkspaceScenario, type StoryWorkspace } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Recording/Controls',
    component: SystemAudioRecorder,
    tags: ['autodocs'],
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => (
        <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}>
            <Paper p={16} m={16} maw={360}><Story /></Paper>
        </StoryWorkspaceProvider>
    )],
    parameters: {
        scenario: 'recording-ready',
        docs: { description: { component: 'Windows recording controls with fixture devices and levels. Start and stop simulate capture without accessing microphones or system audio.' } },
    },
} satisfies Meta<typeof SystemAudioRecorder>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
    play: async ({ canvas }) => {
        await userEvent.click(canvas.getByRole('button', { name: 'Start recording' }));
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Stop recording' })).toBeEnabled());
        await userEvent.click(canvas.getByRole('button', { name: 'Stop recording' }));
        await waitFor(() => expect(canvas.getByRole('button', { name: 'Start recording' })).toBeEnabled());
    },
};
export const Recording: Story = { parameters: { scenario: 'recording' } };
export const DeviceError: Story = { parameters: { scenario: 'recording-error', docs: { description: { story: 'An intentional device failure demonstrates the recorder error state and its expected developer log.' } } } };
