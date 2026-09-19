import type { SessionListItem } from 'electron/src/types/sessions';
import { describe, expect, it, vi } from 'vitest';
import { SessionsStore } from './sessionsStore';
import { createFakeRendererAdapter } from './testing/fakeRendererAdapter';

const createSession = (id: string): SessionListItem => ({
    id,
    title: `Session ${id}`,
    createdAt: 1,
    updatedAt: 1,
    sourceKind: 'imported',
    hasTranscript: false,
});

const deferred = <T>() => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

describe('SessionsStore', () => {
    it('loads the session list and exposes loading state', async () => {
        const request = deferred<SessionListItem[]>();
        const store = new SessionsStore(createFakeRendererAdapter({ listSessions: () => request.promise }).adapter);

        const refresh = store.refresh();

        expect(store.isLoading).toBe(true);
        expect(store.items).toEqual([]);

        request.resolve([createSession('one')]);
        expect((await refresh).ok).toBe(true);
        expect(store.items).toEqual([createSession('one')]);
        expect(store.isLoading).toBe(false);
        expect(store.error).toBeNull();
    });

    it('reports a safe error when loading fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const request = deferred<SessionListItem[]>();
        const store = new SessionsStore(createFakeRendererAdapter({ listSessions: () => request.promise }).adapter);

        const refresh = store.refresh();
        request.reject(new Error('filesystem details'));

        await expect(refresh).resolves.toEqual({ ok: false, message: 'Failed to load sessions.' });
        expect(store.error).toBe('Failed to load sessions.');
        expect(store.isLoading).toBe(false);
        vi.restoreAllMocks();
    });

    it('applies only the newest refresh when responses finish out of order', async () => {
        const first = deferred<SessionListItem[]>();
        const second = deferred<SessionListItem[]>();
        let call = 0;
        const store = new SessionsStore(createFakeRendererAdapter({
            listSessions: () => ++call === 1 ? first.promise : second.promise,
        }).adapter);

        const firstRefresh = store.refresh();
        const secondRefresh = store.refresh();

        second.resolve([createSession('new')]);
        await secondRefresh;
        expect(store.items[0]?.id).toBe('new');
        expect(store.isLoading).toBe(false);

        first.resolve([createSession('old')]);
        expect((await firstRefresh).ok).toBe(false);
        expect(store.items[0]?.id).toBe('new');
        expect(store.isLoading).toBe(false);
    });

    it('keeps the newer request loading when an older request rejects first', async () => {
        const first = deferred<SessionListItem[]>();
        const second = deferred<SessionListItem[]>();
        let call = 0;
        const store = new SessionsStore(createFakeRendererAdapter({
            listSessions: () => ++call === 1 ? first.promise : second.promise,
        }).adapter);

        const firstRefresh = store.refresh();
        const secondRefresh = store.refresh();

        first.reject(new Error('stale failure'));
        expect((await firstRefresh).ok).toBe(false);
        expect(store.isLoading).toBe(true);
        expect(store.error).toBeNull();

        second.resolve([createSession('current')]);
        expect((await secondRefresh).ok).toBe(true);
        expect(store.isLoading).toBe(false);
    });

    it.each(['success', 'failure'] as const)('ignores late %s across dispose and reinitialize', async (outcome) => {
        const oldRequest = deferred<SessionListItem[]>();
        const currentRequest = deferred<SessionListItem[]>();
        let call = 0;
        const store = new SessionsStore(createFakeRendererAdapter({
            listSessions: () => ++call === 1 ? oldRequest.promise : currentRequest.promise,
        }).adapter);

        store.initialize();
        store.dispose();
        store.initialize();

        currentRequest.resolve([createSession('current')]);
        await Promise.resolve();
        expect(store.items[0]?.id).toBe('current');

        if (outcome === 'success') oldRequest.resolve([createSession('old')]);
        else oldRequest.reject(new Error('late failure'));
        await Promise.resolve();
        expect(store.items[0]?.id).toBe('current');
        expect(store.isLoading).toBe(false);
        expect(store.error).toBeNull();
    });

    it('removes a session locally without loading or changing the workspace', async () => {
        const store = new SessionsStore(createFakeRendererAdapter({
            listSessions: () => Promise.resolve([createSession('one'), createSession('two')]),
        }).adapter);

        await store.refresh();
        store.remove('one');

        expect(store.items.map(({ id }) => id)).toEqual(['two']);
    });

    it('clears the list without IPC when the adapter is unavailable', async () => {
        const store = new SessionsStore(null);

        expect(await store.refresh()).toEqual({ ok: true, value: undefined });
        expect(store.items).toEqual([]);
        expect(store.isLoading).toBe(false);
        expect(store.error).toBeNull();
    });
});
