import { makeAutoObservable } from 'mobx';
import { formatActivityFailure } from '../../../electron/src/utils/errorDetails';

export class ActivityLogStore {
    isOpen = false;
    focusRequest = 0;

    show(): void {
        this.isOpen = true;
        this.focusRequest += 1;
    }

    toggle(): void { this.isOpen = !this.isOpen; }

    private contentValue = '';

    constructor() {
        makeAutoObservable(this, {}, { autoBind: true });
    }

    get content(): string {
        return this.contentValue;
    }

    appendEvent(message: string): void {
        const prefix = this.contentValue ? '\n' : '';
        const timestamp = new Date().toLocaleTimeString();

        this.contentValue = `${this.contentValue}${prefix}[${timestamp}] ${message}`;
    }

    appendProcessOutput(output: string): void {
        this.contentValue += output;
    }

    appendFailure(action: string, error: unknown): void {
        this.appendEvent(formatActivityFailure(action, error));
    }

    clear(): void {
        this.contentValue = '';
    }
}
