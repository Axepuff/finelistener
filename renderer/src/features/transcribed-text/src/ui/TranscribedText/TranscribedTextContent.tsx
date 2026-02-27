import { Box, Paper } from '@mantine/core';
import React, { type MouseEvent } from 'react';
import styles from './TranscribedText.module.css';

interface TranscribedSegment {
    text: string;
    startSeconds: number | null;
}

interface Props {
    showRegions: boolean;
    renderedText: string;
    plainSegments: TranscribedSegment[];
    onRegionClick: (event: MouseEvent<HTMLElement>) => void;
}

export const TranscribedTextContent: React.FC<Props> = ({
    showRegions,
    renderedText,
    plainSegments,
    onRegionClick,
}) => {
    const regionTextClassName = `${styles.regionTextContent} ${showRegions ? styles.regionTextPreWrap : styles.regionTextNormalWrap}`;

    return (
        <Paper style={{ padding: 18, overflowY: 'auto', width: '100%', minHeight: 0, flex: 1 }}>
            {showRegions ? (
                <Box
                    component="div"
                    className={regionTextClassName}
                    onClick={onRegionClick}
                    dangerouslySetInnerHTML={{ __html: renderedText }}
                />
            ) : (
                <Box component="div" className={regionTextClassName} onClick={onRegionClick}>
                    {plainSegments.map((segment, index) => {
                        const regionValue = segment.startSeconds;

                        return (
                            <span key={`${index}-${regionValue ?? 'na'}`} data-regions={regionValue?.toString()}>
                                {segment.text}
                                {index < plainSegments.length - 1 ? ' ' : ''}
                            </span>
                        );
                    })}
                </Box>
            )}
        </Paper>
    );
};
