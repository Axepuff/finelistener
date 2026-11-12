import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { expect, it } from 'vitest';
import { AudioPreprocessor } from './AudioPreprocessor';
import { parseSpeakerIntervals } from './SpeakerDiarizationService';
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

it('parses v1.13.8 CLI intervals relative to a selected range', () => {
    const output = 'progress 100.00%\nStarted\n0.318 -- 6.865 speaker_00\n7.017 -- 10.747 speaker_01\n';
    expect(parseSpeakerIntervals(output, 30, 38)).toEqual([
        { startSec: 0.318, endSec: 6.865, speakerId: 'speaker_00' },
        { startSec: 7.017, endSec: 8, speakerId: 'speaker_01' },
    ]);
    expect(parseSpeakerIntervals(output, 5)).toEqual([
        { startSec: 0, endSec: 1.8650000000000002, speakerId: 'speaker_00' },
        { startSec: 2.0170000000000003, endSec: 5.747, speakerId: 'speaker_01' },
    ]);
});

it('reports split native progress before completion without leaking diagnostic text', async () => {
    const values: number[] = [];
    let observed!: () => void;
    const progress = new Promise<void>((resolve) => { observed = resolve; });
    const controller = new AbortController();
    const running = runSpeakerProcess(process.execPath, ['-e',
        "process.stderr.write('diagnostic 99%\\npro'); setTimeout(() => { process.stderr.write('gress 25.50%\\rprogress 25.90%\\n'); }, 30); setInterval(() => {}, 1000);",
    ], controller.signal, tmpdir(), undefined, (percent) => { values.push(percent); observed(); });
    const rejection = expect(running).rejects.toThrow('Speaker analysis cancelled');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([progress, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('No live progress')), 2000);
        })]);
        expect(values).toEqual([25]);
    } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
        await rejection;
    }
});

it('sends only the selected audio to sherpa preparation', async () => {
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
