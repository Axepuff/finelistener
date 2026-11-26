import { makeAutoObservable, runInAction } from 'mobx';
import { builtInSummaryPresets, isUserSummaryPresets, type SummaryPromptPreset } from '../../../electron/src/types/summaryPresets';
import type { RendererAdapter } from './rendererAdapter';
import { commandFailure, commandSuccess, type CommandResult } from './types';

export class SummaryPresetStore {
    private userPresets: SummaryPromptPreset[] = [];
    private revision = 0;
    ready = false;
    saving = false;
    loadError: string | null = null;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter'>(this, { adapter: false }, { autoBind: true });
    }

    get presets(): readonly SummaryPromptPreset[] { return [...builtInSummaryPresets, ...this.userPresets]; }

    isUserPreset(name: string): boolean { return this.userPresets.some((preset) => preset.name === name); }

    async load(): Promise<void> {
        if (!this.adapter) return;
        const revision = ++this.revision;
        try {
            const presets = await this.adapter.getUiPreference('summaryPromptPresets');
            if (!isUserSummaryPresets(presets)) throw new Error('Invalid stored summary presets');
            if (revision === this.revision) runInAction(() => {
                this.userPresets = presets;
                this.ready = true;
                this.loadError = null;
            });
        } catch (error) {
            console.error('Failed to load summary presets', error);
            if (revision === this.revision) runInAction(() => { this.loadError = 'Could not load saved presets.'; });
        }
    }

    savePreset(name: string, prompt: string): Promise<CommandResult> {
        return this.persist([...this.userPresets, { name: name.trim(), prompt }]);
    }

    renamePreset(previous: string, name: string): Promise<CommandResult> {
        if (!this.isUserPreset(previous)) return Promise.resolve(commandFailure('This preset is unavailable.'));
        return this.persist(this.userPresets.map((preset) => preset.name === previous ? { ...preset, name: name.trim() } : preset));
    }

    deletePreset(name: string): Promise<CommandResult> {
        if (!this.isUserPreset(name)) return Promise.resolve(commandFailure('This preset is unavailable.'));
        return this.persist(this.userPresets.filter((preset) => preset.name !== name));
    }

    private async persist(presets: SummaryPromptPreset[]): Promise<CommandResult> {
        if (!this.adapter || !this.ready || this.saving) return commandFailure('Saved presets are unavailable.');
        if (!isUserSummaryPresets(presets)) {
            return commandFailure('Use a unique preset name and a valid prompt.');
        }
        const revision = this.revision;
        this.saving = true;
        try {
            // Electron IPC requires ordinary objects, including presets previously made observable.
            const saved = await this.adapter.setUiPreference('summaryPromptPresets', presets.map(({ name, prompt }) => ({ name, prompt })));
            if (revision !== this.revision) return commandFailure('Saved presets have changed.');
            runInAction(() => { this.userPresets = saved; });
            return commandSuccess(undefined);
        } catch (error) {
            console.error('Failed to save summary presets', error);
            return commandFailure('Could not save your presets. Try again.');
        } finally {
            if (revision === this.revision) runInAction(() => { this.saving = false; });
        }
    }

    dispose(): void {
        this.revision++;
        this.ready = false;
        this.saving = false;
        this.loadError = null;
    }
}
