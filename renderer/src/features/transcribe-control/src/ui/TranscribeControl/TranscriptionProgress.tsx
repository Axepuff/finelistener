import { Box, Button, Group, Progress, Stack, Text } from '@mantine/core';
import { IconCheck, IconInfoCircle, IconLock, IconPlayerStopFilled } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useState, type ReactNode } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { formatSecondsReadable } from 'renderer/src/shared/lib';
import { InlineAlert } from 'renderer/src/shared/InlineAlert';
import type { ForegroundOperationKind } from 'renderer/src/stores/types';

const speakerPhases = {
    preparing: 'Preparing speaker analysis',
    downloading: 'Downloading speaker component',
    converting: 'Converting audio',
    analyzing: 'Analyzing speakers',
    saving: 'Saving speaker labels',
};

const computeLabel = { auto: 'Auto', cpu: 'CPU', gpu: 'GPU' };

const languageLabel = (language: string): string => {
    if (language === 'auto') return 'Auto';
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
    } catch {
        return language;
    }
};

interface StepProps {
    number: number;
    label: string;
    status: 'current' | 'done' | 'pending';
    children?: ReactNode;
}

interface StopFailure {
    operationId: number;
    kind: ForegroundOperationKind;
    sessionId: string | null;
    message: string;
}

const Step: React.FC<StepProps> = ({ number, label, status, children }) => (
    <li className="transcription-progress__step" data-status={status} aria-current={status === 'current' ? 'step' : undefined}>
        <span className="transcription-progress__number" aria-label={status === 'done' ? 'Done' : undefined}>
            {status === 'done' ? <IconCheck size={12} aria-hidden={true} /> : number}
        </span>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600}>{label}</Text>
            {children}
        </Stack>
    </li>
);

export const TranscriptionProgress: React.FC = observer(() => {
    const store = useAppStore();
    const { transcription, speakers, activeTranscriptionSettings: settings } = store;
    const [stopPending, setStopPending] = useState(false);
    const [stopError, setStopError] = useState<StopFailure | null>(null);
    const isAnalyzing = store.operations.kind === 'analyzing-speakers';
    const recognitionStarted = isAnalyzing || transcription.recognitionStarted;
    const canStop = isAnalyzing || transcription.isRunning;
    const isFinalizing = !isAnalyzing && !transcription.isRunning;
    const transcriptionPercent = transcription.reportedProgress;
    const speakerPercent = speakers.phase === 'downloading' && speakers.totalBytes > 0 ?
        Math.min(100, 100 * speakers.downloadedBytes / speakers.totalBytes) : speakers.percent;
    const request = settings?.request;
    const options = request?.options;
    const currentStopError = stopError?.operationId === store.operations.active?.id
        && stopError?.kind === store.operations.kind && stopError?.sessionId === store.workspace.activeSessionId ? stopError : null;

    const stop = async () => {
        const operation = store.operations.active;
        if (!canStop || stopPending || !operation) return;
        const { id: operationId, kind } = operation;
        const sessionId = store.workspace.activeSessionId;
        setStopPending(true);
        setStopError(null);
        try {
            const result = isAnalyzing ? await store.stopSpeakerAnalysis() : await store.stopTranscription();
            if (!result.ok && operationId === store.operations.active?.id && kind === store.operations.kind
                && sessionId === store.workspace.activeSessionId) {
                setStopError({ operationId, kind, sessionId, message: result.message });
            }
        } finally {
            setStopPending(false);
        }
    };

    return (
        <Box className="settings-panel">
            <Stack gap={20} className="settings-panel__scroll">
                <Text component="h2" size="lg" fw={600} m={0}>{settings ? 'Transcription' : 'Speaker analysis'}</Text>
                <ol className="transcription-progress__steps">
                    <Step number={1} label="Prepare audio" status={recognitionStarted ? 'done' : 'current'}>
                        <Text size="xs" c="dimmed">{recognitionStarted ? 'Done' : 'Getting audio ready…'}</Text>
                    </Step>
                    <Step number={2} label="Transcribe" status={isAnalyzing ? 'done' : recognitionStarted ? 'current' : 'pending'}>
                        {isAnalyzing ? <Text size="xs" c="dimmed">Transcript saved</Text> : transcriptionPercent !== null ? (
                            <>
                                <Text size="xs" ff="var(--brand-font-family-code)">{Math.round(transcriptionPercent)}%</Text>
                                <Progress value={transcriptionPercent} size={4} aria-label="Transcription progress" />
                            </>
                        ) : null}
                    </Step>
                    <Step number={3} label="Identify speakers" status={isAnalyzing ? 'current' : 'pending'}>
                        {isAnalyzing ? (
                            <>
                                {speakerPercent !== null ? (
                                    <>
                                        <Text size="xs" ff="var(--brand-font-family-code)">{Math.round(speakerPercent)}%</Text>
                                        <Progress value={speakerPercent} size={4} aria-label="Speaker analysis progress" />
                                    </>
                                ) : null}
                                <ul className="transcription-progress__phases" aria-label="Speaker analysis phases">
                                    {speakers.phases.map((phase) => (
                                        <li key={phase} aria-current={phase === speakers.phase ? 'step' : undefined}>{speakerPhases[phase]}</li>
                                    ))}
                                </ul>
                                {speakers.runCompute ? <Text size="xs" c="dimmed">Nemotron 3 · {computeLabel[speakers.runCompute]}</Text> : null}
                            </>
                        ) : <Text size="xs" c="dimmed">{settings?.identifySpeakers ? 'Starts after transcription' : 'Off for this run'}</Text>}
                    </Step>
                </ol>
                {isAnalyzing ? (
                    <Group gap={8} align="flex-start" wrap="nowrap" className="transcription-progress__note" role="note">
                        <IconInfoCircle size={16} aria-hidden={true} />
                        <Text size="xs">The transcript is saved. Read it in Text or Timecodes. You can retry speaker analysis on its own.</Text>
                    </Group>
                ) : null}
                {settings && options && request ? (
                    <div className="transcription-progress__settings">
                        <Group gap={6} wrap="nowrap"><IconLock size={14} aria-hidden={true} /><Text size="sm" fw={600}>Settings for this run</Text></Group>
                        <dl>
                            <dt>Language</dt><dd>{languageLabel(options.language)}</dd>
                            <dt>Model</dt><dd>{options.modelPath ? options.modelPath.split(/[/\\]/).pop() : options.model}</dd>
                            <dt>Speakers</dt><dd>{settings.identifySpeakers ? `On · ${computeLabel[settings.speakerCompute]}` : 'Off'}</dd>
                            <dt>Range</dt><dd>{request.segment ? `${formatSecondsReadable(request.segment.start)} – ${formatSecondsReadable(request.segment.end)}` : 'Whole file'}</dd>
                            <dt>Audio version</dt><dd>{request.optimized ? 'Optimized' : 'Original'}</dd>
                            <dt>Max context</dt><dd>{options.maxContext ?? 'Default'}</dd>
                            <dt>Max length</dt><dd>{options.maxLen ?? 'Default'}</dd>
                            <dt>Split on word</dt><dd>{options.splitOnWord ? 'On' : 'Off'}</dd>
                            <dt>Voice detection</dt><dd>{options.useVad ? 'On' : 'Off'}</dd>
                            <dt>Microphone gate</dt><dd>{options.microphoneGateEnabled ? 'On' : 'Off'}</dd>
                        </dl>
                    </div>
                ) : null}
            </Stack>
            <Box className="settings-panel__footer">
                {currentStopError ? <InlineAlert severity="warning" title={isAnalyzing ? 'Could not skip speaker analysis' : 'Could not stop transcription'}
                    actions={<Button size="compact-sm" variant="default" disabled={!canStop || stopPending} onClick={() => void stop()}>
                        {isAnalyzing ? 'Retry skipping' : 'Retry stop'}
                    </Button>}>
                    {currentStopError.message}
                </InlineAlert> : null}
                {isFinalizing ? <Text size="xs" c="dimmed" id="transcription-finalizing">Finishing transcription…</Text> : null}
                <Button variant="default" onClick={() => void stop()} disabled={!canStop} loading={stopPending}
                    aria-describedby={isFinalizing ? 'transcription-finalizing' : undefined}
                    leftSection={<IconPlayerStopFilled size={12} />}>
                    {isAnalyzing ? 'Skip speaker analysis' : 'Stop transcription'}
                </Button>
            </Box>
        </Box>
    );
});
