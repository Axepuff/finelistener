import { Alert, Button, Group, Loader, Progress, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect, useState } from 'react';
import type { SessionSummary } from 'electron/src/types/sessions';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';

const SummaryActions: React.FC<{ saved?: Pick<SessionSummary, 'brief' | 'detailed' | 'generationVersion'> }> = observer(({ saved }) => {
    const store = useAppStore();
    const { summary } = store;
    const model = summary.modelStatus;
    const [showInstallation, setShowInstallation] = useState(false);
    useEffect(() => { void summary.refreshModelStatus(); }, [summary]);

    if (summary.isRunning) {
        return <Stack gap="sm" align="flex-start">
            <Group gap="xs" role="status">
                <Loader size="xs" />
                <Text size="sm">{summary.isStopping ? 'Stopping summary…' : summary.progress}</Text>
            </Group>
            <Button variant="default" disabled={summary.isStopping} onClick={() => { void summary.stop(); }}>
                Stop generation
            </Button>
        </Stack>;
    }

    if (!model && !summary.modelError) {
        return <Text size="sm" c="dimmed" role="status">Checking model availability…</Text>;
    }

    if (model?.state === 'downloading') {
        const percent = Math.min(100, Math.floor(model.downloadedBytes / model.totalBytes * 100));
        return <Stack gap="xs">
            <Group justify="space-between">
                <Text size="sm" fw={600} role="status">Downloading model</Text>
                <Text size="sm">{percent}%</Text>
            </Group>
            <Progress value={percent} aria-label="Model download" />
        </Stack>;
    }

    if (model?.state === 'ready' && !summary.modelError) {
        return <Stack gap="sm" align="flex-start">
            {summary.error && <Alert color="red" role="alert">{summary.error}</Alert>}
            {summary.stopped && <Text size="sm" role="status">Summary generation stopped.</Text>}
            {!saved?.detailed && <Text size="sm" c="dimmed">Generate a brief overview and detailed notes from the saved transcript on this computer.</Text>}
            <Button disabled={!store.canSummarize || store.operations.isBusy} onClick={() => { void store.generateSummary(); }}>
                {saved?.brief ? 'Regenerate summary' : saved?.detailed && saved.generationVersion ? 'Generate brief summary' : 'Generate summary'}
            </Button>
        </Stack>;
    }

    if (saved?.brief && !showInstallation) {
        return <Group><Button variant="default" onClick={() => setShowInstallation(true)}>Regenerate summary</Button></Group>;
    }

    return <Stack gap="sm" align="flex-start">
        {summary.modelError && <Alert color="red" role="alert">{summary.modelError}</Alert>}
        {model ? <>
            <Text size="sm" c="dimmed">
                Download {model.model} ({(model.totalBytes / 1_000_000_000).toFixed(2)} GB) once to generate summaries offline.
            </Text>
            <Button leftSection={<IconDownload size={16} />} onClick={() => { void summary.downloadModel(); }}>
                {model.state === 'error' || summary.modelError ? 'Retry download' : 'Download model'}
            </Button>
        </> : <Button variant="default" onClick={() => { void summary.refreshModelStatus(); }}>Check again</Button>}
    </Stack>;
});

export const RecordingSummary: React.FC = observer(() => {
    const store = useAppStore();
    const transcript = store.transcription.savedTranscript;
    const saved = transcript?.summary;
    const hasSummary = Boolean(saved?.brief || saved?.detailed);
    const hasTranscript = transcript?.segments.some((segment) => segment.text.trim());
    const hasCompleteTranscript = hasTranscript && !store.transcription.isIncomplete;

    return <section className={styles.summaryPanel} aria-label="Recording summary" tabIndex={0}>
        <div className={styles.summaryColumn}>
            {hasSummary && saved ? <Tabs defaultValue={saved.brief ? 'brief' : 'detailed'} keepMounted={false}>
                <Tabs.List aria-label="Summary format">
                    {saved.brief && <Tabs.Tab value="brief">Brief overview</Tabs.Tab>}
                    <Tabs.Tab value="detailed">Detailed notes</Tabs.Tab>
                </Tabs.List>
                {saved.brief && <Tabs.Panel value="brief" pt="md"><Text className={styles.summaryText}>{saved.brief}</Text></Tabs.Panel>}
                <Tabs.Panel value="detailed" pt="md"><Text className={styles.summaryText}>{saved.detailed}</Text></Tabs.Panel>
            </Tabs> : <Title order={2} size="h3">Recording summary</Title>}
            {hasCompleteTranscript ? <SummaryActions saved={saved} /> : !hasSummary && (
                <Text size="sm" c="dimmed">{store.transcription.isIncomplete ?
                    'Complete the transcription before generating a summary.' :
                    'Transcribe this recording to generate a summary.'}</Text>
            )}
        </div>
    </section>;
});
