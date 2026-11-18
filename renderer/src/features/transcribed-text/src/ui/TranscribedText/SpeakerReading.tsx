import React from 'react';
import { formatSecondsReadable } from 'renderer/src/shared/lib';
import type { SpeakerReadingParagraph } from 'renderer/src/stores/speakerReading';
import { speakerWordLabel, type SpeakerLabels } from 'renderer/src/stores/speakerReadingFormat';
import styles from './TranscribedText.module.css';

interface Props {
    paragraphs: SpeakerReadingParagraph[];
    labels: SpeakerLabels;
    highlightSegment: (text: string, paragraphIndex: number) => (start: number, end: number) => React.ReactNode;
}

const speakerFill = (color = 'gray') => `color-mix(in srgb, var(--mantine-color-${color}-5) 32%, var(--mantine-color-body))`;

const focusWord = (event: React.FocusEvent<HTMLParagraphElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || target.tabIndex === 0) return;
    const previous = event.currentTarget.querySelector<HTMLButtonElement>('button[tabindex="0"]');
    if (previous) previous.tabIndex = -1;
    target.tabIndex = 0;
};

const navigateWords = (event: React.KeyboardEvent<HTMLParagraphElement>) => {
    if (!(event.target instanceof HTMLButtonElement) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const next = buttons[buttons.indexOf(event.target) + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (next) {
        event.preventDefault();
        next.focus();
    }
};

export const SpeakerReading: React.FC<Props> = ({ paragraphs, labels, highlightSegment }) => {
    const displayed = new Set<string | null>();
    for (const paragraph of paragraphs) {
        for (const word of paragraph.words) displayed.add(word.speakerId);
    }

    return (
        <div className={styles.reading}>
            <ul className={styles.speakerLegend} aria-label="Speaker colors">
                {Array.from(labels).filter(([id]) => displayed.has(id)).map(([id, speaker]) => (
                    <li key={id}><span style={{ backgroundColor: speakerFill(speaker.color) }} />{speaker.name}</li>
                ))}
                {displayed.has(null) ? <li><span style={{ backgroundColor: speakerFill() }} />Unknown speaker</li> : null}
            </ul>
            {paragraphs.map((paragraph, index) => {
                const slice = highlightSegment(paragraph.text, index);
                const firstTimed = paragraph.words.findIndex((word) => word.startSec !== null);
                let cursor = 0;
                return (
                    <p key={paragraph.offset} className={styles.readingParagraph} onFocus={focusWord} onKeyDown={navigateWords}>
                        {paragraph.words.map((word, wordIndex) => {
                            const gap = slice(cursor, word.startChar);
                            const content = slice(word.startChar, word.endChar);
                            cursor = word.endChar;
                            const label = speakerWordLabel(word, labels);
                            const style = { backgroundColor: speakerFill(labels.get(word.speakerId ?? '')?.color) };
                            return (
                                <React.Fragment key={word.startChar}>
                                    {gap}
                                    {word.startSec !== null ? (
                                        <button
                                            type="button" className={styles.readingWord} style={style}
                                            data-regions={word.startSec} tabIndex={wordIndex === firstTimed ? 0 : -1}
                                            aria-label={`${paragraph.text.slice(word.startChar, word.endChar)} · ${label}`}
                                            title={`${label} · Play from ${formatSecondsReadable(word.startSec)}`}
                                        >{content}</button>
                                    ) : <span className={styles.readingWord} style={style} title={label}>{content}</span>}
                                </React.Fragment>
                            );
                        })}
                        {slice(cursor, paragraph.text.length)}
                    </p>
                );
            })}
        </div>
    );
};
