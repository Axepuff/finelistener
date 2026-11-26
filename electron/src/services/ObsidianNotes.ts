import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import Store from 'electron-store';
import { obsidianNoteTitle, type ObsidianExportResult, type ObsidianFolder, type ObsidianOptions } from '../types/obsidian';

interface Destination extends ObsidianFolder {
    directory: string;
}

interface ExportedNote {
    path: string;
    marker: string;
}

interface ExportSettings {
    options: Omit<ObsidianOptions, 'folder'> & { folder: Destination | null };
    notes: Record<string, ExportedNote>;
}

const isSessionId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9_-]{1,128}$/iu.test(id);

function publicFolder(folder: Destination): ObsidianFolder {
    return { id: folder.id, label: folder.label };
}

function noteBasename(title: string): string {
    const characters = obsidianNoteTitle(title).replace(/[<>:"|?*#^[\]]/gu, '-');
    let name = '';
    let bytes = 0;
    for (const character of characters) {
        bytes += Buffer.byteLength(character);
        if (bytes > 220) break;
        name += character.charCodeAt(0) < 32 ? '-' : character;
    }
    name = name.replace(/^\.+|[. ]+$/gu, '').trim() || 'Untitled';
    return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name) ? '_' + name : name;
}

const fileIsMissing = (error: unknown) =>
    (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR';

export class ObsidianNotes {
    private readonly store: Store<ExportSettings>;
    private selected: Destination | null = null;
    private readonly exporting = new Set<string>();

    constructor(profileDirectory: string) {
        this.store = new Store<ExportSettings>({
            cwd: profileDirectory,
            name: 'obsidian-export',
            defaults: { options: { folder: null, plain: false, timestamped: true }, notes: {} },
        });
    }

    getOptions(): ObsidianOptions {
        const { folder, plain, timestamped } = this.store.get('options');
        return { folder: folder ? publicFolder(folder) : null, plain, timestamped };
    }

    async selectDirectory(nativePath: string): Promise<ObsidianFolder> {
        const directory = await fs.realpath(nativePath);
        if (!(await fs.stat(directory)).isDirectory()) throw new Error('Expected a directory');
        const current = this.store.get('options').folder;
        this.selected = current?.directory === directory ? current : {
            id: randomUUID(), label: path.basename(directory) || directory, directory,
        };
        return publicFolder(this.selected);
    }

    saveOptions(options: ObsidianOptions): boolean {
        if (typeof options?.plain !== 'boolean' || typeof options.timestamped !== 'boolean'
            || !(options.plain || options.timestamped) || !options.folder) return false;
        const current = this.store.get('options').folder;
        const id = options.folder.id;
        const folder = this.selected?.id === id ? this.selected : current?.id === id ? current : null;
        if (!folder) return false;
        this.store.set('options', { folder, plain: options.plain, timestamped: options.timestamped });
        this.selected = null;
        return true;
    }

    private previousNote(sessionId: string): ExportedNote | undefined {
        return this.store.get('notes')['session-' + sessionId];
    }

    private rememberNote(sessionId: string, note: ExportedNote | undefined): void {
        const notes = this.store.get('notes');
        const key = 'session-' + sessionId;
        if (note) notes[key] = note;
        else delete notes[key];
        this.store.set('notes', notes);
    }

    async existingNotePath(sessionId: string): Promise<string | null> {
        if (!isSessionId(sessionId)) return null;
        const note = this.previousNote(sessionId);
        if (!note) return null;
        try {
            if (!(await fs.lstat(note.path)).isFile()) return null;
            // Obsidian and sync clients can replace a file while saving edits, so inode alone is insufficient.
            const text = await fs.readFile(note.path, 'utf8');
            return text.includes(note.marker) ? note.path : null;
        } catch (error) {
            if (fileIsMissing(error)) return null;
            throw error;
        }
    }

    async exportNote(sessionId: string, title: string, markdown: string, newCopy: boolean): Promise<ObsidianExportResult> {
        if (!isSessionId(sessionId) || typeof title !== 'string' || typeof markdown !== 'string' || !markdown.trim()
            || typeof newCopy !== 'boolean' || this.exporting.has(sessionId)) return { status: 'failed' };
        this.exporting.add(sessionId);
        try {
            const previous = this.previousNote(sessionId);
            if (!newCopy && previous) {
                return { status: await this.existingNotePath(sessionId) ? 'existing' : 'missing' };
            }
            const folder = this.store.get('options').folder;
            if (!folder) return { status: 'needs-folder' };
            const directory = await fs.realpath(folder.directory);
            if (path.relative(folder.directory, directory) || !(await fs.stat(directory)).isDirectory()) return { status: 'needs-folder' };

            const marker = '<!-- FineListener export ' + randomUUID() + ' -->';
            const basename = noteBasename(title);
            const temporary = path.join(directory, '.finelistener-' + randomUUID() + '.tmp');
            const handle = await fs.open(temporary, 'wx', 0o600);
            try {
                try {
                    await handle.writeFile(markdown.trimEnd() + '\n\n' + marker + '\n', 'utf8');
                } finally {
                    await handle.close();
                }
                for (let copy = 1; ; copy += 1) {
                    const filename = basename + (copy === 1 ? '' : ' (' + String(copy) + ')') + '.md';
                    const destination = path.join(directory, filename);
                    try {
                        await fs.lstat(destination);
                        continue;
                    } catch (error) {
                        if (!fileIsMissing(error)) throw error;
                    }
                    // Store the receipt first so a profile write failure cannot publish an untracked note.
                    this.rememberNote(sessionId, { path: destination, marker });
                    try {
                        await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
                    } catch (error) {
                        this.rememberNote(sessionId, previous);
                        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
                        throw error;
                    }
                    return { status: 'saved' };
                }
            } finally {
                try {
                    await fs.unlink(temporary);
                } catch (error) {
                    if (!fileIsMissing(error)) console.warn('Failed to remove temporary Obsidian export file', error);
                }
            }
        } catch (error) {
            if (fileIsMissing(error)) return { status: 'needs-folder' };
            console.error('Failed to export Obsidian note', error);
            return { status: 'failed' };
        } finally {
            this.exporting.delete(sessionId);
        }
    }
}
