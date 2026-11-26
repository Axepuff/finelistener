import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { observer } from 'mobx-react-lite';
import React, { useState } from 'react';
import { useAppStore } from 'renderer/src/AppContext';

interface Props {
    prompt: string;
    onChange: (prompt: string) => void;
    canSave: boolean;
}

type PresetAction = ({ kind: 'save'; prompt: string } | { kind: 'rename' | 'delete'; name: string }) & { error?: string };

export const SummaryPresets: React.FC<Props> = observer(({ prompt, onChange, canSave }) => {
    const { summary } = useAppStore();
    const presets = summary.presets;
    const selected = presets.presets.find((preset) => preset.prompt === prompt);
    const [action, setAction] = useState<PresetAction | null>(null);
    const [name, setName] = useState('');
    const disabled = summary.isRunning || presets.saving;
    const title = action?.kind === 'rename' ? 'Rename preset' : action?.kind === 'delete' ? 'Delete preset?' : 'Save as preset';
    const submit = async () => {
        if (!action) return;
        const saved = action.kind === 'save' ? await presets.savePreset(name, action.prompt) :
            action.kind === 'rename' ? await presets.renamePreset(action.name, name) : await presets.deletePreset(action.name);
        const nextAction = saved.ok ? null : { ...action, error: saved.message };
        setAction((current) => current === action ? nextAction : current);
    };

    return <>
        <Group gap={6} mb={8} role="group" aria-label="Prompt presets">
            {presets.presets.map((preset) => <Button key={preset.name} size="compact-xs"
                variant={selected?.name === preset.name ? 'light' : 'default'} aria-pressed={selected?.name === preset.name}
                disabled={disabled} onClick={() => onChange(preset.prompt)}>{preset.name}</Button>)}
            <Button size="compact-xs" variant="default" disabled={disabled} onClick={() => onChange('')}>New preset</Button>
            <Button size="compact-xs" variant="subtle" disabled={disabled || !presets.ready || !canSave || Boolean(selected)}
                onClick={() => { setName(''); setAction({ kind: 'save', prompt }); }}>Save as preset</Button>
            {selected && presets.isUserPreset(selected.name) && <>
                <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => {
                    setName(selected.name); setAction({ kind: 'rename', name: selected.name });
                }}>Rename preset</Button>
                <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => setAction({ kind: 'delete', name: selected.name })}>Delete preset</Button>
            </>}
        </Group>
        {presets.loadError && <Group gap={6}><Text size="xs" c="red" role="alert">{presets.loadError}</Text>
            <Button size="compact-xs" variant="default" onClick={() => void presets.load()}>Retry</Button>
        </Group>}
        <Modal opened={action !== null} centered={true} onClose={() => { if (!presets.saving) setAction(null); }} title={title}>
            <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
                <Stack gap="sm">
                    {action?.kind === 'delete' ? <Text size="sm">Remove “{action.name}” from your presets? Saved summaries keep their original prompt.</Text> :
                        <TextInput label="Preset name" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={presets.saving} data-autofocus={true} />}
                    {action?.error && <Text size="sm" c="red" role="alert">{action.error}</Text>}
                    <Group justify="flex-end">
                        <Button variant="default" disabled={presets.saving} onClick={() => setAction(null)}>Cancel</Button>
                        <Button type="submit" color={action?.kind === 'delete' ? 'red' : undefined}
                            disabled={disabled || (action?.kind !== 'delete' && !name.trim())} loading={presets.saving}>
                            {action?.kind === 'delete' ? 'Delete' : 'Save'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
    </>;
});
