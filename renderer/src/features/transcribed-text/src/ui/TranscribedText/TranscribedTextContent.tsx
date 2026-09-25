import { Box, Paper } from '@mantine/core';
import React, { useEffect, useRef, type MouseEvent } from 'react';
import type { TranscriptMatch, TranscriptMatchRange } from './search';
import styles from './TranscribedText.module.css';

interface TranscribedSegment {
    text: string;
    prefix: string;
    startSeconds: number | null;
    timecode: string;
}

interface Props {
    showRegions: boolean;
    plainSegments: TranscribedSegment[];
    matches: TranscriptMatch[];
    activeMatchIndex: number;
    searchQuery: string;
    transcriptText: string;
    onRegionClick: (event: MouseEvent<HTMLElement>) => void;
}

export const TranscribedTextContent: React.FC<Props> = ({
    showRegions,
    plainSegments,
    matches,
    activeMatchIndex,
    searchQuery,
    transcriptText,
    onRegionClick,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const regionTextClassName = `${styles.regionTextContent} ${showRegions ? styles.regionTextPreWrap : styles.regionTextNormalWrap}`;
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
        <Paper style={{ padding: 18, overflowY: 'auto', width: '100%', minHeight: 0, flex: 1 }}>
            <Box ref={contentRef} component="div" className={regionTextClassName} onClick={onRegionClick}>
                {plainSegments.map((segment, index) => (
                    <React.Fragment key={`${index}-${segment.startSeconds ?? 'na'}`}>
                        {showRegions ? (
                            <>
                                <span data-regions={segment.startSeconds?.toString()}>{segment.timecode}</span>
                                {segment.text ? ' ' : ''}
                                {segment.text ? segment.prefix : ''}
                                {renderSegmentText(segment.text, index)}
                                {'\n'}
                            </>
                        ) : (
                            <span data-regions={segment.startSeconds?.toString()}>
                                {segment.prefix}
                                {renderSegmentText(segment.text, index)}
                                {index < plainSegments.length - 1 ? ' ' : ''}
                            </span>
                        )}
                    </React.Fragment>
                ))}
            </Box>
        </Paper>
    );
};
