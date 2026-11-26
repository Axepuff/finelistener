import { ActionIcon, Alert, Button, Center, Paper, SegmentedControl, Stack, Text, ThemeIcon } from '@mantine/core';
import { InlineAlert } from 'renderer/src/shared/InlineAlert';
import { IconHeadphones, IconMicrophone, IconPlus } from '@tabler/icons-react';
import { computed } from 'mobx';
import { observer } from 'mobx-react-lite';
import React, { useMemo, useState, type MouseEvent } from 'react';
import type { SessionSpeakerAssignment } from 'electron/src/types/sessions';
import { formatTranscriptSourcePrefix, projectTranscript, transcriptToHtml, transcriptToText, type TranscriptView } from 'renderer/src/stores/transcriptFormat';
import { projectSpeakerReading } from 'renderer/src/stores/speakerReading';
import { speakerLabelsFor, speakerReadingToHtml, unknownSpeaker } from 'renderer/src/stores/speakerReadingFormat';
import { useAppStore } from '../../../../../AppContext';
import { RecordingSummary, type SummaryContinuation } from './RecordingSummary';
import type { SummaryFormat } from './SummaryResult';
import { TranscribedTextContent } from './TranscribedTextContent';
import { TranscribedTextControls, TranscriptViewSwitch } from './TranscribedTextControls';
import { SpeakerAnalysisStatus, SpeakerControls } from './SpeakerControls';
import { findTranscriptMatches } from './search';
import { escapeHtml, formatSecondsReadable } from 'renderer/src/shared/lib';
import { projectTextSentences } from 'renderer/src/stores/plainText';
import styles from './TranscribedText.module.css';

interface Props {
    summaryContinuation?: SummaryContinuation;
}

export const TranscribedText: React.FC<Props> = observer(({ summaryContinuation }) => {
    const store = useAppStore();
    const { transcription } = store;
    const [selectedView, setView] = useState<TranscriptView | 'summary'>('plain');
    const { recordingInProgress, exportBlockReason } = store;
    const recordingViewReason = store.operations.kind === 'recording' ? 'Transcript views are available after you stop recording.' :
        'Transcript views are available after the recording is saved.';
    const viewLockReasons = recordingInProgress ? {
        plain: recordingViewReason, timecodes: recordingViewReason, speakers: recordingViewReason, summary: recordingViewReason,
    } : exportBlockReason ? {
        speakers: transcription.savedTranscript?.speakers?.status === 'completed' ? undefined : 'Speakers is available once speaker labels are ready.',
        summary: transcription.savedTranscript?.summary || transcription.savedTranscript?.summaryDraft ? undefined : 'Summary is available after processing finishes.',
    } : {};
    const view = viewLockReasons[selectedView] ? 'plain' : selectedView;
    const [summarySelection, setSummarySelection] = useState<{ sessionId: string | null; format: SummaryFormat }>();
    const [speakerLayout, setSpeakerLayout] = useState<'reading' | 'dialogue'>('reading');
    const transcriptView = view === 'summary' ? 'plain' : view;
    const showRegions = transcriptView !== 'plain';
    const showSpeakers = view === 'speakers';
    const showReading = showSpeakers && speakerLayout === 'reading';
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
    const [selectedSpan, setSelectedSpan] = useState<{
        sessionId: string | null;
        generation: string | undefined;
        span: SessionSpeakerAssignment;
    } | null>(null);
    const transcriptForView = showSpeakers && exportBlockReason ? transcription.savedTranscript : transcription.visibleTranscript;
    const needsSpeakerAnalysis = showSpeakers && transcriptForView?.speakers?.status !== 'completed';
    const displayedTranscript = needsSpeakerAnalysis || view === 'summary' ? null : transcriptForView;
    const savedSummary = view === 'summary' ? transcription.savedTranscript?.summary : undefined;
    const { activeSessionId } = store.workspace;
    const summaryFormat = !savedSummary?.brief ? 'detailed' :
        summarySelection?.sessionId === activeSessionId ? summarySelection.format : 'brief';
    const reading = useMemo(() => showReading ? projectSpeakerReading(displayedTranscript) : undefined, [showReading, displayedTranscript]);
    const currentTextValue = useMemo(() => reading ? reading.map((paragraph) => paragraph.text.trim()).join('\n\n') :
        transcriptToText(displayedTranscript, transcriptView), [reading, displayedTranscript, transcriptView]);
    const isInitialEmptyState = (
        store.lifecycleState === 'initial'
        || store.lifecycleState === 'importing'
    ) && currentTextValue.trim().length === 0;
    const isReadyEmptyState = store.transcriptionWorkflow.state === 'loaded';
    const audioTitle = store.workspace.activeSession?.title;
    const speakerLabels = useMemo(() => speakerLabelsFor(displayedTranscript), [displayedTranscript]);
    const savedSpeakers = transcription.savedTranscript?.speakers;
    const plainSegments = useMemo(() => {
        if (reading) return [];
        if (!showRegions) return projectTextSentences(displayedTranscript);

        return projectTranscript(displayedTranscript, transcriptView).map((turn, index) => {
            const startLabel = formatSecondsReadable(turn.startSec);
            const timecode = transcriptView === 'timecodes' && turn.endSec !== null ?
                `${startLabel} – ${formatSecondsReadable(turn.endSec)}` : startLabel;
            return {
                id: turn.members.map(({ segment: { rawSpan } }) => rawSpan ?
                     `${rawSpan.segmentId}:${rawSpan.startChar}:${rawSpan.endChar}` : `legacy-${index}`).join('|'),
                text: turn.text,
                prefix: formatTranscriptSourcePrefix(turn),
                startSeconds: turn.startSec,
                playbackStartSeconds: turn.startSec,
                endSeconds: turn.endSec,
                timecode,
                speaker: showSpeakers ? speakerLabels.get(turn.speakerId ?? '') ?? unknownSpeaker : undefined,
                source: turn.source,
                assignment: showSpeakers && savedSpeakers && turn.members.every(({ segment }) => segment.rawSpan) ? {
                    generation: savedSpeakers.generation,
                    recognitionRevision: savedSpeakers.recognitionRevision,
                    spans: turn.members.map(({ segment }) => ({ ...segment.rawSpan! })),
                } : undefined,
                children: showSpeakers ? turn.members.map(({ segment }) => ({ segment })) : undefined,
            };
        });
    }, [displayedTranscript, reading, savedSpeakers, showRegions, showSpeakers, speakerLabels, transcriptView]);
    const currentSelectedSpan = selectedSpan?.sessionId === store.workspace.activeSessionId
        && selectedSpan.generation === savedSpeakers?.generation ? selectedSpan.span : null;
    const matches = useMemo(() => findTranscriptMatches(reading ?? plainSegments, searchQuery, reading || !showRegions ? '' : ' '),
        [reading, plainSegments, searchQuery, showRegions]);
    const playingRows = useMemo(() => computed(() => {
        if (!store.workspace.isPlaying || plainSegments.length === 0) return [];
        const position = store.workspace.playbackPosition;
        return plainSegments.map((row, index) => {
            const nextStart = plainSegments[index + 1]?.playbackStartSeconds;
            const end = row.endSeconds ?? (nextStart > row.playbackStartSeconds ? nextStart : Infinity);
            return position >= row.playbackStartSeconds && position < end;
        });
    }, { equals: (left, right) => left.length === right.length && left.every((value, index) => value === right[index]) }), [store.workspace, plainSegments]).get();
    const showUnknown = showReading ?
        reading?.some(({ words }) => words.some(({ speakerId }) => speakerId === null)) ?? false :
        plainSegments.some((row) => 'speaker' in row && row.speaker === unknownSpeaker);
    const activeMatchIndex = matches.length > 0 ? Math.min(selectedMatchIndex, matches.length - 1) : -1;

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setSelectedMatchIndex(0);
    };

    const moveToMatch = (direction: -1 | 1) => {
        if (matches.length === 0) return;
        setSelectedMatchIndex((index) => (Math.min(index, matches.length - 1) + direction + matches.length) % matches.length);
    };

    const handleRegionClick = (event: MouseEvent<HTMLElement>) => {
        const region = (event.target as HTMLElement).closest<HTMLElement>('[data-regions]')?.dataset.regions;
        if (region === undefined || (event.detail > 0 && window.getSelection()?.isCollapsed === false)) return;

        store.workspace.requestPlaybackTime(Number(region), showReading || view === 'plain' ? 'play' : 'seek');
    };

    const speakerControls = showSpeakers ? (
        <SpeakerControls
            key={store.workspace.activeSessionId ?? ''}
            selectedSpan={currentSelectedSpan}
            onCloseSpan={() => setSelectedSpan(null)}
            labels={needsSpeakerAnalysis ? undefined : speakerLabels}
            showUnknown={showUnknown}
        >
            {!needsSpeakerAnalysis ? (
                <SegmentedControl
                    aria-label="Speaker view"
                    classNames={{ root: styles.speakerToggle, label: styles.toggleLabel }}
                    data={[{ value: 'dialogue', label: 'Dialogue' }, { value: 'reading', label: 'Reading' }]}
                    value={speakerLayout}
                    onChange={(value) => {
                        if (value === 'reading' || value === 'dialogue') {
                            setSpeakerLayout(value);
                            setSelectedSpan(null);
                            setSelectedMatchIndex(0);
                        }
                    }}
                />
            ) : null}
        </SpeakerControls>
    ) : undefined;

    const handlePick = async () => {
        const result = await store.importAudio();

        if (!result.ok) {
            store.activityLog.appendEvent(result.message);
        }
    };


    return (
        <Stack gap={showSpeakers ? 10 : 16} align="stretch" style={{ width: '100%', minWidth: 0, minHeight: 0, height: '100%', padding: 16, overflow: 'hidden' }}>
            {recordingInProgress ? (
                <>
                    <TranscriptViewSwitch view={view} onViewChange={setView} viewLockReasons={viewLockReasons} />
                    <Center style={{ flex: 1 }}>
                        <Stack gap={12} align="center" maw={370} ta="center">
                            <ThemeIcon size={48} radius="xl" variant="light" color="red"><IconMicrophone size={22} /></ThemeIcon>
                            <Text component="h2" size="lg" fw={600} m={0}>{store.operations.kind === 'recording' ? 'Recording in progress' : 'Saving recording…'}</Text>
                            <Text size="sm" c="dimmed">The transcript appears after you stop recording and transcribe the audio.</Text>
                        </Stack>
                    </Center>
                </>
            ) : isInitialEmptyState ? (
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
                            <IconPlus size={30} color="var(--brand-color-text-tertiary)" />
                        </ActionIcon>

                        <Text size="md" fw={600} c="var(--brand-color-text)" ta="center">
                            {'No transcription available yet'}
                        </Text>
                        <Text size="sm" c="var(--brand-color-text-secondary)" ta="center">
                            {'Upload a file and click "Transcribe" to see the result here.'}
                        </Text>
                    </Stack>
                </Paper>
            ) : (
                <>
                    <TranscribedTextControls
                        currentTextValue={view === 'summary' ? savedSummary?.[summaryFormat] ?? '' : currentTextValue}
                        getClipboardHtml={() => {
                            if (view === 'summary') return `<div style="white-space: pre-wrap">${escapeHtml(savedSummary?.[summaryFormat] ?? '')}</div>`;
                            return reading ? speakerReadingToHtml(reading, speakerLabels) : transcriptToHtml(displayedTranscript, transcriptView);
                        }}
                        view={view}
                        viewLockReasons={viewLockReasons}
                        onViewChange={(value) => { setView(value); setSelectedSpan(null); setSelectedMatchIndex(0); }}
                        searchQuery={searchQuery}
                        onSearchChange={handleSearchChange}
                        matchCount={matches.length}
                        activeMatchIndex={activeMatchIndex}
                        onPreviousMatch={() => moveToMatch(-1)}
                        onNextMatch={() => moveToMatch(1)}
                    />
                    {view === 'summary' ? <RecordingSummary key={activeSessionId} format={summaryFormat} continuation={summaryContinuation ?? store.summaryContinuation}
                        onFormatChange={(format) => setSummarySelection({ sessionId: activeSessionId, format })} /> : (
                        <>
                            {needsSpeakerAnalysis || isReadyEmptyState ? speakerControls : null}
                            <SpeakerAnalysisStatus />

                            {transcription.duplicateFilterFailed ? (
                                <Alert color="yellow" title="Duplicate filtering unavailable">
                                    {'The unfiltered transcript is shown. Try the filter again.'}
                                </Alert>
                            ) : null}
                            {store.workspace.activeSession?.tracks?.some((track) => track.failure) ? (
                                <InlineAlert severity="warning" title="Recording source stopped early" actions={<Button size="compact-sm" variant="default" onClick={() => store.workspace.requestPlaybackTime(0, 'play')}>Play captured audio</Button>}>
                                    {'A recording source stopped early. Only the captured audio is available.'}
                                    {store.workspace.activeSession?.tracks?.filter((track) => track.failure).map((track) => <Text size="xs" key={track.source}>{track.source === 'system' ? 'System audio' : 'Microphone'} stopped early.</Text>)}
                                </InlineAlert>
                            ) : null}
                            {isReadyEmptyState ? (
                                <Paper
                                    role="status"
                                    style={{
                                        width: '100%',
                                        minHeight: 0,
                                        flex: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Stack gap={12} align="center" style={{ maxWidth: 360, padding: 16, textAlign: 'center' }}>
                                        <ThemeIcon size={64} variant="light" color="red">
                                            <IconHeadphones size={30} />
                                        </ThemeIcon>
                                        <Text size="lg" fw={600}>
                                            {'Audio is ready to transcribe'}
                                        </Text>
                                        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                                            {audioTitle ?
                                                `Transcribe the audio to see the text for ${audioTitle} here.` :
                                                'Transcribe the audio to see the text here.'}
                                        </Text>
                                    </Stack>
                                </Paper>
                            ) : needsSpeakerAnalysis ? (
                                <Text size="sm" c="dimmed">
                                    {'The transcript will appear here after speaker analysis.'}
                                </Text>
                            ) : (
                                <TranscribedTextContent
                                    reading={reading ? { paragraphs: reading, labels: speakerLabels } : undefined}
                                    speakerHeader={speakerControls}
                                    showRegions={showRegions}
                                    playingRows={playingRows}
                                    selectedRange={view === 'timecodes' ? store.workspace.selectedSegment : null}
                                    plainSegments={plainSegments}
                                    matches={matches}
                                    activeMatchIndex={activeMatchIndex}
                                    searchQuery={searchQuery}
                                    transcriptText={currentTextValue}
                                    onRegionClick={handleRegionClick}
                                    onEditSpeaker={showSpeakers && !store.operations.isBusy && transcription.savedTranscript?.speakers ? (span) => setSelectedSpan({
                                        sessionId: store.workspace.activeSessionId,
                                        generation: transcription.savedTranscript?.speakers?.generation,
                                        span,
                                    }) : undefined}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </Stack>
    );
});
