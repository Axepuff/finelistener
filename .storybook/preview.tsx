import '@mantine/core/styles.css';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { MantineProvider } from '@mantine/core';
import type { Preview } from '@storybook/react-vite';
import { mantineTheme } from '../renderer/src/theme';
import { installStoryAudioProtocol } from '../renderer/src/stories/storyAudio';

installStoryAudioProtocol();

const preview: Preview = {
    decorators: [
        (Story) => (
            <MantineProvider forceColorScheme="light" theme={mantineTheme}>
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
