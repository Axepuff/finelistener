import type { ObsidianApi, ObsidianOptions } from 'electron/src/types/obsidian';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import { formatObsidianNote } from './obsidianMarkdown';
import type { DeepReadonly } from './types';

interface ExportSession {
    id: string;
    title: string;
    transcript: DeepReadonly<SessionTranscriptV1>;
}

type ExportStage = 'idle' | 'options' | 'existing' | 'missing' | 'saved' | 'error';

export class ObsidianExportStore {
    stage: ExportStage = 'idle';
    options: ObsidianOptions = { folder: null, plain: false, timestamped: true };
    choosingForExport = false;
    busy = false;
    message = '';
    private sessionId: string | null = null;
    private version = 0;

    constructor(private readonly api: ObsidianApi | undefined, private readonly getSession: () => ExportSession | null) {
        makeAutoObservable<this, 'api' | 'getSession' | 'version'>(this, {
            api: false, getSession: false, version: false, options: observableRef,
        }, { autoBind: true });
    }

    start(): Promise<void> {
        return this.loadOptions(true);
    }

    editOptions(): Promise<void> {
        return this.loadOptions(false);
    }

    private async loadOptions(forExport: boolean): Promise<void> {
        if (this.busy) return;
        const session = this.getSession();
        if (forExport && !session) return;
        this.sessionId = session?.id ?? null;
        this.choosingForExport = forExport;
        this.message = '';
        await this.request((api) => api.getOptions(), (options) => {
            this.options = options;
            if (forExport && options.folder) return this.write(false);
            this.stage = 'options';
        }, 'Could not load export options.');
    }

    async chooseFolder(): Promise<void> {
        if (this.stage !== 'options') return;
        await this.request((api) => api.chooseFolder(), (folder) => {
            if (folder) {
                this.options = { ...this.options, folder };
                this.message = '';
            }
        }, 'Could not choose the export folder.');
    }

    setFormats(plain: boolean, timestamped: boolean): void {
        if (!this.busy && this.stage === 'options') this.options = { ...this.options, plain, timestamped };
    }

    async confirmOptions(): Promise<void> {
        const options = this.options;
        if (this.stage !== 'options' || !options.folder || !(options.plain || options.timestamped)) return;
        await this.request((api) => api.saveOptions(options), (saved) => {
            if (!saved) {
                this.message = 'Could not save export options. Choose the folder again.';
                return;
            }
            if (this.choosingForExport) return this.write(false);
            this.dismiss();
        }, 'Could not save export options.');
    }

    async saveNewCopy(): Promise<void> {
        if (this.stage === 'existing' || this.stage === 'missing') await this.write(true);
    }

    private async write(newCopy: boolean): Promise<void> {
        const session = this.getSession();
        if (!session || session.id !== this.sessionId) {
            this.showError('The session is no longer available for export.');
            return;
        }
        await this.request((api) => api.exportNote(session.id, session.title,
            formatObsidianNote(session.title, session.transcript, this.options), newCopy), (result) => {
            if (result.status === 'needs-folder') {
                this.options = { ...this.options, folder: null };
                this.message = 'Choose an available folder in your Obsidian vault.';
                this.stage = 'options';
            } else if (result.status === 'failed') {
                this.showError('Could not export the note.');
            } else {
                this.message = '';
                this.stage = result.status;
            }
        }, 'Could not export the note.');
    }

    async openNote(): Promise<void> {
        const sessionId = this.sessionId;
        if (!sessionId || (this.stage !== 'saved' && this.stage !== 'existing')) return;
        await this.request((api) => api.openNote(sessionId), (opened) => {
            if (opened) this.dismiss();
            else this.showError('Could not open the note in Obsidian.');
        }, 'Could not open the note in Obsidian.');
    }

    dismiss(): void {
        this.version += 1;
        this.busy = false;
        this.stage = 'idle';
        this.message = '';
        this.sessionId = null;
    }

    private showError(message: string): void {
        this.stage = 'error';
        this.message = message;
    }

    private async request<T>(operation: (api: ObsidianApi) => Promise<T>,
        apply: (result: T) => void | Promise<void>, failure: string): Promise<void> {
        if (!this.api || this.busy) return;
        const version = this.version;
        this.busy = true;
        try {
            const result = await operation(this.api);
            if (version !== this.version) return;
            await runInAction(() => {
                this.busy = false;
                return apply(result);
            });
        } catch (error: unknown) {
            console.error(failure, error);
            if (version === this.version) runInAction(() => {
                this.busy = false;
                this.showError(failure);
            });
        }
    }
}
