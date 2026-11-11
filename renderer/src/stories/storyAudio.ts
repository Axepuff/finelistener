import demoAudioUrl from '../../../.storybook/public/demo.wav?url';

export const STORY_AUDIO_PATH = '/storybook/demo.wav';

export const installStoryAudioProtocol = (): void => {
    const browserFetch = globalThis.fetch;

    // Keep the real Electron player while serving only this story-owned virtual path.
    const storyFetch: typeof fetch = (input, init) => {
        if (input === `local-file://${STORY_AUDIO_PATH}`) {
            return browserFetch(demoAudioUrl, init);
        }

        return browserFetch(input, init);
    };

    globalThis.fetch = storyFetch;
    import.meta.hot?.dispose(() => { globalThis.fetch = browserFetch; });
};
