import { Button, Tabs } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { computed } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useId, useMemo, useState } from 'react';
import type { ReviewedSummaryChunk, SessionSummary, SessionTranscriptV1 } from 'electron/src/types/sessions';
import { useAppStore } from 'renderer/src/AppContext';
import { formatSecondsReadable } from 'renderer/src/shared/lib';
import { speakerLabelsFor, unknownSpeaker } from 'renderer/src/stores/speakerReadingFormat';
import type { DeepReadonly } from 'renderer/src/stores/types';
import styles from './RecordingSummary.module.css';

export type SummaryFormat = 'brief' | 'detailed';

interface Props {
    transcript: DeepReadonly<SessionTranscriptV1>;
    saved: DeepReadonly<SessionSummary>;
    format: SummaryFormat;
    onFormatChange: (format: SummaryFormat) => void;
}

const SummaryParagraphs: React.FC<{ text: string }> = ({ text }) => <>
    {text.split(/\r?\n[ \t]*\r?\n/u).map((paragraph, index) => paragraph
        && <p key={index} className={styles.paragraph}>{paragraph}</p>)}
</>;

const timeLabel = (seconds: number) => {
    const formatted = formatSecondsReadable(seconds);
    return formatted.startsWith('00:') ? formatted.slice(3) : formatted;
};

const sourceLinesFor = (chunk: DeepReadonly<ReviewedSummaryChunk>, transcript: Props['transcript']) => {
    // The session reader strips references when the exact source revision no longer matches.
    if (!transcript.summary?.sourceRevision || !chunk.sourceRefs?.length) return null;
    const lines = [];
    for (const { segmentIndex, segmentId, source, startChar, endChar } of chunk.sourceRefs) {
        if (!Number.isInteger(segmentIndex) || segmentIndex < 0) return null;
        const segment = transcript.segments[segmentIndex];
        if (!segment || segment.id !== segmentId || segment.source !== source
            || !Number.isInteger(startChar) || !Number.isInteger(endChar)
            || startChar < 0 || endChar <= startChar || endChar > segment.text.length) return null;
        lines.push(segment.text.slice(startChar, endChar));
    }
    return lines;
};

interface ChunkProps {
    chunk: DeepReadonly<ReviewedSummaryChunk>;
    transcript: Props['transcript'];
    labels: ReturnType<typeof speakerLabelsFor>;
    current: boolean;
    canPlay: boolean;
    onPlay: (seconds: number) => void;
}

const SummaryChunk: React.FC<ChunkProps> = ({ chunk, transcript, labels, current, canPlay, onPlay }) => {
    const [showSource, setShowSource] = useState(false);
    const sourceId = useId();
    const range = `${timeLabel(chunk.startSec)} – ${timeLabel(chunk.endSec)}`;
    const sourceLines = useMemo(() => sourceLinesFor(chunk, transcript), [chunk, transcript]);

    return <article className={styles.chunk} aria-label={range} aria-current={current || undefined}>
        <div className={styles.row}>
            <span className={styles.time}>{range}</span>
            {chunk.speakers?.filter(({ name }) => name !== null).map(({ name, id }, index) => {
                const colors = labels.get(id ?? '') ?? unknownSpeaker;
                return <span key={id ?? index} className={styles.speaker}
                    style={{ color: colors.color, background: colors.clipboardBackground, borderColor: colors.accent }}>{name}</span>;
            })}
            <div className={`${styles.row} ${styles.trailing}`}>
                <Button size="compact-sm" variant="subtle" className={styles.play} disabled={!canPlay}
                    leftSection={<IconPlayerPlayFilled size={12} aria-hidden="true" />} onClick={() => onPlay(chunk.startSec)}>
                    Play
                </Button>
                {sourceLines && <Button size="compact-sm" variant="subtle" className={styles.link}
                    aria-expanded={showSource} aria-controls={sourceId} onClick={() => setShowSource(!showSource)}>
                    {showSource ? 'Hide source' : 'Show source'}
                </Button>}
            </div>
        </div>
        <p className={styles.paragraph}>{chunk.text}</p>
        {sourceLines && <div id={sourceId} hidden={!showSource} className={styles.source}>
            {showSource && sourceLines.map((line, index) => <p key={index}>{line}</p>)}
        </div>}
    </article>;
};

const generatedDate = new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export const SummaryResult: React.FC<Props> = observer(({ transcript, saved, format, onFormatChange }) => {
    const { workspace } = useAppStore();
    const headingId = useId();
    const labels = useMemo(() => speakerLabelsFor(transcript), [transcript]);
    const chunks = useMemo(() => saved.reviewedChunks?.map((chunk, index) => ({ chunk, index }))
        .sort((a, b) => a.chunk.startSec - b.chunk.startSec) ?? [], [saved.reviewedChunks]);
    const playingIndex = useMemo(() => computed(() => {
        if (!workspace.isPlaying) return -1;
        const position = workspace.playbackPosition;
        return chunks.findLastIndex(({ chunk }) => position >= chunk.startSec && position < chunk.endSec);
    }), [chunks, workspace]).get();
    const date = saved.generatedAt === undefined ? null : new Date(saved.generatedAt);
    const hasDate = date && Number.isFinite(date.getTime());

    return <section aria-labelledby={headingId}>
        <Tabs value={format} onChange={(value) => {
            if (value === 'brief' || value === 'detailed') onFormatChange(value);
        }} keepMounted={false} classNames={{ list: styles.formats, tab: styles.format }}>
            <div className={styles.resultHeading}>
                <div>
                    <h2 id={headingId}>Summary</h2>
                    {(hasDate || chunks.length > 0) && <div className={styles.caption}>
                        {hasDate && <>Generated <time dateTime={date.toISOString()}>{generatedDate.format(date)}</time></>}
                        {hasDate && chunks.length > 0 && ' · '}
                        {chunks.length > 0 && <span>Chunks used: {chunks.length}</span>}
                    </div>}
                </div>
                {saved.brief && <Tabs.List aria-label="Summary format">
                    <Tabs.Tab value="brief">Brief overview</Tabs.Tab>
                    <Tabs.Tab value="detailed">Detailed notes</Tabs.Tab>
                </Tabs.List>}
            </div>
            {saved.brief && <Tabs.Panel value="brief" className={styles.brief}><SummaryParagraphs text={saved.brief} /></Tabs.Panel>}
            <Tabs.Panel value="detailed" className={chunks.length ? styles.chunks : styles.brief}
                aria-label={saved.brief ? undefined : 'Detailed notes'}>
                {chunks.length ? chunks.map(({ chunk, index }, position) => <SummaryChunk key={index} chunk={chunk}
                    transcript={transcript} labels={labels} current={position === playingIndex}
                    canPlay={Boolean(workspace.audioSourcePath && !workspace.isPlayerLoading)}
                    onPlay={(seconds) => workspace.requestPlaybackTime(seconds, 'play')} />) :
                    <SummaryParagraphs text={saved.detailed} />}
            </Tabs.Panel>
        </Tabs>
    </section>;
});
