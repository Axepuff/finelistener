import { Button, Progress } from '@mantine/core';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import type { SummaryModelStatus } from 'electron/src/types/summaryModel';
import type React from 'react';
import styles from './RecordingSummary.module.css';

interface Props {
    model: SummaryModelStatus | null;
    error: string | null;
    onCheck: () => void;
    onDownload: () => void;
    onCancel: () => void;
}

const gigabytes = (bytes: number) => (bytes / 1_000_000_000).toFixed(2);

export const SummaryModelCard: React.FC<Props> = ({ model, error, onCheck, onDownload, onCancel }) => {
    if (!model || model.state === 'ready') {
        return error ? <div role="alert" className={styles.alert}>
            <span>{error}</span>
            <Button size="compact-sm" variant="default" onClick={onCheck}>Check again</Button>
        </div> : <span role="status" className={styles.caption}>Checking model availability…</span>;
    }

    const size = `${gigabytes(model.totalBytes)} GB`;
    if (model.error === 'disk-space') {
        return <section role="alert" className={styles.alert}>
            <IconAlertCircle size={16} aria-hidden="true" />
            <div className={styles.alertBody}>
                <strong>Not enough disk space</strong>
                <span>The summary model needs {size}. Free up space on this disk and try again.</span>
                {model.downloadedBytes > 0 && <span>{gigabytes(model.downloadedBytes)} / {size} downloaded</span>}
                <Button size="compact-sm" onClick={onDownload}>Try again</Button>
            </div>
        </section>;
    }

    if (model.state === 'missing' && !error) {
        return <section aria-label="Summary model" className={`${styles.model} ${styles.modelMissing}`}>
            <span className={styles.modelIcon}><IconDownload size={20} aria-hidden="true" /></span>
            <div className={styles.modelBody}>
                <div>
                    <h2>Summaries need a local model</h2>
                    <p>Download it once to generate a brief overview and detailed notes offline. The transcript stays on this computer.</p>
                </div>
                <div className={styles.caption}><span className={styles.time}>{model.model}</span> · {size}</div>
                <Button size="sm" onClick={onDownload}>Download model · {size}</Button>
            </div>
        </section>;
    }

    const downloading = model.state === 'downloading';
    const failed = model.state === 'error' || Boolean(error);
    const percent = model.totalBytes > 0 ?
        Math.round(Math.max(0, Math.min(100, model.downloadedBytes / model.totalBytes * 100))) : 0;
    const headline = downloading ? `Downloading summary model… ${percent}%` :
        model.downloadedBytes > 0 ? `Summary model download stopped at ${percent}%` :
            failed ? 'Summary model download failed' : 'Summary model download cancelled';

    return <section aria-label="Summary model" className={`${styles.model} ${failed ? styles.modelError : ''}`}>
        <div className={styles.row}>
            <h2 role={downloading || !failed ? 'status' : undefined} className={styles.grow}>{headline}</h2>
            <span className={styles.time}>{gigabytes(model.downloadedBytes)} / {size}</span>
        </div>
        <Progress value={percent} size={6} radius={1} color={failed ? 'var(--brand-color-error)' : 'var(--brand-color-primary)'}
            aria-label="Summary model download" />
        <div className={styles.row}>
            {error ? <span role="alert" className={styles.grow}>{error}</span> :
                downloading && <span className={`${styles.caption} ${styles.grow}`}>You can keep reading, recording and transcribing meanwhile.</span>}
            <Button className={styles.trailing} size="compact-sm" variant={failed && !downloading ? 'filled' : 'default'}
                onClick={downloading ? onCancel : onDownload}>
                {downloading ? 'Cancel download' : 'Retry download'}
            </Button>
        </div>
    </section>;
};
