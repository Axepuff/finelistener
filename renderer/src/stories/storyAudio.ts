import demoAudioUrl from '../../../.storybook/public/demo.wav?url';

export const STORY_AUDIO_PATH = '/storybook/demo.wav';
export const STORY_LONG_AUDIO_PATH = '/storybook/long-demo.wav';

const repeatDemoAudio = async (response: Response): Promise<Response> => {
    const original = new Uint8Array(await response.arrayBuffer());
    // The checked-in mono PCM fixture has a 44-byte WAV header and 12 seconds of samples.
    const headerSize = 44;
    const samples = original.subarray(headerSize);
    const audio = new Uint8Array(headerSize + samples.length * 8);
    audio.set(original.subarray(0, headerSize));
    for (let offset = headerSize; offset < audio.length; offset += samples.length) audio.set(samples, offset);
    const header = new DataView(audio.buffer);
    header.setUint32(4, audio.length - 8, true);
    header.setUint32(40, audio.length - headerSize, true);
    return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } });
};

export const installStoryAudioProtocol = (): void => {
    const browserFetch = globalThis.fetch;

    // Keep the real Electron player while serving only this story-owned virtual path.
    const storyFetch: typeof fetch = (input, init) => {
        if (input === `local-file://${STORY_AUDIO_PATH}`) {
            return browserFetch(demoAudioUrl, init);
        }
        if (input === `local-file://${STORY_LONG_AUDIO_PATH}`) {
            return browserFetch(demoAudioUrl, init).then(repeatDemoAudio);
        }

        return browserFetch(input, init);
    };

    globalThis.fetch = storyFetch;
    import.meta.hot?.dispose(() => { globalThis.fetch = browserFetch; });
};
