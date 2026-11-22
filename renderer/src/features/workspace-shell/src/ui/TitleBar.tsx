import { Box, Button, Divider, Group, Loader, Text } from '@mantine/core';
import { IconPlayerStopFilled, IconUpload } from '@tabler/icons-react';
import { formatDuration, useSystemAudioRecorder } from '@~/recorder';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { SHELL_SIZES } from '../model/shellSizes';
import './TitleBar.css';

// Room for the macOS traffic-light buttons drawn over the hidden-inset title bar.
const MAC_WINDOW_CONTROLS_INSET = 84;

const languageLabel = (language: string) => {
    if (language === 'auto') return 'Auto';
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
    } catch {
        return language;
    }
};

const RecordingDot: React.FC = () => (
    <Box component="span" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--brand-color-error)' }} />
);

export const TitleBar: React.FC = observer(() => {
    const store = useAppStore();
    const session = store.workspace.activeSession;
    const { controls: recorder } = useSystemAudioRecorder();
    const isRecording = store.operations.kind === 'recording';
    const isTranscribing = store.operations.kind === 'transcribing';

    const handleImport = async () => {
        const result = await store.importAudio();

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    };

    return (
        <Group
            component="header"
            className="workspace-title-bar"
            gap={12}
            wrap="nowrap"
            h={SHELL_SIZES.titleBarHeight}
            pr={16}
            pl={store.runtimePlatform === 'darwin' ? MAC_WINDOW_CONTROLS_INSET : 16}
            style={{
                flex: `0 0 ${SHELL_SIZES.titleBarHeight}px`,
                background: 'var(--brand-color-bg-container)',
                borderBottom: 'var(--brand-line-width) solid var(--brand-color-border)',
            }}
        >
            <Text size="sm" fw={600} style={{ flexShrink: 0 }}>{'FineListener'}</Text>
            {session || isRecording ? (
                <>
                    <Divider orientation="vertical" my={16} />
                    <Group className="workspace-title-bar__session" gap={8} wrap="nowrap">
                        {session ? <Text size="sm" fw={600} truncate="end" title={session.title}>{session.title}</Text> : null}
                        {isRecording || isTranscribing ? (
                            <Box component="span" role="status" className="workspace-title-bar__status" data-recording={isRecording || undefined}>
                                {isRecording ? <RecordingDot /> : <Loader size={12} />}
                                {isRecording ? `Recording ${formatDuration(recorder.recordingDurationMs).padStart(5, '0')}` : `Transcribing… ${Math.round(store.transcription.progress)}%`}
                            </Box>
                        ) : session ? (
                            <>
                                <Box component="span" className="workspace-title-bar__language">
                                    {languageLabel(session.transcription?.language ?? 'auto')}
                                </Box>
                                <Text className="workspace-title-bar__saved" size="xs" c="var(--brand-color-text-secondary)">
                                    {`Saved · ${new Date(session.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`}
                                </Text>
                            </>
                        ) : null}
                    </Group>
                </>
            ) : null}
            {!session && !isRecording ? <Box style={{ flex: 1 }} /> : null}
            <Button
                variant="default"
                leftSection={<IconUpload size={16} />}
                onClick={() => void handleImport()}
                disabled={store.operations.isBusy}
                style={{ flexShrink: 0 }}
            >
                {'Import audio'}
            </Button>
            {recorder.isRecordingActive ? (
                <Button
                    leftSection={<IconPlayerStopFilled size={12} color="var(--brand-color-error)" />}
                    onClick={recorder.onStopRecording}
                    disabled={!recorder.canStopRecording}
                    style={{ flexShrink: 0 }}
                >
                    {'Stop recording'}
                </Button>
            ) : (
                <Button
                    leftSection={<RecordingDot />}
                    onClick={recorder.onStartRecording}
                    disabled={!recorder.canStartRecording}
                    style={{ flexShrink: 0 }}
                >
                    {'Start recording'}
                </Button>
            )}
        </Group>
    );
});
