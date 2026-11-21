import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SUMMARY_MODEL_FILE, SummaryModelService } from './summaryModel';

const fetch = vi.hoisted(() => vi.fn<typeof globalThis.fetch>());
vi.mock('fs', async (load) => {
    const actual = await load<typeof import('fs')>();
    return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});
vi.mock('electron', () => ({ net: { fetch } }));
vi.mock('../types/summaryModel', async (load) => {
    const actual = await load<typeof import('../types/summaryModel')>();
    return { ...actual, SUMMARY_MODEL_ARTIFACT: {
        ...actual.SUMMARY_MODEL_ARTIFACT, bytes: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    } };
});

let directory: string;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-model-'));
    fetch.mockReset();
});
afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { force: true, recursive: true });
});

it('only transfers weights on request, shares progress, and reopens the installed model offline', async () => {
    const model = path.join(directory, SUMMARY_MODEL_FILE);
    const service = new SummaryModelService(directory, () => {});
    const signal = new AbortController().signal;
    expect((await service.getStatus()).state).toBe('missing');
    await expect(service.requireInstalled(signal)).rejects.toThrow('SUMMARY_MODEL_MISSING');
    expect(fetch).not.toHaveBeenCalled();

    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start: (controller) => { stream = controller; } })));
    const downloads = [service.download(), service.download()];
    stream.enqueue(Buffer.from('a'));
    await vi.waitFor(async () => expect(await service.getStatus()).toMatchObject({ state: 'downloading', downloadedBytes: 1 }));
    await expect(fs.stat(model)).rejects.toMatchObject({ code: 'ENOENT' });
    stream.enqueue(Buffer.from('bc'));
    stream.close();
    expect((await Promise.all(downloads)).map((result) => result.state)).toEqual(['ready', 'ready']);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockReset();
    vi.mocked(createReadStream).mockClear();
    expect(await service.requireInstalled(signal)).toBe(model);
    expect(createReadStream).not.toHaveBeenCalled();
    const restarted = new SummaryModelService(directory, () => {});
    expect(await restarted.requireInstalled(signal)).toBe(model);
    expect((await restarted.getStatus()).state).toBe('ready');
    expect(fetch).not.toHaveBeenCalled();
    const replacement = path.join(directory, 'replacement.gguf');
    await fs.writeFile(replacement, 'bad');
    await fs.rename(replacement, model);
    await expect(service.requireInstalled(signal)).rejects.toThrow('SUMMARY_MODEL_MISSING');
});

it('rejects corrupt on-disk weights and transfers, removes the partial file and accepts a retry', async () => {
    const model = path.join(directory, SUMMARY_MODEL_FILE);
    await fs.writeFile(model, 'bad');
    await fs.writeFile(model + '.partial', 'abandoned');
    const service = new SummaryModelService(directory, () => {});
    expect((await service.getStatus()).state).toBe('missing');
    fetch.mockResolvedValueOnce(new Response('abd')).mockResolvedValueOnce(new Response('abc'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await service.download()).state).toBe('error');
    expect((await service.getStatus()).state).toBe('error');
    await expect(fs.stat(model + '.partial')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.requireInstalled(new AbortController().signal)).rejects.toThrow('SUMMARY_MODEL_MISSING');
    expect((await service.download()).state).toBe('ready');
    expect(await fs.readFile(model, 'utf8')).toBe('abc');
});

it('stops an incomplete transfer on shutdown and allows a new process to retry', async () => {
    const service = new SummaryModelService(directory, () => {});
    fetch.mockResolvedValue(new Response(new ReadableStream({ start: (controller) => controller.enqueue(Buffer.from('a')) })));
    const transfer = service.download();
    await vi.waitFor(async () => expect((await service.getStatus()).downloadedBytes).toBe(1));
    await service.stopAndWait();
    expect((await transfer).state).toBe('missing');
    expect(await fs.readdir(directory)).toEqual([]);
    expect((await service.download()).state).toBe('error');
    fetch.mockResolvedValueOnce(new Response('abc'));
    const restarted = new SummaryModelService(directory, () => {});
    expect((await restarted.download()).state).toBe('ready');
});

it('removes an interrupted run’s prompt at startup and leaves other model-folder files alone', async () => {
    const model = path.join(directory, SUMMARY_MODEL_FILE);
    const leftover = path.join(directory, 'prompt-baee0093-d850-42cb-8143-f53bf7a9ef33.txt');
    await fs.writeFile(model, 'abc');
    await fs.writeFile(leftover, 'A private excerpt');
    await fs.writeFile(path.join(directory, 'prompt-notes.txt'), 'Personal notes');
    const service = new SummaryModelService(directory, () => {});
    await vi.waitFor(async () => {
        expect((await fs.readdir(directory)).sort()).toEqual([SUMMARY_MODEL_FILE, 'prompt-notes.txt'].sort());
    });
    await service.stopAndWait();
});

it('reports insufficient disk space before opening a network transfer', async () => {
    const disk = await fs.statfs(directory, { bigint: true });
    vi.spyOn(fs, 'statfs').mockResolvedValue({ ...disk, bavail: 0n });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new SummaryModelService(directory, () => {});
    expect(await service.download()).toMatchObject({ state: 'error', error: 'disk-space' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
});
