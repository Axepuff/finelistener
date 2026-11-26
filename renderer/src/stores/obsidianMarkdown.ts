import type { SessionSummary, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { obsidianNoteTitle, type ObsidianOptions } from '../../../electron/src/types/obsidian';
import { formatSecondsReadable } from '../shared/lib/formatUtils';
import { projectTextSentences } from './plainText';
import { unknownSpeaker } from './speakerReadingFormat';
import { projectTranscript } from './transcriptFormat';
import type { DeepReadonly } from './types';

const singleLine = (text: string) => text.replace(/\s+/gu, ' ').trim();

// Obsidian also interprets wiki links, tags, comments, block IDs, highlights and math.
const markdownText = (text: string) => text.trim().split(/\r\n?|\n/u).map((line) => line.trim()
    .replace(/[\\`*_\[\]<>#~|^%=$&]/gu, '\\$&')
    .replace(/^([+-])/u, '\\$1')
    .replace(/^(\d{1,9})([.)])(?=\s|$)/u, '$1\\$2')
).join('\n');

const timeLabel = (seconds: number) => formatSecondsReadable(seconds).replace(/^00:/u, '');

const detailedNotes = (summary: DeepReadonly<SessionSummary>) => {
    if (!summary.reviewedChunks?.length) return markdownText(summary.detailed);

    return [...summary.reviewedChunks].sort((a, b) => a.startSec - b.startSec).map((chunk) => {
        const title = chunk.title && singleLine(chunk.title);
        const speakers = (chunk.speakers ?? []).flatMap(({ name }) => name ? [markdownText(singleLine(name))] : []);
        const range = `${timeLabel(chunk.startSec)} – ${timeLabel(chunk.endSec)}`;
        return [
            title && `### ${markdownText(title)}`,
            [range, ...speakers].join(' · '),
            markdownText(chunk.text),
        ].filter(Boolean).join('\n\n');
    }).join('\n\n');
};

export function formatObsidianNote(
    title: string,
    transcript: DeepReadonly<SessionTranscriptV1>,
    formats: Pick<ObsidianOptions, 'plain' | 'timestamped'>,
): string {
    const sections = [`# ${markdownText(singleLine(obsidianNoteTitle(title)))}`];
    if (transcript.sourceRun?.status === 'incomplete') sections.push('**Partial transcript**');

    const summary = transcript.summary;
    if (summary?.brief.trim()) sections.push('## Brief overview', markdownText(summary.brief));
    if (summary?.detailed.trim() || summary?.reviewedChunks?.length) sections.push('## Detailed notes', detailedNotes(summary));

    if (formats.plain) {
        const paragraphs = projectTextSentences(transcript).map(({ paragraphStart, text }) =>
            (paragraphStart ? '\n\n' : '') + text).join('');
        sections.push('## Plain text', markdownText(paragraphs));
    }

    if (formats.timestamped) {
        const speakers = transcript.speakers?.status === 'completed' ?
            new Map(transcript.speakers.speakers.map(({ id, name }) => [id, name])) : undefined;
        const turns = projectTranscript(transcript, speakers ? 'speakers' : 'timecodes');
        const lines = turns.map((turn) => {
            const name = speakers?.get(turn.speakerId ?? '') ?? unknownSpeaker.name;
            const prefix = speakers ? `${markdownText(singleLine(name))}: ` : '';
            return `[${timeLabel(turn.startSec)}] ${prefix}${markdownText(singleLine(turn.text))}`;
        });
        sections.push('## Timestamped transcript', lines.join('\n\n'));
    }
    return sections.join('\n\n') + '\n';
}
