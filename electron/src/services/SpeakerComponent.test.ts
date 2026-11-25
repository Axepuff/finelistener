import fs from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { app } from 'electron';
import { expect, it, vi } from 'vitest';
import { NEMOTRON_COMPONENT, NEMOTRON_RUNTIMES } from './NemotronDiarizer';
import { SpeakerDiarizationService } from './SpeakerDiarizationService';

vi.mock('electron', () => ({ app: {
    isPackaged: false, getAppPath: vi.fn(), getPath: vi.fn(), getVersion: () => '1.6.0-beta.1',
} }));

it.each([
    { platform: 'win32', arch: 'x64', variant: 'win-x64-gpu' },
    { platform: 'win32', arch: 'x64', variant: 'win-x64-cpu' },
    { platform: 'darwin', arch: 'arm64', variant: 'mac-arm64' },
    { platform: 'linux', arch: 'x64', variant: 'mac-arm64' },
] as const)('$platform/$arch ($variant): preserves release compatibility and platform restrictions', async ({ platform, arch, variant }) => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-component-'));
    const runtime = NEMOTRON_RUNTIMES[variant];
    const filename = `finelistener-${NEMOTRON_COMPONENT.version}-${variant}.zip`;
    const url = `https://github.com/Axepuff/finelistener/releases/download/v1.3.0/${filename}`;
    const entry = { bytes: 1, sha256: 'a'.repeat(64) };
    const manifest = {
        version: NEMOTRON_COMPONENT.version, variant, url, bytes: 123, sha256: entry.sha256,
        executable: runtime.executable, model: NEMOTRON_COMPONENT.model,
        modelRevision: NEMOTRON_COMPONENT.modelRevision,
        runtimeRevision: runtime.revision, runtimeSha256: runtime.sha256,
        files: {
            [runtime.executable]: entry,
            [NEMOTRON_COMPONENT.model]: { ...entry, sha256: NEMOTRON_COMPONENT.modelSha256 },
            'notices/model-LICENSE': entry,
        },
    };
    vi.spyOn(app, 'getAppPath').mockReturnValue(directory);
    vi.spyOn(app, 'getPath').mockReturnValue(path.join(directory, 'user-data'));
    vi.stubEnv('BUILD_VARIANT', variant);
    const bundle = path.join(directory, 'build-assets', variant, 'nemotron');
    const service = new SpeakerDiarizationService();
    try {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
        Object.defineProperty(process, 'arch', { value: arch, configurable: true });
        await fs.mkdir(bundle, { recursive: true });
        await fs.writeFile(path.join(bundle, 'component.json'), JSON.stringify(manifest));
        if (platform === 'linux') {
            expect((await service.getAssetStatus()).downloadBytes).toBeUndefined();
            await expect(service.prepareAssets(new AbortController().signal)).rejects.toMatchObject({ code: 'SPEAKER_ASSETS_UNAVAILABLE' });
            return;
        }
        expect(await service.getAssetStatus()).toMatchObject({ ready: false, downloadBytes: 123 });
        for (const override of [
            { url: url.replace('https:', 'http:') },
            { url: url.replace('github.com', 'example.com') },
            { url: url.replace('/Axepuff/', '/other/') },
            { url: url.replace(filename, 'other.zip') },
            { url: url.replace('v1.3.0/', 'v1.3.0/extra/') },
            { url: url.replace('v1.3.0/', '/') },
            { url: url + '?download=1' },
            { url: url + '#fragment' },
            { url: 'invalid' },
            { runtimeRevision: 'incompatible' },
            { runtimeSha256: 'b'.repeat(64) },
            { version: 'nemotron-3-nemo030-q8-r1' },
            { modelRevision: 'incompatible' },
            { files: { ...manifest.files, [manifest.model]: entry } },
        ]) {
            await fs.writeFile(path.join(bundle, 'component.json'), JSON.stringify({ ...manifest, ...override }));
            expect((await service.getAssetStatus()).downloadBytes).toBeUndefined();
            await expect(service.prepareAssets(new AbortController().signal)).rejects.toMatchObject({ code: 'SPEAKER_ASSETS_UNAVAILABLE' });
        }
    } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
        vi.unstubAllEnvs();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
