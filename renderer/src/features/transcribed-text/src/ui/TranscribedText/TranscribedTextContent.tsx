import { ActionIcon, Paper, UnstyledButton } from '@mantine/core';
import { IconPencil, IconPlayerPlayFilled, IconUserEdit } from '@tabler/icons-react';
import type { SessionSpeakerAssignment, SessionTranscriptSegmentV1 } from 'electron/src/types/sessions';
import React, { useEffect, useRef, type MouseEvent } from 'react';
import type { TranscriptMatch, TranscriptMatchRange } from './search';
import styles from './TranscribedText.module.css';
import type { DeepReadonly, Segment } from 'renderer/src/stores/types';
import type { SpeakerReadingParagraph } from 'renderer/src/stores/speakerReading';
import type { SpeakerLabel, SpeakerLabels } from 'renderer/src/stores/speakerReadingFormat';
import { SpeakerReading } from './SpeakerReading';
import { speakerStyle } from './speakerStyle';

interface TranscribedSegment {
    id: string;
    text: string;
    prefix?: string;
    startSeconds: number | null;
    endSeconds?: number | null;
    timecode?: string;
    paragraphStart?: boolean;
    speaker?: SpeakerLabel;
    source?: SessionTranscriptSegmentV1['source'];
    assignment?: SessionSpeakerAssignment;
    children?: Array<{ segment: DeepReadonly<SessionTranscriptSegmentV1> }>;
}

interface Props {
    reading?: { paragraphs: SpeakerReadingParagraph[]; labels: SpeakerLabels };
    speakerHeader?: React.ReactNode;
    showRegions: boolean;
    playingRows?: boolean[];
    selectedRange?: Segment | null;
    plainSegments: TranscribedSegment[];
    matches: TranscriptMatch[];
    activeMatchIndex: number;
    searchQuery: string;
    transcriptText: string;
    onRegionClick: (event: MouseEvent<HTMLElement>) => void;
    onEditSpeaker?: (span: SessionSpeakerAssignment) => void;
}

export const TranscribedTextContent: React.FC<Props> = ({
    reading,
    speakerHeader,
    showRegions,
    playingRows,
    selectedRange,
    plainSegments,
    matches,
    activeMatchIndex,
    searchQuery,
    transcriptText,
    onRegionClick,
    onEditSpeaker,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const matchesBySegment = new Map<number, Array<{ range: TranscriptMatchRange; index: number }>>();

    matches.forEach((match, index) => {
        match.ranges.forEach((range) => {
            const segmentMatches = matchesBySegment.get(range.segmentIndex) ?? [];
            segmentMatches.push({ range, index });
            matchesBySegment.set(range.segmentIndex, segmentMatches);
        });
    });

    useEffect(() => {
        contentRef.current?.querySelector('mark[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [activeMatchIndex, matches, searchQuery, transcriptText]);

    const highlightSegment = (text: string, segmentIndex: number) => {
        const ranges = matchesBySegment.get(segmentIndex) ?? [];
        let nextMatch = 0;
        // Reading renders consecutive word and punctuation slices. A match can span both.
        return (start = 0, end = text.length): React.ReactNode => {
            while (nextMatch < ranges.length && ranges[nextMatch].range.end <= start) nextMatch++;
            if (nextMatch === ranges.length || ranges[nextMatch].range.start >= end || start === end) return text.slice(start, end);
            const parts: React.ReactNode[] = [];
            let cursor = start;
            for (let i = nextMatch; i < ranges.length && ranges[i].range.start < end; i++) {
                const { range, index } = ranges[i];
                const left = Math.max(start, range.start);
                const right = Math.min(end, range.end);
                parts.push(text.slice(cursor, left), (
                    <mark key={range.start} className={styles.searchMatch} data-active={index === activeMatchIndex}>{text.slice(left, right)}</mark>
                ));
                cursor = right;
            }
            parts.push(text.slice(cursor, end));
            return parts;
        };
    };

    const paragraphs: Array<Array<{ sentence: TranscribedSegment; index: number }>> = [];
    if (!showRegions) {
        plainSegments.forEach((sentence, index) => {
            if (sentence.paragraphStart || paragraphs.length === 0) paragraphs.push([]);
            paragraphs.at(-1)!.push({ sentence, index });
        });
    }

    const selectedRows = plainSegments.map(({ startSeconds, endSeconds }) => (
        Boolean(selectedRange && startSeconds !== null && startSeconds < selectedRange.end
            && (endSeconds === null || endSeconds === undefined ? startSeconds >= selectedRange.start : endSeconds > selectedRange.start))
    ));

    return (
        <Paper className={styles.scroller}>
            <div ref={contentRef} className={styles.transcriptColumn} onClick={onRegionClick}>
                {speakerHeader}
                {reading ? <SpeakerReading {...reading} highlightSegment={highlightSegment} /> : null}
                {!showRegions ? paragraphs.map((sentences) => (
                    <p key={sentences[0].sentence.id} className={styles.transcriptParagraph}>
                        {sentences.map(({ sentence, index }) => (
                            <span
                                key={sentence.id}
                                role={sentence.startSeconds === null ? undefined : 'button'}
                                tabIndex={sentence.startSeconds === null ? undefined : 0}
                                data-regions={sentence.startSeconds ?? undefined}
                                aria-current={playingRows?.[index] || undefined}
                                className={styles.textSentence}
                                title="Play from this sentence"
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        event.currentTarget.click();
                                    }
                                }}
                            >{highlightSegment(sentence.text, index)()}</span>
                        ))}
                    </p>
                )) : null}
                {showRegions ? plainSegments.map((segment, index) => segment.speaker ? (
                    <div key={segment.id} className={styles.speakerTurn} data-playing={playingRows?.[index] || undefined}>
                        <span className={styles.dialogueTimecode} data-regions={segment.startSeconds ?? undefined}>{segment.timecode}</span>
                        <div className={styles.speakerSpeech}>
                            <div className={styles.speakerIdentity}>
                                <UnstyledButton
                                    type="button"
                                    className={styles.speakerTag}
                                    style={speakerStyle(segment.speaker)}
                                    data-regions={segment.startSeconds ?? undefined}
                                    aria-label={`Seek to ${segment.speaker.name}'s turn`}
                                    aria-current={playingRows?.[index] || undefined}
                                    title="Seek to this turn"
                                >{segment.speaker.name}</UnstyledButton>
                                {segment.assignment && onEditSpeaker ? (
                                    <ActionIcon size={24} color="gray" variant="subtle" aria-label="Assign speaker" title="Change speaker" onClick={() => {
                                        if (segment.assignment) onEditSpeaker(segment.assignment);
                                    }}><IconPencil size={13} /></ActionIcon>
                                ) : null}
                                {segment.source ? <span className={styles.speakerSource}>
                                    {segment.source === 'microphone' ? 'Microphone' : 'System audio'}
                                </span> : null}
                            </div>
                            <p className={styles.turnText} data-regions={segment.startSeconds ?? undefined}>
                                {highlightSegment(segment.text, index)()}
                            </p>
                            {segment.children && segment.children.length > 1 ? (
                                <details className={styles.originalFragments}>
                                    <summary>Show original fragments</summary>
                                    {segment.children.map(({ segment: child }) => (
                                        <div className={styles.originalFragment} key={`${child.rawSpan?.segmentId}:${child.rawSpan?.startChar}:${child.startSec}`}>
                                            <UnstyledButton type="button" className={styles.fragmentText} data-regions={child.startSec} title="Seek to this fragment">
                                                {child.text}
                                            </UnstyledButton>
                                            {child.rawSpan && segment.assignment && onEditSpeaker ? (
                                                <ActionIcon size="xs" variant="subtle" aria-label="Assign fragment speaker" onClick={() => {
                                                    onEditSpeaker({ ...segment.assignment!, spans: [{ ...child.rawSpan! }] });
                                                }}><IconUserEdit size={14} /></ActionIcon>
                                            ) : null}
                                        </div>
                                    ))}
                                </details>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <UnstyledButton
                        key={segment.id}
                        type="button"
                        className={styles.timecodeRow}
                        data-regions={segment.startSeconds ?? undefined}
                        data-selected={selectedRows[index] || undefined}
                        data-first-selected={selectedRows[index] && !selectedRows[index - 1] || undefined}
                        data-last-selected={selectedRows[index] && !selectedRows[index + 1] || undefined}
                        aria-current={playingRows?.[index] || undefined}
                    >
                        <span className={styles.playingMarker}>
                            {playingRows?.[index] ? <IconPlayerPlayFilled role="img" aria-label="Playing" size={10} /> : null}
                        </span>
                        <span className={styles.timeRange}>{segment.timecode}</span>
                        <span className={styles.timecodeText}>{segment.prefix}{highlightSegment(segment.text, index)()}</span>
                    </UnstyledButton>
                )) : null}
            </div>
        </Paper>
    );
};
