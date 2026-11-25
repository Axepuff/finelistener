import { createHash } from 'crypto';
import fs from 'fs/promises';
import https from 'https';
import { tmpdir } from 'os';
import path from 'path';
import { app, type IpcMain } from 'electron';
import { expect, it, vi } from 'vitest';
import { registerSpeakerController } from '../../../electron/src/controllers/speakerController';
import { NEMOTRON_COMPONENT, NEMOTRON_RUNTIMES } from '../../../electron/src/services/NemotronDiarizer';
import type { SessionsService } from '../../../electron/src/services/SessionsService';
import type { SpeakerAssetStatus } from '../../../electron/src/types/transcription';
import { SpeakerAnalysisStore } from './speakerAnalysisStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: vi.fn() } }));
vi.mock('../../../electron/src/services/NemotronDiarizer', async (original) => {
    const module = await original<typeof import('../../../electron/src/services/NemotronDiarizer')>();
    return { ...module, NEMOTRON_COMPONENT: { ...module.NEMOTRON_COMPONENT,
        model: 'model/diarization.gguf',
        modelSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' },
        inspectNemotron: vi.fn(() => Promise.resolve({ gpuAvailable: false })) };
});

// A tiny ZIP with regular runtime, model and license files; extraction stays real.
const archive = Buffer.from('UEsDBBQAAAAAAAAAIQAMfn/YBAAAAAQAAAATAAAAYmluL25lbW8tc3BlZWNoLmV4ZXRlc3RQSwMEFAAAAAAAAAAhAAx+f9gEAAAABAAAABYAAABtb2RlbC9kaWFyaXphdGlvbi5nZ3VmdGVzdFBLAwQUAAAAAAAAACEADH5/2AQAAAAEAAAAFQAAAG5vdGljZXMvbW9kZWwtTElDRU5TRXRlc3RQSwECFAMUAAAAAAAAACEADH5/2AQAAAAEAAAAEwAAAAAAAAAAAAAApIEAAAAAYmluL25lbW8tc3BlZWNoLmV4ZVBLAQIUAxQAAAAAAAAAIQAMfn/YBAAAAAQAAAAWAAAAAAAAAAAAAACkgTUAAABtb2RlbC9kaWFyaXphdGlvbi5nZ3VmUEsBAhQDFAAAAAAAAAAhAAx+f9gEAAAABAAAABUAAAAAAAAAAAAAAKSBbQAAAG5vdGljZXMvbW9kZWwtTElDRU5TRVBLBQYAAAAAAwADAMgAAACkAAAAAAA=', 'base64');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

const repairFailures = ['a corrupt bundle', 'a file blocking the cache directory'];
it.skipIf(process.platform !== 'win32').each(repairFailures)('clears and restores readiness when %s prevents repair', async (failure) => {
    const corruptBundle = failure === 'a corrupt bundle';
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-bundle-'));
    const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    const network = vi.spyOn(https, 'get').mockImplementation(() => { throw new Error('Network is offline'); });
    const data = path.join(directory, 'user-data');
    const cache = path.join(data, 'nemotron');
    vi.spyOn(app, 'getPath').mockReturnValue(data);
    Object.defineProperty(process, 'resourcesPath', { value: directory, configurable: true });
    const bundle = path.join(directory, 'nemotron');
    const bundledArchive = path.join(bundle, 'component.zip');
    const runtime = NEMOTRON_RUNTIMES['win-x64-gpu'];
    const entry = { bytes: 4, sha256: hash('test') };
    const manifest = {
        version: NEMOTRON_COMPONENT.version, variant: 'win-x64-gpu',
        url: `https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/finelistener-${NEMOTRON_COMPONENT.version}-win-x64-gpu.zip`,
        bytes: archive.length, sha256: hash(archive), executable: runtime.executable,
        model: NEMOTRON_COMPONENT.model, modelRevision: NEMOTRON_COMPONENT.modelRevision,
        runtimeRevision: runtime.revision, runtimeSha256: runtime.sha256,
        files: { [runtime.executable]: entry, [NEMOTRON_COMPONENT.model]: entry, 'notices/model-LICENSE': entry },
    };
    const handlers = new Map<string, () => Promise<SpeakerAssetStatus>>();
    const ipc = { handle: (channel: string, handler: () => Promise<SpeakerAssetStatus>) => {
        handlers.set(channel, handler);
    } } as unknown as IpcMain;
    registerSpeakerController(ipc, () => null, {} as SessionsService, () => false);
    const getSpeakerAssets = vi.fn(() => handlers.get('sessions:get-speaker-assets')!());
    const { adapter } = createFakeRendererAdapter({ getSpeakerAssets });
    const store = new SpeakerAnalysisStore(adapter);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
        await fs.mkdir(bundle);
        await fs.writeFile(path.join(bundle, 'component.json'), JSON.stringify(manifest));
        await fs.writeFile(bundledArchive, archive);
        await store.refreshAssets();
        expect(store.componentReady).toBe(true);
        const [installed] = await fs.readdir(cache);
        const model = path.join(cache, installed, manifest.model);
        expect(await fs.readFile(model, 'utf8')).toBe('test');

        if (corruptBundle) {
            await fs.writeFile(model, 'bad!');
            await fs.utimes(model, 0, 0);
            await fs.writeFile(bundledArchive, 'corrupt');
        } else {
            await fs.rename(cache, path.join(data, 'nemotron-backup'));
            await fs.writeFile(cache, 'blocking file');
        }
        await store.refreshAssets();
        expect.soft(store.componentReady).toBe(false);
        await expect.soft(getSpeakerAssets.mock.results.at(-1)?.value)
            .rejects.toMatchObject({ message: 'SPEAKER_ASSETS_UNAVAILABLE' });
        expect(store.assets?.downloadBytes).toBe(archive.length);

        if (corruptBundle) {
            expect(await fs.readdir(cache)).toEqual([installed]);
            await fs.writeFile(bundledArchive, archive);
        } else {
            expect(await fs.readFile(cache, 'utf8')).toBe('blocking file');
            await fs.unlink(cache);
        }
        await store.refreshAssets();
        expect(store.componentReady).toBe(true);
        expect(await fs.readFile(model, 'utf8')).toBe('test');
        expect(network).not.toHaveBeenCalled();
    } finally {
        store.dispose();
        network.mockRestore();
        if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources);
        else Reflect.deleteProperty(process, 'resourcesPath');
        await fs.rm(directory, { recursive: true, force: true });
    }
});
