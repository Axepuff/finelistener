import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { formatSecondsReadable } from 'renderer/src/shared/lib';
import type { SpeakerReadingParagraph, SpeakerReadingWord } from 'renderer/src/stores/speakerReading';
import { speakerWordLabel, unknownSpeaker, type SpeakerLabels } from 'renderer/src/stores/speakerReadingFormat';
import styles from './TranscribedText.module.css';
import { speakerStyle } from './speakerStyle';

interface Props {
    paragraphs: SpeakerReadingParagraph[];
    labels: SpeakerLabels;
    highlightSegment: (text: string, paragraphIndex: number, startChar: number) => (start: number, end: number) => React.ReactNode;
}

// Unpunctuated speech can form a single paragraph spanning the entire meeting.
const wordsPerChunk = 96;

interface ChunkProps extends Pick<Props, 'labels' | 'highlightSegment'> {
    paragraph: SpeakerReadingParagraph;
    paragraphIndex: number;
    firstWord: number;
    firstTimed: number;
    detailed: boolean;
    activeWord: SpeakerReadingWord | null;
    onSelect: (word: SpeakerReadingWord) => void;
}

const ReadingChunk: React.FC<ChunkProps> = React.memo(({
    paragraph, paragraphIndex, firstWord, firstTimed, detailed, activeWord, labels, highlightSegment, onSelect,
}) => {
    const { text, words, offset } = paragraph;
    const limit = Math.min(firstWord + wordsPerChunk, words.length);
    const start = firstWord ? words[firstWord].startChar : 0;
    const end = words[limit]?.startChar ?? text.length;
    const slice = highlightSegment(text, paragraphIndex, start);
    if (!detailed) {
        return <span data-reading-chunk={offset + start} tabIndex={firstTimed >= firstWord && firstTimed < limit ? 0 : undefined}>
            {slice(start, end)}
        </span>;
    }

    const passages: React.ReactNode[] = [];
    let cursor = start;
    let run: React.ReactNode[] = [];
    for (let i = firstWord; i < limit; i++) {
        const word = words[i];
        const gap = slice(cursor, word.startChar);
        const content = slice(word.startChar, word.endChar);
        cursor = word.endChar;
        (run.length ? run : passages).push(<React.Fragment key={`gap-${word.startChar}`}>{gap}</React.Fragment>);

        const label = speakerWordLabel(word, labels);
        run.push(word.startSec !== null ? (
            <button
                key={word.startChar}
                type="button"
                className={styles.readingWord}
                data-regions={word.startSec}
                data-word-index={i}
                tabIndex={i === firstTimed ? 0 : -1}
                onClick={() => onSelect(word)}
                aria-current={word === activeWord ? 'true' : undefined}
                aria-label={`${text.slice(word.startChar, word.endChar)} · ${label}`}
                title={`${label} · Play from ${formatSecondsReadable(word.startSec)}`}
            >{content}</button>
        ) : (
            <span key={word.startChar} className={styles.untimedWord} title={`${label} · No word timestamp`}>{content}</span>
        ));

        const next = i + 1 < limit ? words[i + 1] : undefined;
        if (!next || next.speakerId !== word.speakerId) {
            const speaker = labels.get(word.speakerId ?? '') ?? unknownSpeaker;
            // Keep punctuation with the preceding passage and leave separating spaces uncolored.
            const trailing = text.slice(cursor, next?.startChar ?? end).match(/^[^\s]+/u)?.[0] ?? '';
            if (trailing) {
                run.push(<React.Fragment key={`punctuation-${cursor}`}>{slice(cursor, cursor + trailing.length)}</React.Fragment>);
                cursor += trailing.length;
            }
            passages.push(<span key={word.startChar} className={styles.readingPassage} style={speakerStyle(speaker)} title={speaker.name}>{run}</span>);
            run = [];
        }
    }
    return <span data-reading-chunk={offset + start}>{passages}{slice(cursor, end)}</span>;
});

export const SpeakerReading: React.FC<Props> = ({ paragraphs, labels, highlightSegment }) => {
    const readingRef = useRef<HTMLDivElement>(null);
    const renderAll = useMemo(() => paragraphs.reduce((total, paragraph) => total + paragraph.words.length, 0) <= 6 * wordsPerChunk, [paragraphs]);
    const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
    const pointerDown = useRef(false);
    const rovingWords = useRef(new WeakMap<SpeakerReadingParagraph, number>());
    const [activeWord, setActiveWord] = useState<SpeakerReadingWord | null>(null);

    useEffect(() => {
        const reading = readingRef.current;
        if (renderAll || !reading) return;
        const document = reading.ownerDocument;
        const near = new Set<number>();
        const chunkAt = (node: Node | null) => {
            if (!node || !reading.contains(node)) return undefined;
            const element = node instanceof Element ? node : node.parentElement;
            const offset = element?.closest<HTMLElement>('[data-reading-chunk]')?.dataset.readingChunk;
            return offset === undefined ? undefined : Number(offset);
        };
        const expandNearby = () => {
            if (pointerDown.current) return;
            const visible = new Set(near);
            const focused = chunkAt(document.activeElement);
            if (focused !== undefined) visible.add(focused);
            const selection = document.getSelection();
            const endpoints = selection && !selection.isCollapsed ?
                [chunkAt(selection.anchorNode), chunkAt(selection.focusNode)] : [];
            setExpanded(previous => {
                // Both native range endpoints must keep their text nodes as the viewport moves.
                for (const offset of endpoints) {
                    if (offset === undefined) continue;
                    if (previous.has(offset)) visible.add(offset);
                    else visible.delete(offset);
                }
                return previous.size === visible.size && [...visible].every(offset => previous.has(offset)) ? previous : visible;
            });
        };
        const observer = new IntersectionObserver(entries => {
            for (const { target, isIntersecting } of entries) {
                const offset = Number((target as HTMLElement).dataset.readingChunk);
                if (isIntersecting) near.add(offset);
                else near.delete(offset);
            }
            expandNearby();
        }, { root: reading.closest(`.${styles.scroller}`), rootMargin: '320px 0px' });
        reading.querySelectorAll('[data-reading-chunk]').forEach(element => observer.observe(element));
        const startDrag = () => { pointerDown.current = true; };
        const endDrag = () => { pointerDown.current = false; expandNearby(); };
        reading.addEventListener('pointerdown', startDrag);
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('pointercancel', endDrag);
        document.addEventListener('selectionchange', expandNearby);
        return () => {
            pointerDown.current = false;
            observer.disconnect();
            reading.removeEventListener('pointerdown', startDrag);
            document.removeEventListener('pointerup', endDrag);
            document.removeEventListener('pointercancel', endDrag);
            document.removeEventListener('selectionchange', expandNearby);
        };
    }, [paragraphs, renderAll]);

    const focusAt = (element: HTMLParagraphElement, paragraph: SpeakerReadingParagraph, index: number) => {
        const first = Math.floor(index / wordsPerChunk) * wordsPerChunk;
        const offset = paragraph.offset + (first ? paragraph.words[first].startChar : 0);
        if (!element.querySelector(`[data-word-index="${index}"]`)) {
            flushSync(() => setExpanded(previous => new Set([...previous, offset])));
        }
        element.querySelector<HTMLButtonElement>(`[data-word-index="${index}"]`)?.focus();
    };

    return (
        <div ref={readingRef} onClick={renderAll ? undefined : event => {
            const target = event.target as HTMLElement;
            if (!event.detail || target.closest('button') || target.ownerDocument.getSelection()?.isCollapsed === false) return;
            const chunk = target.closest<HTMLElement>('[data-reading-chunk]');
            if (!chunk) return;
            // A scrollbar jump can deliver a click before the nearby words have mounted.
            const offset = Number(chunk.dataset.readingChunk);
            flushSync(() => setExpanded(previous => previous.has(offset) ? previous : new Set([...previous, offset])));
            const hit = target.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button[data-word-index]');
            if (hit && chunk.contains(hit)) {
                hit.focus({ preventScroll: true });
                hit.click();
            }
        }}>
            {paragraphs.map((paragraph, paragraphIndex) => {
                const firstTimed = rovingWords.current.get(paragraph) ?? paragraph.words.findIndex(word => word.startSec !== null);
                const chunks = [];
                for (let first = 0; first < Math.max(1, paragraph.words.length); first += wordsPerChunk) {
                    const offset = paragraph.offset + (first ? paragraph.words[first].startChar : 0);
                    const detailed = renderAll || (paragraphIndex < 2 && first === 0) || expanded.has(offset);
                    chunks.push(<ReadingChunk key={offset} paragraph={paragraph} paragraphIndex={paragraphIndex} firstWord={first}
                        firstTimed={firstTimed} detailed={detailed} activeWord={activeWord} labels={labels}
                        highlightSegment={highlightSegment} onSelect={setActiveWord} />);
                }
                return <p key={paragraph.offset} className={styles.transcriptParagraph} onFocus={event => {
                    const target = event.target;
                    if (!(target instanceof HTMLButtonElement)) {
                        if (!pointerDown.current && firstTimed !== -1) focusAt(event.currentTarget, paragraph, firstTimed);
                        return;
                    }
                    rovingWords.current.set(paragraph, Number(target.dataset.wordIndex));
                    if (target.tabIndex !== 0) {
                        const previous = event.currentTarget.querySelector<HTMLElement>('[tabindex="0"]');
                        if (previous) previous.tabIndex = -1;
                        target.tabIndex = 0;
                    }
                }} onKeyDown={event => {
                    if (!(event.target instanceof HTMLButtonElement) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                    const step = event.key === 'ArrowLeft' ? -1 : 1;
                    let next = Number(event.target.dataset.wordIndex) + step;
                    while (paragraph.words[next]?.startSec === null) next += step;
                    if (paragraph.words[next]) {
                        event.preventDefault();
                        focusAt(event.currentTarget, paragraph, next);
                    }
                }}>{chunks}</p>;
            })}
        </div>
    );
};
