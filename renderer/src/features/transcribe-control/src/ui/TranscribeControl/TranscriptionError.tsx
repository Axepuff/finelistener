import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { InlineAlert } from 'renderer/src/shared/InlineAlert';

export const TranscriptionError: React.FC = observer(() => {
    const store = useAppStore();
    const { transcription } = store;
    const alertRef = useRef<HTMLDivElement>(null);
    const showError = transcription.isIncomplete || transcription.runOutcome === 'error';
    useEffect(() => {
        if (showError) alertRef.current?.scrollIntoView({ block: 'nearest' });
    }, [showError, transcription.runOutcome]);
    const [confirmRetrySpeakers, setConfirmRetrySpeakers] = useState<{
        sessionId: string | null;
        speakers: object;
    } | null>(null);
    const handleRetry = async (replaceSpeakerLabels = false) => {
        const result = transcription.isIncomplete ? await store.retryIncompleteTranscription(replaceSpeakerLabels) : await store.requestTranscriptionStart(replaceSpeakerLabels);
        if (!result.ok) store.activityLog.appendEvent(result.message);
    };

    if (!showError) return null;

    return <div ref={alertRef}>
        {transcription.isIncomplete ? (
            <InlineAlert severity={transcription.allSourcesFailed ? 'error' : 'warning'} title={transcription.allSourcesFailed ? 'Transcription failed' : 'Incomplete transcription'}>
                <Stack gap={8}>
                    <Text size="sm">{transcription.hasCompletedSources ?
                        'Completed sources are saved. Retry to transcribe the remaining sources using the original settings.' :
                        'No source was transcribed. Retry using the original settings.'}</Text>
                    <Stack gap={4} component="ul" m={0} pl={16}>
                        {transcription.savedTranscript?.sourceRun?.sources.map((source) => <Text component="li" size="xs" key={source.source}>
                            {source.source === 'system' ? 'System audio' : 'Microphone'}: {source.status === 'completed' ? 'Saved' : source.status === 'failed' ? 'Failed' : 'Not transcribed'}
                        </Text>)}
                    </Stack>
                    <Button size="compact-sm" variant="light" disabled={store.operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => {
                        if (transcription.savedTranscript?.speakers) setConfirmRetrySpeakers({
                            sessionId: store.workspace.activeSessionId,
                            speakers: transcription.savedTranscript.speakers,
                        });
                        else void handleRetry();
                    }}>
                        {transcription.allSourcesFailed ? 'Retry' : 'Retry remaining sources'}
                    </Button>
                </Stack>
            </InlineAlert>
        ) : null}
        {transcription.runOutcome === 'error' && !transcription.isIncomplete ? (
            <InlineAlert title="Transcription failed" actions={<Button size="compact-sm" disabled={store.operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => {
                if (transcription.savedTranscript?.speakers) setConfirmRetrySpeakers({ sessionId: store.workspace.activeSessionId, speakers: transcription.savedTranscript.speakers });
                else void handleRetry();
            }}>Retry</Button>}>
                {transcription.runErrorMessage}
                {transcription.previousTranscriptKept ? <Text size="xs">The previous transcript is kept.</Text> : null}
            </InlineAlert>
        ) : null}
        <Modal opened={confirmRetrySpeakers !== null} onClose={() => setConfirmRetrySpeakers(null)} title="Replace speaker labels?" centered={true}>
            <Stack gap="sm">
                <Text size="sm">A successful retry may replace speaker names, assignments, and merges in this session.</Text>
                <Group justify="flex-end">
                    <Button variant="default" onClick={() => setConfirmRetrySpeakers(null)}>Cancel</Button>
                    <Button color="red" disabled={store.operations.isBusy} title={store.operationBlockReason} aria-description={store.operationBlockReason} onClick={() => {
                        const isCurrent = confirmRetrySpeakers?.sessionId === store.workspace.activeSessionId
                            && confirmRetrySpeakers.speakers === transcription.savedTranscript?.speakers;
                        setConfirmRetrySpeakers(null);
                        if (isCurrent) void handleRetry(true);
                        else store.activityLog.appendEvent('Speaker labels changed. Review the transcript before retrying.');
                    }}>Retry and replace</Button>
                </Group>
            </Stack>
        </Modal>
    </div>;
});
