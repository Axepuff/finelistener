import { makeAutoObservable } from 'mobx';

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

    clear(): void {
        this.contentValue = '';
    }
}
