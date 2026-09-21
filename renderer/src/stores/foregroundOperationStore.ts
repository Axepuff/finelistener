import { makeAutoObservable } from 'mobx';
import type { ForegroundOperation, ForegroundOperationKind } from './types';

export class ForegroundOperationStore {
    private activeOperation: ForegroundOperation | null = null;

    private nextOperationId = 1;

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get active(): Readonly<ForegroundOperation> | null {
        return this.activeOperation;
    }

    get isBusy(): boolean {
        return this.activeOperation !== null;
    }

    get kind(): ForegroundOperationKind | null {
        return this.activeOperation?.kind ?? null;
    }

    begin(kind: ForegroundOperationKind): ForegroundOperation | null {
        if (this.activeOperation) return null;

        const operation = { id: this.nextOperationId, kind };

        this.nextOperationId += 1;
        this.activeOperation = operation;

        return operation;
    }

    transition(operation: ForegroundOperation, kind: ForegroundOperationKind): boolean {
        if (!this.owns(operation)) return false;

        this.activeOperation = { ...operation, kind };

        return true;
    }

    owns(operation: ForegroundOperation): boolean {
        return this.activeOperation?.id === operation.id;
    }

    finish(operation: ForegroundOperation): void {
        if (this.owns(operation)) {
            this.activeOperation = null;
        }
    }

    cancelActive(): void {
        this.activeOperation = null;
    }
}
