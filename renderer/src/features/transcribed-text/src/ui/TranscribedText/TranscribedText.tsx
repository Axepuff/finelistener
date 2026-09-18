import { ActionIcon, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useState, type MouseEvent } from 'react';
import { useAppStore } from '../../../../../AppContext';
import { TranscribedTextContent } from './TranscribedTextContent';
import { TranscribedTextControls } from './TranscribedTextControls';
import { parseTimeToSeconds } from './utils';

export const TranscribedText: React.FC = observer(() => {
    const store = useAppStore();
    const { transcription } = store;
    const [showRegions, setShowRegions] = useState(false);
    const currentTextValue = showRegions ? transcription.timecodedText : transcription.plainText;
    const isInitialEmptyState = (
        store.lifecycleState === 'initial'
        || store.lifecycleState === 'importing'
    ) && currentTextValue.trim().length === 0;
    const plainSegments = transcription.visibleTranscript?.segments.map((segment) => ({
        text: segment.text,
        startSeconds: segment.startSec,
    })) ?? [];

    const handleRegionClick = (event: MouseEvent<HTMLElement>) => {
        const regionElement = (event.target as HTMLElement | null)?.closest('span[data-regions]');

        if (!regionElement) return;

        const region = regionElement.getAttribute('data-regions');
        const time = region ? parseTimeToSeconds(region) : null;

        if (time === null) return;

        store.workspace.requestPlaybackTime(time);
    };

    const handlePick = async () => {
        const result = await store.importAudio();

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    };

    return (
        <Stack gap={16} align="stretch" style={{ width: '100%', minWidth: 0, minHeight: 0, height: '100%', padding: 16, overflow: 'hidden' }}>
            {isInitialEmptyState ? (
                <Paper
                    style={{
                        width: '100%',
                        minHeight: 0,
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Stack gap={12} align="center" style={{ maxWidth: 280 }}>
                        <ActionIcon
                            size={64}
                            variant="light"
                            onClick={handlePick}
                        >
                            <IconPlus size={30} color="var(--mantine-color-gray-5)" />
                        </ActionIcon>

                        <Text size="md" fw={600} c="gray.6" ta="center">
                            {'No transcription available yet'}
                        </Text>
                        <Text size="sm" c="gray.5" ta="center">
                            {'Upload a file and click "Transcribe" to see the result here.'}
                        </Text>
                    </Stack>
                </Paper>
            ) : (
                <>
                    <TranscribedTextControls
                        currentTextValue={currentTextValue}
                        showRegions={showRegions}
                        setShowRegions={setShowRegions}
                    />

                    {store.lifecycleState === 'transcribing' ? (
                        <Group gap={8} align="center" wrap="nowrap" style={{ width: '100%' }}>
                            <Progress value={transcription.progress} size={4} style={{ flexGrow: 1 }} />
                            <Text size="sm" style={{ minWidth: 48, textAlign: 'right' }}>
                                {`${transcription.progress.toFixed(0)}%`}
                            </Text>
                        </Group>
                    ) : null}

                    <TranscribedTextContent
                        showRegions={showRegions}
                        renderedText={transcription.renderedHtml}
                        plainSegments={plainSegments}
                        onRegionClick={handleRegionClick}
                    />
                </>
            )}
        </Stack>
    );
});
