import '@mantine/core/styles.css';
import '../renderer/src/theme.css';
import { MantineProvider } from '@mantine/core';
import type { Preview } from '@storybook/react-vite';
import { cssVariablesResolver, mantineTheme } from '../renderer/src/theme';
import { installStoryAudioProtocol } from '../renderer/src/stories/storyAudio';

installStoryAudioProtocol();

const preview: Preview = {
    decorators: [
        (Story) => (
            <MantineProvider forceColorScheme="light" theme={mantineTheme} cssVariablesResolver={cssVariablesResolver}>
                <Story />
            </MantineProvider>
        ),
    ],
    parameters: {
        layout: 'fullscreen',
        controls: { disable: true },
        docs: { story: { inline: false, height: '600px' } },
    },
};

export default preview;
