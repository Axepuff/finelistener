import { InlineAlert, ShowInLog } from 'renderer/src/shared/InlineAlert';
import { Badge, Button, Loader, Textarea } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState } from 'react';
import {
    defaultRecordingSummaryOptions, isRecordingSummaryOptions, maxSummaryPromptLength,
    recordingSummaryGenerationVersion, sameRecordingSummaryOptions, type RecordingSummaryOptions,
} from '../../../../../../../electron/src/types/summaryOptions';
import { useAppStore } from 'renderer/src/AppContext';
import { SummaryModelCard } from './SummaryModelCard';
import { SummaryPresets } from './SummaryPresets';
import { SummaryResult, type SummaryFormat } from './SummaryResult';
import styles from './RecordingSummary.module.css';

export interface SummaryContinuation {
    // Options of the compatible checkpoint supplied by the caller.
    options: Readonly<RecordingSummaryOptions>;
    onContinue: () => void;
}

interface Props {
    format: SummaryFormat;
    onFormatChange: (format: SummaryFormat) => void;
    continuation?: SummaryContinuation;
}

export const RecordingSummary: React.FC<Props> = observer(({ format, onFormatChange, continuation }) => {
    const store = useAppStore();
    const { summary, transcription } = store;
    const transcript = transcription.savedTranscript;
    const saved = transcript?.summary;
    const hasSummary = Boolean(saved?.brief || saved?.detailed);
    const hasCompleteTranscript = Boolean(!transcription.isIncomplete
        && transcript?.segments.some((segment) => segment.text.trim()));
    const model = summary.modelStatus;
    const modelReady = model?.state === 'ready' && !summary.modelError;
    const failure = summary.generationFailure;
    const currentFailure = failure?.sessionId === store.workspace.activeSessionId ? failure : null;
    const rejectedPrompt = currentFailure?.reason === 'prompt-too-long' ? currentFailure.prompt : undefined;
    const promptId = useId();
    const hintId = useId();
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const prompt = summary.runningOptions?.prompt ?? summary.editedPrompt ?? rejectedPrompt ?? continuation?.options.prompt ??
        saved?.options?.prompt ?? defaultRecordingSummaryOptions.prompt;
    const [editing, setEditing] = useState(false);
    const [showInstallation, setShowInstallation] = useState(false);

    useEffect(() => {
        if (hasCompleteTranscript) void summary.refreshModelStatus();
    }, [hasCompleteTranscript, summary]);
    useEffect(() => {
        if (editing) promptRef.current?.focus();
    }, [editing]);

    const options = { ...defaultRecordingSummaryOptions, prompt };
    const promptError = !prompt.trim() ? 'Enter a prompt.' : prompt.length > maxSummaryPromptLength ?
        `Use ${maxSummaryPromptLength.toLocaleString('en')} characters or fewer.` : rejectedPrompt === prompt ? summary.error : undefined;
    const collapsed = format === 'detailed' && hasSummary && !editing && !promptError;
    const preset = summary.presets.presets.find((item) => item.prompt === prompt);
    const canGenerate = modelReady && store.canSummarize && !store.operations.isBusy
        && isRecordingSummaryOptions(options) && !promptError;
    const canGenerateBrief = Boolean(!saved?.brief && saved?.generationVersion === recordingSummaryGenerationVersion
        && saved?.reviewedChunks?.length && sameRecordingSummaryOptions(saved.options, options));
    const offerInstall = Boolean(saved?.brief && model?.state === 'missing' && !summary.modelError && !showInstallation);
    const resume = continuation?.options.prompt === prompt ? continuation : undefined;
    const stopped = summary.stopped || Boolean(continuation);
    const generationError = failure !== currentFailure || rejectedPrompt !== undefined ? null : summary.error;

    const hint = !modelReady ? (model?.state === 'downloading' ? 'Wait for the model download to finish.' :
        model?.state === 'ready' || !model ? 'Model availability must be confirmed before generating.' :
            'Download the summary model to generate.') : store.operations.isBusy ? 'Wait for the current operation to finish.' :
        'Runs on this computer with the local summary model.';
    const generate = () => {
        if (offerInstall) {
            setShowInstallation(true);
        } else if (canGenerate) {
            void store.generateSummary(options);
        }
    };
    const generateLabel = saved?.brief ? (collapsed ? 'Regenerate' : 'Regenerate summary') :
        canGenerateBrief ? 'Generate brief summary' : 'Generate summary';
    const generateButton = <Button size={collapsed ? 'compact-sm' : 'sm'}
        variant={collapsed ? 'default' : 'filled'} className={styles.trailing}
        disabled={Boolean(promptError) || (!offerInstall && !canGenerate)} aria-describedby={!collapsed && !resume ? hintId : undefined}
        onClick={generate}>{generateLabel}</Button>;

    return <section className={styles.panel} aria-label="Recording summary" tabIndex={0}>
        <div className={styles.column}>
            {!hasCompleteTranscript && !hasSummary && <div>
                <h2>Recording summary</h2>
                <p className={styles.caption}>{transcription.isIncomplete ?
                    'Complete the transcription before generating a summary.' :
                    'Transcribe this recording to generate a summary.'}</p>
            </div>}
            {hasCompleteTranscript && <>
                {!modelReady && !offerInstall && <SummaryModelCard model={model} error={summary.modelError}
                    onCheck={() => { void summary.refreshModelStatus(); }}
                    generateAfterDownload={summary.automaticGenerationSession !== null && summary.automaticGenerationSession === store.workspace.activeSessionId}
                    onGenerateAfterDownloadChange={(enabled) => {
                        if (store.workspace.activeSessionId) summary.setGenerateAfterDownload(store.workspace.activeSessionId, prompt, enabled);
                    }}
                    onDownload={() => { void summary.downloadModel(); }}
                    onCancel={() => { void summary.cancelModelDownload(); }} />}
                <section aria-label="Summary prompt" className={`${styles.prompt} ${collapsed ? styles.promptCompact : ''}`}>
                    {format === 'detailed' && hasSummary && <div className={styles.row}>
                        {collapsed && <><strong>Prompt</strong>{preset && <Badge variant="light">{preset.name}</Badge>}
                            <span className={styles.promptExcerpt}>{prompt}</span></>}
                        <Button size="compact-sm" variant="subtle" className={styles.link} aria-expanded={!collapsed}
                            aria-controls={promptId} onClick={() => setEditing(collapsed)} disabled={Boolean(promptError)}>
                            {collapsed ? 'Edit prompt' : 'Hide prompt'}
                        </Button>
                        {collapsed && !summary.isRunning && !resume && !generationError && generateButton}
                    </div>}
                    <div id={promptId} hidden={collapsed}>
                        {!collapsed && <SummaryPresets prompt={prompt} canSave={!promptError} onChange={(value) => {
                            summary.setPrompt(value);
                            promptRef.current?.focus();
                        }} />}
                        {!collapsed && <Textarea ref={promptRef} label="Prompt" value={prompt}
                            onChange={(event) => summary.setPrompt(event.currentTarget.value)}
                            disabled={summary.isRunning} rows={3} resize="vertical"
                            classNames={{ input: styles.promptInput }}
                            error={promptError && <span role="alert" className={styles.fieldError}>
                                <IconAlertCircle size={14} aria-hidden="true" />{promptError}
                            </span>} />}
                    </div>
                    {promptError && <ShowInLog details={`Summary prompt validation: characters=${prompt.length}; characterLimit=${maxSummaryPromptLength}; ${promptError}`} />}
                    {!collapsed && !summary.isRunning && !resume && !generationError && <div className={styles.row}>
                        <span className={`${styles.caption} ${styles.grow}`} id={hintId}>{hint}</span>
                        {generateButton}
                    </div>}
                </section>
                {summary.isRunning ? <div className={styles.runStatus}>
                    <div className={styles.row} role="status">
                        <Loader size="xs" color="var(--brand-color-primary)" />
                        <span>{summary.isStopping ? 'Stopping summary…' : summary.progress}</span>
                    </div>
                    {generationError && <span role="alert">{generationError}</span>}
                    <Button size="compact-sm" variant="default" disabled={summary.isStopping}
                        onClick={() => { void summary.stop(); }}>Stop generation</Button>
                </div> : generationError && <InlineAlert title="Summary generation failed" actions={generateButton}>
                    <span>{generationError}</span>
                    {!collapsed && <span className={styles.caption} id={hintId}>{hint}</span>}
                </InlineAlert>}
                {!summary.isRunning && stopped && <InlineAlert severity="warning" title="Summary generation stopped" actions={resume && <Button size="compact-sm" variant="default" disabled={!canGenerate} onClick={resume.onContinue}>Continue</Button>}>
                    <div role="status">
                        {resume ? 'Processed chunks are kept, so it continues from where it stopped.' : 'Generate a new summary to start again.'}
                    </div>
                </InlineAlert>}
            </>}
            {hasSummary && transcript && saved && <SummaryResult
                key={`${saved.inputHash}:${saved.generatedAt ?? ''}`}
                transcript={transcript} saved={saved} format={format} onFormatChange={(nextFormat) => {
                    setEditing(false);
                    onFormatChange(nextFormat);
                }} />}
        </div>
    </section>;
});
