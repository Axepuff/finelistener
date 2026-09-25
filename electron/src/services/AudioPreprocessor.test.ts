import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, it } from 'vitest';
import { AudioPreprocessor } from './AudioPreprocessor';

const sampleRate = 16000;

const makeWav = (): Buffer => {
    const sampleCount = sampleRate * 2;
    const wav = Buffer.alloc(44 + sampleCount * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(sampleCount * 2, 40);

    for (let index = 0; index < sampleCount; index += 1) {
        const amplitude = index < sampleRate ? 50 : 500;
        const value = Math.round(amplitude * Math.sin(2 * Math.PI * 400 * index / sampleRate));
        wav.writeInt16LE(value, 44 + index * 2);
    }

    return wav;
};

const rms = (wav: Buffer, startSec: number, endSec: number): number => {
    const dataOffset = wav.indexOf(Buffer.from('data')) + 8;
    let power = 0;
    let count = 0;

    for (let index = startSec * sampleRate; index < endSec * sampleRate; index += 1) {
        const sample = wav.readInt16LE(dataOffset + index * 2);
        power += sample * sample;
        count += 1;
    }

    return Math.sqrt(power / count);
};

it('gates quiet speaker bleed while retaining louder microphone speech and the original timeline', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-gate-test-'));
    const sourcePath = path.join(directory, 'microphone.wav');
    const source = makeWav();
    const preprocessor = new AudioPreprocessor();
    let ungated: Awaited<ReturnType<AudioPreprocessor['convertAudio']>> | undefined;
    let gated: Awaited<ReturnType<AudioPreprocessor['convertAudio']>> | undefined;

    try {
        await fs.writeFile(sourcePath, source);
        ungated = await preprocessor.convertAudio({ audioPath: sourcePath, highPass: undefined, dynanorm: false });
        gated = await preprocessor.convertAudio({ audioPath: sourcePath, highPass: undefined, dynanorm: true, microphoneGate: true });
        const original = await fs.readFile(ungated.path);
        const filtered = await fs.readFile(gated.path);

        expect(filtered.readUInt32LE(filtered.indexOf(Buffer.from('data')) + 4)).toBe(sampleRate * 2 * 2);
        expect(rms(filtered, 0, 0.8)).toBeLessThan(rms(original, 0, 0.8) * 0.1);
        expect(rms(filtered, 1.2, 1.8)).toBeGreaterThan(rms(original, 1.2, 1.8) * 0.8);
        expect(await fs.readFile(sourcePath)).toEqual(source);
    } finally {
        await Promise.all([ungated?.cleanup(), gated?.cleanup()]);
        await fs.rm(directory, { recursive: true, force: true });
    }
});
