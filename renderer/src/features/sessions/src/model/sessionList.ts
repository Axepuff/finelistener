import type { SessionListItem } from 'electron/src/types/sessions';

export const groupSessions = (items: readonly Readonly<SessionListItem>[], query: string, now = new Date()) => {
    const today = now.toDateString();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toDateString();
    const groups = { Today: [] as Readonly<SessionListItem>[], Yesterday: [] as Readonly<SessionListItem>[], Earlier: [] as Readonly<SessionListItem>[] };
    const search = query.trim().toLocaleLowerCase();
    for (const session of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
        if (!session.title.toLocaleLowerCase().includes(search)) continue;
        const date = new Date(session.updatedAt).toDateString();
        groups[date === today ? 'Today' : date === yesterday ? 'Yesterday' : 'Earlier'].push(session);
    }
    return Object.entries(groups).filter(([, sessions]) => sessions.length).map(([label, sessions]) => ({ label, items: sessions }));
};

export const formatSessionMeta = (session: Readonly<SessionListItem>) => {
    const parts: string[] = [];
    if (session.durationMs !== undefined && Number.isFinite(session.durationMs) && session.durationMs >= 0) {
        const total = Math.floor(session.durationMs / 1000);
        const hours = Math.floor(total / 3600);
        const minutes = String(Math.floor(total / 60) % 60).padStart(2, '0');
        const seconds = String(total % 60).padStart(2, '0');
        parts.push(`${hours ? `${hours}:` : ''}${minutes}:${seconds}`);
    }
    if (session.speakerCount && session.speakerCount > 0) parts.push(`${session.speakerCount} ${session.speakerCount === 1 ? 'speaker' : 'speakers'}`);
    return parts.join(' · ') || (session.sourceKind === 'recorded' ? 'Recorded' : 'Imported');
};
