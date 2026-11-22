import { Button, Group, Progress, Stack, Text } from '@mantine/core';
import { InlineAlert } from 'renderer/src/shared/InlineAlert';
import { IconCheck } from '@tabler/icons-react';
import type { WhisperModelName } from 'electron/src/types/whisper';
import { observer } from 'mobx-react-lite';
import React, { useId } from 'react';
import { useAppStore } from '../../../../../AppContext';

interface Props {
    value: WhisperModelName | null;
    onChange: (value: WhisperModelName) => void;
    disabled?: boolean;
}
const descriptions = { base: 'Fastest', small: 'Balanced', large: 'Best quality · v3 turbo' };
const names: WhisperModelName[] = ['base', 'small', 'large'];
const mb = (bytes: number) => Math.round(bytes / 1_000_000);

export const WhisperModelSelect: React.FC<Props> = observer(({ value, onChange, disabled = false }) => {
    const store = useAppStore();
    const { whisperModels } = store;
    const id = useId();
    return (
        <fieldset className="settings-models">
            <legend>Model</legend>
            {names.map((name) => {
                const model = whisperModels.getModel(name);
                const progress = whisperModels.downloadProgress?.name === name ? whisperModels.downloadProgress : null;
                const blocked = whisperModels.isDownloadActive && !progress && !model?.isDownloaded;
                const error = whisperModels.getDownloadError(name);
                const title = name.charAt(0).toUpperCase() + name.slice(1);
                return (
                    <div key={name} className="settings-model" data-selected={!disabled && value === name}>
                        <label className="settings-model__choice">
                            <input type="radio" name={id} value={name} checked={!disabled && value === name}
                                disabled={disabled || blocked || !model} onChange={() => onChange(name)}
                                aria-label={title} aria-describedby={`${id}-${name}`} />
                            <span className="settings-model__title"><strong>{title}</strong>
                                <span>{descriptions[name]}{name === 'base' && model?.isBundled ? ' · included' : ''}</span>
                            </span>
                        </label>
                        <Stack gap={6} className="settings-model__state" id={`${id}-${name}`}>
                            {error ? <InlineAlert title="Model download failed" actions={<Button variant="default" size="compact-xs" disabled={disabled || whisperModels.isDownloadActive}
                                aria-label={`Retry download ${title}`} onClick={() => { void store.downloadWhisperModel(name); }}>Retry download</Button>}>{error}</InlineAlert> : null}
                            {progress ? (
                                <>
                                    <Group gap={4} justify="space-between" role="status">
                                        <Text size="xs">Downloading…{progress.percent !== null ? ` ${progress.percent}%` : ''}</Text>
                                        <Text size="xs" ff="var(--brand-font-family-code)">{mb(progress.downloadedBytes)}{progress.totalBytes ? ` / ${mb(progress.totalBytes)}` : ''} MB</Text>
                                    </Group>
                                    <Progress value={progress.percent ?? 0} animated={progress.percent === null} size={4}
                                        aria-label={`${title} download progress`} aria-valuetext={progress.percent === null ? 'Size unknown' : `${progress.percent}%`} />
                                    <Button variant="subtle" size="compact-xs" className="settings-link" disabled={whisperModels.isCancelling}
                                        onClick={() => { void whisperModels.cancelDownload(); }}>Cancel download</Button>
                                </>
                            ) : model?.isDownloaded ? (
                                <Group gap={4}><IconCheck size={12} color="var(--brand-color-success)" aria-hidden="true" /><Text size="xs">Ready · {model.sizeLabel}</Text></Group>
                            ) : (
                                <Group gap={6} justify="space-between">
                                    <Text size="xs">{model?.sizeLabel ?? 'Checking availability…'}{blocked ? ' · available after the current download' : ''}</Text>
                                    {!error && !blocked && model ? <Button variant="default" size="compact-xs" disabled={disabled}
                                        aria-label={`${error ? 'Retry download' : 'Download'} ${title}`}
                                        onClick={() => { void store.downloadWhisperModel(name); }}>{error ? 'Retry download' : 'Download'}</Button> : null}
                                </Group>
                            )}
                        </Stack>
                    </div>
                );
            })}
            <Text size="xs" c="dimmed">Models are downloaded once and then work offline. One download at a time.</Text>
        </fieldset>
    );
});
