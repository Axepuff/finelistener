import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Home } from '../Home';
import { createStoryWorkspace, type WorkspaceScenario, type StoryWorkspace } from './storyWorkspace';
import { StoryWorkspaceProvider } from './StoryWorkspaceProvider';

const meta = {
    title: 'Workspace/Settings', component: Home,
    loaders: [async ({ parameters }) => ({ workspace: await createStoryWorkspace(parameters.scenario as WorkspaceScenario) })],
    decorators: [(Story, { loaded }) => <StoryWorkspaceProvider workspace={loaded.workspace as StoryWorkspace}><Story /></StoryWorkspaceProvider>],
    parameters: { scenario: 'settings-models', docs: { description: { component: 'Real Settings with isolated adapter fixtures. Download progress and errors are illustrative; no model or user file is downloaded.' } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ModelCards: Story = {
    play: async ({ canvas, canvasElement }) => {
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        await expect(settings.getByText('00:12 · 16 kHz · mono')).toBeVisible();
        await userEvent.click(settings.getByRole('button', { name: 'Download Large' }));
        await waitFor(() => expect(settings.getByRole('alert')).toHaveTextContent('Check your connection'));
        await expect(settings.getByRole('radio', { name: 'Base' })).toBeChecked();
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
        await expect(within(canvasElement.ownerDocument.body).queryByRole('dialog')).not.toBeInTheDocument();
        await userEvent.click(settings.getByRole('button', { name: 'Retry download Large' }));
        await waitFor(() => expect(settings.queryByRole('alert')).not.toBeInTheDocument());
        const large = settings.getByRole('radio', { name: 'Large' });
        large.focus();
        await userEvent.keyboard(' ');
        await expect(large).toBeChecked();
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
        await userEvent.click(settings.getByRole('button', { name: 'Use a local model file instead' }));
        await expect(settings.getByText('custom.bin')).toBeVisible();
        await expect(large).not.toBeChecked();
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
        await userEvent.click(settings.getByRole('radio', { name: 'Small' }));
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeDisabled();
        await expect(settings.getByText('Download the selected model to transcribe.')).toBeVisible();
        const advanced = settings.getByRole('button', { name: 'Advanced settings' });
        advanced.focus();
        await userEvent.keyboard('{Enter}');
        await expect(advanced).toHaveAttribute('aria-expanded', 'true');
        await expect(settings.getByRole('textbox', { name: 'Max context' })).toBeVisible();
        await expect(settings.getByRole('textbox', { name: 'Max segment length' })).toBeVisible();
        await expect(settings.getByRole('checkbox', { name: 'Split on words' })).toBeChecked();
        await expect(settings.getByRole('checkbox', { name: 'Use voice activity detection' })).toBeChecked();
        await expect(settings.getByRole('checkbox', { name: 'Reduce speaker bleed in microphone transcription' })).toBeChecked();
        await userEvent.click(advanced);
    },
};
export const CancelDownload: Story = {
    parameters: { scenario: 'settings-downloading' },
    play: async ({ canvas }) => {
        const settings = within(canvas.getByRole('complementary', { name: 'Transcription settings' }));
        await expect(settings.getByText('Downloading… 38%')).toBeVisible();
        await expect(settings.getByRole('radio', { name: 'Small' })).toBeDisabled();
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeDisabled();
        await expect(settings.getByText('The selected model is downloading.')).toBeVisible();
        await userEvent.click(settings.getByRole('button', { name: 'Cancel download' }));
        await waitFor(() => expect(settings.getByRole('button', { name: 'Download Large' })).toBeEnabled());
        await expect(settings.queryByRole('alert')).not.toBeInTheDocument();
        await userEvent.click(settings.getByRole('radio', { name: 'Base' }));
        await expect(settings.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
    },
};
export const Failed: Story = { parameters: { scenario: 'settings-failed' } };

export const Downloading: Story = { parameters: { scenario: 'settings-downloading' } };
