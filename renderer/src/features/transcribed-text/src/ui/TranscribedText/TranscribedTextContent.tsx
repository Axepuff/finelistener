import { ActionIcon, Box, Paper, Text, UnstyledButton } from '@mantine/core';
import { IconPencil, IconUserEdit } from '@tabler/icons-react';
import type { SessionSpeakerAssignment, SessionTranscriptSegmentV1 } from 'electron/src/types/sessions';
import React, { useEffect, useRef, type MouseEvent } from 'react';
import type { TranscriptMatch, TranscriptMatchRange } from './search';
import styles from './TranscribedText.module.css';
import type { DeepReadonly } from 'renderer/src/stores/types';

interface TranscribedSegment {
    id: string;
    text: string;
    prefix: string;
    startSeconds: number | null;
    timecode: string;
    speaker?: { name: string; color: string };
    source?: SessionTranscriptSegmentV1['source'];
    assignment?: SessionSpeakerAssignment;
    children?: Array<{ segment: DeepReadonly<SessionTranscriptSegmentV1> }>;
}

interface Props {
    showRegions: boolean;
    plainSegments: TranscribedSegment[];
    matches: TranscriptMatch[];
    activeMatchIndex: number;
    searchQuery: string;
    transcriptText: string;
    onRegionClick: (event: MouseEvent<HTMLElement>) => void;
    onEditSpeaker?: (span: SessionSpeakerAssignment) => void;
}

export const TranscribedTextContent: React.FC<Props> = ({
    showRegions,
    plainSegments,
    matches,
    activeMatchIndex,
    searchQuery,
    transcriptText,
    onRegionClick,
    onEditSpeaker,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const hasSpeakers = plainSegments.some((segment) => segment.speaker);
    const regionTextClassName = `${styles.regionTextContent} ${hasSpeakers ? styles.speakerTranscript : showRegions ? styles.regionTextPreWrap : styles.regionTextNormalWrap}`;
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
    }, [activeMatchIndex, searchQuery, showRegions, transcriptText]);

    const renderSegmentText = (text: string, segmentIndex: number) => {
        const segmentMatches = matchesBySegment.get(segmentIndex);
        if (!segmentMatches) return text;

        const parts: React.ReactNode[] = [];
        let cursor = 0;

        segmentMatches.forEach(({ range, index }) => {
            parts.push(text.slice(cursor, range.start));
            parts.push(
                <mark key={`${index}-${range.start}`} className={styles.searchMatch} data-active={index === activeMatchIndex}>
                    {text.slice(range.start, range.end)}
                </mark>,
            );
            cursor = range.end;
        });
        parts.push(text.slice(cursor));

        return parts;
    };

    return (
        <Paper style={{ padding: hasSpeakers ? '4px 0' : 18, overflowY: 'auto', width: '100%', minHeight: 0, flex: 1 }}>
            <Box ref={contentRef} component="div" className={regionTextClassName} onClick={onRegionClick}>
                {plainSegments.map((segment, index) => (
                    <React.Fragment key={segment.id}>
                        {segment.speaker ? (
                            <div className={styles.speakerTurn}>
                                <div className={styles.speakerIdentity}>
                                    <div className={styles.speakerIdentityRow}>
                                        <UnstyledButton
                                            type="button"
                                            className={styles.speakerLabel}
                                            c={`${segment.speaker.color}.8`}
                                            data-regions={segment.startSeconds?.toString()}
                                            aria-label={`Seek to ${segment.speaker.name}'s turn`}
                                            title="Seek to this turn"
                                        >
                                            {segment.speaker.name}
                                        </UnstyledButton>
                                        {segment.assignment && onEditSpeaker ? (
                                            <ActionIcon className={styles.speakerEdit} size={22} color={segment.speaker.color} variant="subtle" aria-label="Assign speaker" title="Change speaker" onClick={(event) => {
                                                event.stopPropagation();
                                                if (segment.assignment) onEditSpeaker(segment.assignment);
                                            }}><IconPencil size={13} /></ActionIcon>
                                        ) : null}
                                    </div>
                                    {segment.source ? <Text size="xs" c="dimmed">
                                        {segment.source === 'microphone' ? 'Microphone' : 'System audio'}
                                    </Text> : null}
                                </div>
                                <div className={styles.speakerSpeech} style={{ backgroundColor: `color-mix(in srgb, var(--mantine-color-${segment.speaker.color}-0) 55%, var(--mantine-color-body))` }}>
                                    <div>
                                        {renderSegmentText(segment.text, index)}
                                    </div>
                                    {segment.children && segment.children.length > 1 ? (
                                        <details className={styles.originalFragments}>
                                            <summary>Show original fragments</summary>
                                            {segment.children.map(({ segment: child }) => (
                                                <div className={styles.originalFragment} key={`${child.rawSpan?.segmentId}:${child.rawSpan?.startChar}:${child.startSec}`}>
                                                    <UnstyledButton type="button" className={styles.fragmentText} data-regions={String(child.startSec)} title="Seek to this fragment">
                                                        {child.text}
                                                    </UnstyledButton>
                                                    {child.rawSpan && segment.assignment && onEditSpeaker ? (
                                                        <ActionIcon size="xs" variant="subtle" aria-label="Assign fragment speaker" onClick={(event) => {
                                                            event.stopPropagation();
                                                            onEditSpeaker({ ...segment.assignment!, spans: [{ ...child.rawSpan! }] });
                                                        }}><IconUserEdit size={14} /></ActionIcon>
                                                    ) : null}
                                                </div>
                                            ))}
                                        </details>
                                    ) : null}
                                </div>
                            </div>
                        ) : showRegions ? (
                            <>
                                <span data-regions={segment.startSeconds?.toString()}>{segment.timecode}</span>
                                {segment.text ? ' ' : ''}
                                {segment.text ? segment.prefix : ''}
                                {renderSegmentText(segment.text, index)}
                                {'\n'}
                            </>
                        ) : (
                            <span data-regions={segment.startSeconds?.toString()}>
                                {renderSegmentText(segment.text, index)}
                            </span>
                        )}
                    </React.Fragment>
                ))}
            </Box>
        </Paper>
    );
};
