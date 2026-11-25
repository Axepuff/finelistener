import { Text } from '@mantine/core';
import type { RecordingLevel } from 'electron/src/services/RecordingService';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import { formatRecordingClock } from './core/recordingUtils';
import styles from './RecordingStrip.module.css';

const segmentCount = 30;
const minimumDb = -60;

interface SourceMeterProps {
    label: string;
    level?: RecordingLevel | null;
}

const SourceMeter: React.FC<SourceMeterProps> = ({ label, level }) => {
    const peakDb = level && Number.isFinite(level.peak) ? 20 * Math.log10(Math.max(0, Math.min(1, level.peak))) : null;
    const meterValue = peakDb === null ? undefined : Math.max(minimumDb, peakDb);
    const lit = meterValue === undefined ? 0 : Math.round(segmentCount * (meterValue - minimumDb) / -minimumDb);
    const dbLabel = peakDb === null ? 'Unavailable' : peakDb < minimumDb ? '< −60 dB' : `${Math.round(peakDb)} dB`;

    return (
        <div className={styles.source}>
            <Text size="xs">{label}</Text>
            <div className={styles.meter} role={meterValue === undefined ? undefined : 'meter'}
                aria-label={meterValue === undefined ? undefined : `${label} peak level`}
                aria-valuemin={meterValue === undefined ? undefined : minimumDb}
                aria-valuemax={meterValue === undefined ? undefined : 0} aria-valuenow={meterValue}
                aria-valuetext={meterValue === undefined ? undefined : dbLabel}
                aria-hidden={meterValue === undefined || undefined}>
                {Array.from({ length: segmentCount }, (_, index) => (
                    <span key={index} data-lit={index < lit || undefined}
                        data-zone={index >= 27 ? 'red' : index >= 22 ? 'orange' : 'green'} />
                ))}
            </div>
            <Text size="xs" className={styles.value} aria-hidden={meterValue !== undefined || undefined}>{dbLabel}</Text>
        </div>
    );
};

const formatWrittenSize = (bytes: number): string => {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
};

export const RecordingStrip: React.FC = observer(() => {
    const store = useAppStore();
    const { recordingDurationMs, recordingBytesWritten, recordingSources, recordingLevel, sourceLevels } = store.recording.session;

    return (
        <div className={styles.strip}>
            <div className={styles.stats}>
                <div className={styles.clock} role="timer" aria-label="Recording duration">{formatRecordingClock(recordingDurationMs)}</div>
                <Text size="xs" c="dimmed">
                    {recordingBytesWritten === null || !Number.isFinite(recordingBytesWritten) ? 'Written size unavailable' : <>Written <span className={styles.value}>{formatWrittenSize(recordingBytesWritten)}</span></>}
                    {' · saved to disk as it records'}
                </Text>
            </div>
            {recordingSources.length > 0 ? (
                <div className={styles.meters}>
                    {recordingSources.map((source) => (
                        <SourceMeter key={source} label={source === 'system' ? 'System audio' : 'Microphone'}
                            level={sourceLevels[source] ?? (store.runtimePlatform !== 'win32' ? recordingLevel : null)} />
                    ))}
                    {store.recording.silentSources.map((source) => <Text key={source} size="xs" c="yellow.8" role="status">
                        No audio from {source === 'system' ? 'system audio' : 'microphone'} for 30 s. Check the selected recording devices. Recording continues.
                    </Text>)}
                </div>
            ) : null}
            <Text size="xs" className={styles.placeholder}>The waveform and player appear after you stop recording.</Text>
        </div>
    );
});
