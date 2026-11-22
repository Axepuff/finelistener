import { Box, LoadingOverlay } from '@mantine/core';
import { Player } from '@~/player';
import { RecordingStrip } from '@~/recorder';
import { ProcessLog } from '@~/process-log';
import { SessionsSidebar } from '@~/sessions';
import { TranscribeControl } from '@~/transcribe-control';
import { TranscribedText } from '@~/transcribed-text';
import { EmptyWorkspace, SHELL_SIZES, StatusBar, TitleBar } from '@~/workspace-shell';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { ResizableSidebarLayout } from 'renderer/src/shared/lib';

const panelBorder = 'var(--brand-line-width) solid var(--brand-color-border)';

export const Home: React.FC = observer(() => {
    const store = useAppStore();
    const [isLogOpen, setIsLogOpen] = useState(false);
    const hasOpenSession = store.workspace.activeSessionId !== null;
    const showWorkspace = hasOpenSession || store.recordingInProgress;

    const preventConflictingFileDrop: React.DragEventHandler = (event) => {
        const { dataTransfer } = event;
        if (!store.operations.isBusy || !dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        dataTransfer.dropEffect = 'none';
    };

    return (
        <Box
            onDragOverCapture={preventConflictingFileDrop}
            onDropCapture={preventConflictingFileDrop}
            style={{
                height: '100vh',
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                position: 'relative',
                background: 'var(--brand-color-bg-layout)',
            }}
        >
            <LoadingOverlay visible={store.lifecycleState === 'importing'} overlayProps={{ blur: 2 }} />
            <TitleBar />
            {showWorkspace ? (
                <Box
                    component="section"
                    aria-label={store.recordingInProgress ? 'Recording monitor' : 'Audio player'}
                    style={{ flex: '0 0 auto', background: 'var(--brand-color-bg-container)', borderBottom: panelBorder }}
                >
                    {store.recordingInProgress ? <RecordingStrip /> : <Player />}
                </Box>
            ) : null}
            <ResizableSidebarLayout
                contentMinWidth={SHELL_SIZES.transcriptMinWidth}
                leftSidebar={{
                    ...SHELL_SIZES.sessionsPanel,
                    widthPreferenceKey: 'homeSidebarWidth',
                    separatorAriaLabel: 'Resize sessions panel',
                    node: (
                        <Box component="nav" aria-label="Sessions" h="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
                            <SessionsSidebar />
                        </Box>
                    ),
                }}
                rightSidebar={showWorkspace ? {
                    ...SHELL_SIZES.settingsPanel,
                    widthPreferenceKey: 'homeRightSidebarWidth',
                    separatorAriaLabel: 'Resize settings panel',
                    node: (
                        <Box
                            component="aside"
                            aria-label="Transcription settings"
                            h="100%"
                            bg="var(--brand-color-bg-layout)"
                            style={{ minHeight: 0, overflow: 'hidden' }}
                        >
                            <TranscribeControl />
                        </Box>
                    ),
                } : undefined}
                content={(
                    <Box component="main" h="100%" bg="var(--brand-color-bg-container)" style={{ minHeight: 0, overflow: 'hidden' }}>
                        {showWorkspace ? <TranscribedText /> : <EmptyWorkspace />}
                    </Box>
                )}
            />
            {isLogOpen ? (
                // Overlays the panels instead of taking space from them, so they stay usable
                // at the minimum window height.
                <Box
                    component="section"
                    aria-label="Process log"
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: SHELL_SIZES.statusBarHeight,
                        height: `min(${SHELL_SIZES.logHeight}px, 40vh)`,
                        zIndex: 10,
                        background: 'var(--brand-color-bg-container)',
                        borderTop: panelBorder,
                        boxShadow: 'var(--mantine-shadow-md)',
                    }}
                >
                    <ProcessLog />
                </Box>
            ) : null}
            <StatusBar isLogOpen={isLogOpen} onToggleLog={() => setIsLogOpen((open) => !open)} />
        </Box>
    );
});
