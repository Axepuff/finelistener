import { SUPPORTED_MEDIA_EXTENSIONS } from '../constants';

export interface ObsidianFolder {
    id: string;
    label: string;
}

export interface ObsidianOptions {
    folder: ObsidianFolder | null;
    plain: boolean;
    timestamped: boolean;
}

export interface ObsidianExportResult {
    status: 'saved' | 'existing' | 'missing' | 'needs-folder' | 'failed';
}

export interface ObsidianApi {
    getOptions(): Promise<ObsidianOptions>;
    chooseFolder(): Promise<ObsidianFolder | null>;
    saveOptions(options: ObsidianOptions): Promise<boolean>;
    exportNote(sessionId: string, title: string, markdown: string, newCopy: boolean): Promise<ObsidianExportResult>;
    openNote(sessionId: string): Promise<boolean>;
}

export function obsidianNoteTitle(sessionTitle: string): string {
    const name = sessionTitle.split(/[\\/]/u).at(-1)?.trim() ?? '';
    const dot = name.lastIndexOf('.');
    const hasMediaExtension = dot >= 0 && SUPPORTED_MEDIA_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
    return (hasMediaExtension ? name.slice(0, dot).trimEnd() : name) || 'Untitled';
}
