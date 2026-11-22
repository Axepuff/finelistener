import React, { useState } from 'react';
import { formatSecondsReadable } from 'renderer/src/shared/lib';
import type { SpeakerReadingParagraph, SpeakerReadingWord } from 'renderer/src/stores/speakerReading';
import { speakerWordLabel, unknownSpeaker, type SpeakerLabels } from 'renderer/src/stores/speakerReadingFormat';
import styles from './TranscribedText.module.css';
import { speakerStyle } from './speakerStyle';

interface Props {
    paragraphs: SpeakerReadingParagraph[];
    labels: SpeakerLabels;
    highlightSegment: (text: string, paragraphIndex: number) => (start: number, end: number) => React.ReactNode;
}

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
    const [activeWord, setActiveWord] = useState<SpeakerReadingWord | null>(null);
    return (
        <div>
            {paragraphs.map((paragraph, index) => {
                const slice = highlightSegment(paragraph.text, index);
                const firstTimed = paragraph.words.findIndex((word) => word.startSec !== null);
                const passages: React.ReactNode[] = [];
                let cursor = 0;
                let run: React.ReactNode[] = [];
                paragraph.words.forEach((word, wordIndex) => {
                    const gap = slice(cursor, word.startChar);
                    const content = slice(word.startChar, word.endChar);
                    cursor = word.endChar;
                    if (run.length > 0) run.push(<React.Fragment key={`gap-${word.startChar}`}>{gap}</React.Fragment>);
                    else passages.push(<React.Fragment key={`gap-${word.startChar}`}>{gap}</React.Fragment>);

                    const label = speakerWordLabel(word, labels);
                    run.push(word.startSec !== null ? (
                        <button
                            key={word.startChar}
                            type="button"
                            className={styles.readingWord}
                            data-regions={word.startSec}
                            tabIndex={wordIndex === firstTimed ? 0 : -1}
                            onClick={() => setActiveWord(word)}
                            aria-current={word === activeWord ? 'true' : undefined}
                            aria-label={`${paragraph.text.slice(word.startChar, word.endChar)} · ${label}`}
                            title={`${label} · Play from ${formatSecondsReadable(word.startSec)}`}
                        >{content}</button>
                    ) : (
                        <span key={word.startChar} className={styles.untimedWord} title={`${label} · No word timestamp`}>{content}</span>
                    ));

                    const next = paragraph.words[wordIndex + 1];
                    if (!next || next.speakerId !== word.speakerId) {
                        const speaker = labels.get(word.speakerId ?? '') ?? unknownSpeaker;
                        // Keep punctuation with the passage preceding it and leave separating spaces uncolored.
                        const punctuationEnd = next?.startChar ?? paragraph.text.length;
                        const trailing = paragraph.text.slice(cursor, punctuationEnd).match(/^[^\s]+/u)?.[0] ?? '';
                        if (trailing) {
                            run.push(<React.Fragment key={`punctuation-${cursor}`}>{slice(cursor, cursor + trailing.length)}</React.Fragment>);
                            cursor += trailing.length;
                        }
                        passages.push(
                            <span key={word.startChar} className={styles.readingPassage} style={speakerStyle(speaker)} title={speaker.name}>
                                {run}
                            </span>,
                        );
                        run = [];
                    }
                });
                return (
                    <p key={paragraph.offset} className={styles.transcriptParagraph} onFocus={focusWord} onKeyDown={navigateWords}>
                        {passages}{slice(cursor, paragraph.text.length)}
                    </p>
                );
            })}
        </div>
    );
};
