import type { SessionTranscriptV1 } from 'electron/src/types/sessions';
import { escapeHtml } from 'renderer/src/shared/lib/formatUtils';
import type { SpeakerReadingParagraph, SpeakerReadingWord } from './speakerReading';
import type { DeepReadonly } from './types';

// Steps 1, 4 and 8 from the design ramps with readable tag text.
const speakerRamps = [
    ['#f6ffed', '#94de64', '#227804'],
    ['#fff2e8', '#ff9c6e', '#ad2202'],
    ['#f9f0ff', '#b37feb', '#391085'],
    ['#fff0f6', '#ff85bf', '#9e1067'],
    ['#fff1f0', '#ff7775', '#a8071a'],
    ['#e6fffb', '#5cdbd3', '#006d75'],
    ['#fff7e6', '#ffc069', '#ad4e00'],
] as const;

export interface SpeakerLabel {
    name: string;
    color: string;
    accent: string;
    clipboardBackground: string;
}

export type SpeakerLabels = ReadonlyMap<string, SpeakerLabel>;

export const unknownSpeaker: SpeakerLabel = {
    name: 'Unknown speaker', clipboardBackground: '#fffbe6', accent: '#ffd666', color: '#874c00',
};

export const speakerLabelsFor = (transcript: DeepReadonly<SessionTranscriptV1> | null): SpeakerLabels =>
    new Map(transcript?.speakers?.speakers.map((speaker, index) => {
        const [clipboardBackground, accent, color] = speakerRamps[index % speakerRamps.length];
        const label = { name: speaker.name, clipboardBackground, accent, color };
        if (index < speakerRamps.length) return [speaker.id, label];

        // Imported legacy sessions can outnumber the preset ramps. Vary lightness within the same hue.
        const shade = Math.max(5, 72 / Math.ceil((index + 1) / speakerRamps.length));
        return [speaker.id, {
            ...label,
            accent: `color-mix(in srgb, ${label.accent} ${shade}%, ${label.color})`,
            clipboardBackground: `color-mix(in srgb, ${label.clipboardBackground} ${100 - shade / 3}%, ${label.accent})`,
        }];
    }));

export const speakerWordLabel = (word: SpeakerReadingWord, labels: SpeakerLabels): string => {
    const parts = [labels.get(word.speakerId ?? '')?.name ?? unknownSpeaker.name];
    if (word.overlap) parts.push('Overlapping voices');
    if (word.estimated) parts.push('Estimated from voice activity');
    return parts.join(' · ');
};

export const speakerReadingToHtml = (paragraphs: readonly SpeakerReadingParagraph[], labels: SpeakerLabels): string =>
    paragraphs.map(({ text, words }) => {
        const parts: string[] = [];
        let cursor = 0;
        for (const word of words) {
            const background = labels.get(word.speakerId ?? '')?.clipboardBackground ?? unknownSpeaker.clipboardBackground;
            const title = escapeHtml(speakerWordLabel(word, labels));
            const content = escapeHtml(text.slice(word.startChar, word.endChar));
            parts.push(escapeHtml(text.slice(cursor, word.startChar)),
                `<span style="background-color:${background};color:#212529" title="${title}">${content}</span>`);
            cursor = word.endChar;
        }
        parts.push(escapeHtml(text.slice(cursor)));
        return `<p>${parts.join('')}</p>`;
    }).join('\n');
