import demoAudioUrl from '../../../.storybook/public/demo.wav?url';

export const createStoryAudio = async (repetitions: number) => {
    const response = await fetch(demoAudioUrl);
    if (!response.ok) throw new Error('Failed to load the story audio fixture');
    const buffer = await response.arrayBuffer();
    // The checked-in demo has a 44-byte WAV header and 12 seconds of 16 kHz, mono PCM16.
    const headerSize = 44;
    const samples = new Int16Array(buffer, headerSize);
    const peaksPerPass = Math.min(3000, Math.floor(65_536 / repetitions));
    const peaks = new Float32Array(peaksPerPass * repetitions);
    for (let i = 0; i < samples.length; i++) {
        const bucket = Math.floor(i * peaksPerPass / samples.length);
        peaks[bucket] = Math.max(peaks[bucket], Math.abs(samples[i]) / 32768);
    }
    for (let i = 1; i < repetitions; i++) peaks.copyWithin(i * peaksPerPass, 0, peaksPerPass);
    const waveform = { duration: samples.length * repetitions / 16000, peaks };

    if (repetitions === 1) return { url: demoAudioUrl, waveform, dispose: () => {} };

    const header = new DataView(buffer);
    header.setUint32(4, headerSize - 8 + samples.byteLength * repetitions, true);
    header.setUint32(40, samples.byteLength * repetitions, true);
    const sampleBlob = new Blob([samples]);
    const url = URL.createObjectURL(new Blob([buffer.slice(0, headerSize), ...Array<Blob>(repetitions).fill(sampleBlob)], { type: 'audio/wav' }));
    return { url, waveform, dispose: () => URL.revokeObjectURL(url) };
};
