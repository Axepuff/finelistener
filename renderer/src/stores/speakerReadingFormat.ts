import { DEFAULT_THEME } from '@mantine/core';
import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { escapeHtml } from 'renderer/src/shared/lib/formatUtils';
import type { SpeakerReadingParagraph, SpeakerReadingWord } from './speakerReading';
import type { DeepReadonly } from './types';

const speakerColors = ['blue', 'teal', 'grape', 'orange', 'pink', 'indigo', 'cyan', 'lime'];

export interface SpeakerLabel {
    name: string;
    color: string;
}

export type SpeakerLabels = ReadonlyMap<string, SpeakerLabel>;

export const speakerLabelsFor = (transcript: DeepReadonly<SessionTranscriptV1> | null): SpeakerLabels =>
    new Map(transcript?.speakers?.speakers.map((speaker, index) => [
        speaker.id, { name: speaker.name, color: speakerColors[index % speakerColors.length] },
    ]));

export const speakerWordLabel = (word: SpeakerReadingWord, labels: SpeakerLabels): string => {
    const parts = [labels.get(word.speakerId ?? '')?.name ?? 'Unknown speaker'];
    if (word.overlap) parts.push('Overlapping voices');
    if (word.estimated) parts.push('Estimated from voice activity');
    return parts.join(' · ');
};

export const speakerReadingToHtml = (paragraphs: readonly SpeakerReadingParagraph[], labels: SpeakerLabels): string =>
    paragraphs.map(({ text, words }) => {
        const parts: string[] = [];
        let cursor = 0;
        for (const word of words) {
            const color = labels.get(word.speakerId ?? '')?.color ?? 'gray';
            const background = DEFAULT_THEME.colors[color][1];
            const title = escapeHtml(speakerWordLabel(word, labels));
            const content = escapeHtml(text.slice(word.startChar, word.endChar));
            parts.push(escapeHtml(text.slice(cursor, word.startChar)),
                `<span style="background-color:${background};color:#212529" title="${title}">${content}</span>`);
            cursor = word.endChar;
        }
        parts.push(escapeHtml(text.slice(cursor)));
        return `<p>${parts.join('')}</p>`;
    }).join('\n');
