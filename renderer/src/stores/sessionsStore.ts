import type { SessionListItem } from 'electron/src/types/sessions';
import { makeAutoObservable, runInAction } from 'mobx';
import type { RendererAdapter } from './rendererAdapter';
import { commandFailure, commandSuccess, type CommandResult } from './types';

/** Owns the persisted session list and the identity of its in-flight requests. */
export class SessionsStore {
    private itemsValue: SessionListItem[] = [];

    private isLoadingValue = false;

    private errorValue: string | null = null;

    private requestId = 0;

    private initialized = false;

    private disposed = false;

    constructor(private readonly adapter: RendererAdapter | null) {
        makeAutoObservable<this, 'adapter' | 'requestId' | 'initialized' | 'disposed'>(this, {
            adapter: false,
            requestId: false,
            initialized: false,
            disposed: false,
        }, { autoBind: true });
    }

    get items(): readonly Readonly<SessionListItem>[] {
        return this.itemsValue;
    }

    get isLoading(): boolean {
        return this.isLoadingValue;
    }

    get error(): string | null {
        return this.errorValue;
    }

    initialize(): void {
        if (this.initialized) return;

        this.initialized = true;
        this.disposed = false;

        if (this.adapter) {
            void this.refresh();
        } else {
            this.clearUnavailableState();
        }
    }

    dispose(): void {
        if (!this.initialized) return;

        this.initialized = false;
        this.disposed = true;
        this.requestId += 1;
    }

    async refresh(): Promise<CommandResult> {
        if (!this.adapter) {
            this.clearUnavailableState();

            return commandSuccess(undefined);
        }

        const requestId = this.requestId + 1;

        this.requestId = requestId;
        this.isLoadingValue = true;
        this.errorValue = null;

        try {
            const items = await this.adapter.listSessions();

            if (!this.isCurrentRequest(requestId)) {
                return commandFailure('The session list request was replaced.');
            }

            runInAction(() => {
                this.itemsValue = items;
            });

            return commandSuccess(undefined);
        } catch (error: unknown) {
            if (!this.isCurrentRequest(requestId)) {
                return commandFailure('The session list request was replaced.');
            }

            console.error('Failed to load sessions', error);
            runInAction(() => {
                this.errorValue = 'Failed to load sessions.';
            });

            return commandFailure('Failed to load sessions.');
        } finally {
            if (this.isCurrentRequest(requestId)) {
                runInAction(() => {
                    this.isLoadingValue = false;
                });
            }
        }
    }

    remove(sessionId: string): void {
        this.itemsValue = this.itemsValue.filter((session) => session.id !== sessionId);
    }

    private isCurrentRequest(requestId: number): boolean {
        return !this.disposed && requestId === this.requestId;
    }

    private clearUnavailableState(): void {
        this.itemsValue = [];
        this.isLoadingValue = false;
        this.errorValue = null;
    }
}
