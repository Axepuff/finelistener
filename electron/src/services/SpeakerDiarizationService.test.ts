import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, it } from 'vitest';
import { AudioPreprocessor } from './AudioPreprocessor';
import { runSpeakerProcess } from './speakerProcess';

const makeWav = (): Buffer => {
    const sampleRate = 16000;
    const samples = sampleRate * 3;
    const wav = Buffer.alloc(44 + samples * 2);
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
    wav.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index += 1) {
        const amplitude = index < sampleRate ? 100 : index < sampleRate * 2 ? 1000 : 200;
        wav.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 400 * index / sampleRate)), 44 + index * 2);
    }
    return wav;
};

it('accepts a doctor warning exit only when explicitly allowed and retains its JSON', async () => {
    const args = ['-e', 'process.stdout.write(JSON.stringify({ devices: ["CPU"] })); process.exitCode = 1'];
    const signal = new AbortController().signal;
    await expect(runSpeakerProcess(process.execPath, args, signal, tmpdir())).rejects.toMatchObject({ exitCode: 1 });
    const result = await runSpeakerProcess(process.execPath, args, signal, tmpdir(), undefined, 1000, false, [0, 1]);
    expect(JSON.parse(result.stdout)).toEqual({ devices: ['CPU'] });
});

it('sends only the selected audio to speaker preparation', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-speaker-range-'));
    const sourcePath = path.join(directory, 'source.wav');
    const preprocessor = new AudioPreprocessor();
    let prepared: Awaited<ReturnType<AudioPreprocessor['prepareAudioSegmentExactly']>> | undefined;
    try {
        await fs.writeFile(sourcePath, makeWav());
        prepared = await preprocessor.prepareAudioSegmentExactly(sourcePath, { start: 1, end: 2 });
        const wav = await fs.readFile(prepared.wavPath);
        const dataOffset = wav.indexOf(Buffer.from('data')) + 8;
        const dataLength = wav.readUInt32LE(dataOffset - 4);
        expect(dataLength).toBe(16000 * 2);
        expect(Math.abs(wav.readInt16LE(dataOffset + 10 * 2))).toBeGreaterThan(500);
    } finally {
        await prepared?.cleanup();
        await fs.rm(directory, { recursive: true, force: true });
    }
});

it('waits for process close after cancellation', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-speaker-abort-'));
    const pidPath = path.join(directory, 'child.pid');
    const controller = new AbortController();
    try {
        const running = runSpeakerProcess(process.execPath, [
            '-e',
            `require('fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000);`,
        ], controller.signal, directory);
        let pid: number | undefined;
        for (let index = 0; index < 100; index += 1) {
            try {
                pid = Number(await fs.readFile(pidPath, 'utf8'));
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        }
        expect(pid).toBeDefined();
        controller.abort();
        await expect(running).rejects.toThrow('Speaker analysis cancelled');
        expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
        controller.abort();
        await fs.rm(directory, { recursive: true, force: true });
    }
}, 10000);
