import { createHash } from 'crypto';
import fs from 'fs/promises';
import https from 'https';
import { tmpdir } from 'os';
import path from 'path';
import { app } from 'electron';
import { expect, it, vi } from 'vitest';
import { NEMOTRON_COMPONENT, NEMOTRON_RUNTIMES } from './NemotronDiarizer';
import { SpeakerDiarizationService } from './SpeakerDiarizationService';

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: vi.fn() } }));
vi.mock('./NemotronDiarizer', async (original) => {
    const module = await original<typeof import('./NemotronDiarizer')>();
    return { ...module, NEMOTRON_COMPONENT: { ...module.NEMOTRON_COMPONENT,
        model: 'model/diarization.gguf',
        modelSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' },
        inspectNemotron: vi.fn(() => Promise.resolve({ gpuAvailable: false })) };
});

// A tiny ZIP with regular runtime, model and license files; extraction stays real.
const archive = Buffer.from('UEsDBBQAAAAAAAAAIQAMfn/YBAAAAAQAAAATAAAAYmluL25lbW8tc3BlZWNoLmV4ZXRlc3RQSwMEFAAAAAAAAAAhAAx+f9gEAAAABAAAABYAAABtb2RlbC9kaWFyaXphdGlvbi5nZ3VmdGVzdFBLAwQUAAAAAAAAACEADH5/2AQAAAAEAAAAFQAAAG5vdGljZXMvbW9kZWwtTElDRU5TRXRlc3RQSwECFAMUAAAAAAAAACEADH5/2AQAAAAEAAAAEwAAAAAAAAAAAAAApIEAAAAAYmluL25lbW8tc3BlZWNoLmV4ZVBLAQIUAxQAAAAAAAAAIQAMfn/YBAAAAAQAAAAWAAAAAAAAAAAAAACkgTUAAABtb2RlbC9kaWFyaXphdGlvbi5nZ3VmUEsBAhQDFAAAAAAAAAAhAAx+f9gEAAAABAAAABUAAAAAAAAAAAAAAKSBbQAAAG5vdGljZXMvbW9kZWwtTElDRU5TRVBLBQYAAAAAAwADAMgAAACkAAAAAAA=', 'base64');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

it.skipIf(process.platform !== 'win32')('prepares a packaged app offline, repairs its cache and rejects a corrupt bundle', async () => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-bundle-'));
    const originalResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    const network = vi.spyOn(https, 'get').mockImplementation(() => { throw new Error('Network is offline'); });
    const data = path.join(directory, 'user-data');
    vi.spyOn(app, 'getPath').mockReturnValue(data);
    Object.defineProperty(process, 'resourcesPath', { value: directory, configurable: true });
    const bundle = path.join(directory, 'nemotron');
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
    try {
        await fs.mkdir(bundle);
        await fs.writeFile(path.join(bundle, 'component.json'), JSON.stringify(manifest));
        await fs.writeFile(path.join(bundle, 'component.zip'), archive);
        const service = new SpeakerDiarizationService();
        expect(await service.getAssetStatus()).toMatchObject({ ready: true });
        const [installed] = await fs.readdir(path.join(data, 'nemotron'));
        const model = path.join(data, 'nemotron', installed, manifest.model);
        expect(await fs.readFile(model, 'utf8')).toBe('test');
        await fs.writeFile(model, 'bad!');
        expect(await service.getAssetStatus()).toMatchObject({ ready: true });
        expect(await fs.readFile(model, 'utf8')).toBe('test');
        await fs.rm(model);
        await fs.writeFile(path.join(bundle, 'component.zip'), 'corrupt');
        await expect(service.getAssetStatus()).rejects.toMatchObject({ code: 'SPEAKER_ASSETS_UNAVAILABLE' });
        expect(await fs.readdir(path.join(data, 'nemotron'))).toEqual([installed]);
        expect(network).not.toHaveBeenCalled();
    } finally {
        network.mockRestore();
        if (originalResources) Object.defineProperty(process, 'resourcesPath', originalResources);
        else Reflect.deleteProperty(process, 'resourcesPath');
        await fs.rm(directory, { recursive: true, force: true });
    }
});
