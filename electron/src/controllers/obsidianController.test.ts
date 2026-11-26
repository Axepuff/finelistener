import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerObsidianController } from './obsidianController';
import type { ObsidianApi } from '../types/obsidian';

const desktop = vi.hoisted(() => ({
    profile: '',
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    api: null as { obsidian: ObsidianApi } | null,
    dialog: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    openExternal: vi.fn<(uri: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
    app: { getPath: () => desktop.profile },
    shell: { openExternal: desktop.openExternal },
    dialog: { showOpenDialog: desktop.dialog },
    contextBridge: { exposeInMainWorld: (_key: string, value: typeof desktop.api) => { desktop.api = value; } },
    ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => Promise.resolve(desktop.handlers.get(channel)!(undefined, ...args)),
    },
}));

const register = () => registerObsidianController({
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => desktop.handlers.set(channel, handler),
} as unknown as IpcMain, () => null);

let root: string;
let folder: string;
let api: ObsidianApi;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'finelistener-export-'));
    desktop.profile = path.join(root, 'profile');
    folder = path.join(root, 'Vault', 'Мои встречи');
    await fs.mkdir(folder, { recursive: true });
    desktop.dialog.mockResolvedValue({ canceled: false, filePaths: [folder] });
    desktop.openExternal.mockClear();
    register();
    await import('../../preload.js');
    api = desktop.api!.obsidian;
});

afterEach(async () => { await fs.rm(root, { force: true, recursive: true }); });

it('writes distinct notes, reopens the most recent copy across restarts and protects manual edits after a move', async () => {
    const options = { ...await api.getOptions(), folder: await api.chooseFolder(), plain: true };
    expect(await api.saveOptions(options)).toBe(true);
    const title = 'Планирование.wav';
    const exportMeeting = (newCopy: boolean) => api.exportNote('first-session', title, '# Meeting\n', newCopy);
    expect(await exportMeeting(false)).toEqual({ status: 'saved' });
    const first = path.join(folder, 'Планирование.md');
    await fs.appendFile(first, '\n- [ ] Call Анна');
    const edited = await fs.readFile(first, 'utf8');
    expect(edited).toContain('# Meeting\n');
    expect(await api.exportNote('other-session', title, '# Other meeting', false)).toEqual({ status: 'saved' });
    register();
    expect(await api.getOptions()).toEqual(options);
    expect(await exportMeeting(false)).toEqual({ status: 'existing' });
    expect(await api.openNote('first-session')).toBe(true);
    expect(desktop.openExternal).toHaveBeenLastCalledWith('obsidian://open?path=' + encodeURIComponent(first));
    expect(await exportMeeting(true)).toEqual({ status: 'saved' });
    expect(await fs.readFile(first, 'utf8')).toBe(edited);

    const latest = path.join(folder, 'Планирование (3).md');
    await fs.rename(latest, path.join(folder, 'Moved.md'));
    await fs.writeFile(latest, 'A different note.');
    expect(await exportMeeting(false)).toEqual({ status: 'missing' });
    expect(await api.openNote('first-session')).toBe(false);
    expect(await exportMeeting(true)).toEqual({ status: 'saved' });
    expect(await fs.readFile(latest, 'utf8')).toBe('A different note.');
    expect(await api.openNote('first-session')).toBe(true);
    expect(desktop.openExternal).toHaveBeenLastCalledWith('obsidian://open?path=' + encodeURIComponent(path.join(folder, 'Планирование (4).md')));

    const newDestination = path.join(root, 'Another vault');
    await fs.mkdir(newDestination);
    desktop.dialog.mockResolvedValue({ canceled: false, filePaths: [newDestination] });
    expect(await api.saveOptions({ ...options, folder: await api.chooseFolder() })).toBe(true);
    expect(await exportMeeting(false)).toEqual({ status: 'existing' });
    expect(await api.openNote('first-session')).toBe(true);
    expect(desktop.openExternal).toHaveBeenLastCalledWith('obsidian://open?path=' + encodeURIComponent(path.join(folder, 'Планирование (4).md')));
    expect(await exportMeeting(true)).toEqual({ status: 'saved' });
    expect(await api.openNote('first-session')).toBe(true);
    expect(desktop.openExternal).toHaveBeenLastCalledWith('obsidian://open?path=' + encodeURIComponent(path.join(newDestination, 'Планирование.md')));
});

it('limits export to the chosen folder and requires at least one view', async () => {
    const initial = await api.getOptions();
    const picked = await api.chooseFolder();
    expect(await api.saveOptions({ ...initial, folder: { id: root, label: 'Injected folder' } })).toBe(false);
    expect(await api.saveOptions({ folder: picked, plain: false, timestamped: false })).toBe(false);
    expect(await api.exportNote('session', 'Note', '# Hello', false)).toEqual({ status: 'needs-folder' });
    desktop.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await api.chooseFolder()).toBeNull();
    expect(await api.getOptions()).toEqual(initial);
    expect(await api.saveOptions({ ...initial, folder: picked })).toBe(true);
    expect(await api.exportNote('session', '../../CON.wav', '# Hello', false)).toEqual({ status: 'saved' });
    expect(await fs.readdir(folder)).toEqual(['_CON.md']);
});


it('preserves both same-title exports when files are created concurrently on a byte-limited filesystem', async () => {
    const picked = await api.chooseFolder();
    expect(await api.saveOptions({ ...await api.getOptions(), folder: picked })).toBe(true);
    const title = '音'.repeat(160) + '.wav';
    const results = await Promise.all(['one', 'two'].map((sessionId) =>
        api.exportNote(sessionId, title, 'Transcript ' + sessionId, false)));
    expect(results).toEqual([{ status: 'saved' }, { status: 'saved' }]);
    const files = await fs.readdir(folder);
    expect(files).toHaveLength(2);
    expect(files.every((file) => Buffer.byteLength(file) <= 255)).toBe(true);
    const notes = await Promise.all(files.map((file) => fs.readFile(path.join(folder, file), 'utf8')));
    expect(notes.map((note) => note.split('\n')[0]).sort()).toEqual(['Transcript one', 'Transcript two']);
});
