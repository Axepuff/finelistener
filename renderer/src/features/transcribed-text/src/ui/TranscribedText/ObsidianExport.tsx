import { Box, Button, Checkbox, Group, Modal, Notification, Stack, Text } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconExternalLink } from '@tabler/icons-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useAppStore } from 'renderer/src/AppContext';
import styles from './TranscribedText.module.css';

export const ObsidianExport: React.FC = observer(() => {
    const store = useAppStore();
    const { obsidian } = store;
    const { options, stage, busy } = obsidian;
    const hasFormat = options.plain || options.timestamped;
    const existing = stage === 'existing';

    return <>
        <Button.Group aria-label="Obsidian export">
            <Button size="sm" variant="default" className={styles.exportButton}
                disabled={!store.canExportObsidian || busy} onClick={() => void obsidian.start()}>
                Export to Obsidian
            </Button>
            <Button size="sm" px={7} variant="default" title="Obsidian export options"
                aria-label="Obsidian export options" disabled={busy} onClick={() => void obsidian.editOptions()}>
                <IconAdjustmentsHorizontal size={16} />
            </Button>
        </Button.Group>
        <Modal opened={stage === 'options'} centered={true} title="Obsidian export options" onClose={() => obsidian.dismiss()}
            closeButtonProps={{ disabled: busy, 'aria-label': 'Close export options' }} closeOnEscape={!busy} closeOnClickOutside={!busy}>
            <form onSubmit={(event) => { event.preventDefault(); void obsidian.confirmOptions(); }}>
                <Stack gap="md">
                    <Stack gap={4}>
                        <Text size="sm" fw={600}>Destination folder</Text>
                        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                            {options.folder?.label ?? 'Choose your Obsidian vault or a folder inside it.'}
                        </Text>
                        <Button variant="default" size="compact-sm" w="fit-content" disabled={busy} onClick={() => void obsidian.chooseFolder()}>
                            {options.folder ? 'Change folder' : 'Choose folder'}
                        </Button>
                    </Stack>
                    <Stack gap="xs" role="group" aria-labelledby="obsidian-transcript-formats">
                        <Text id="obsidian-transcript-formats" size="sm" fw={600}>Include in transcript</Text>
                        <Checkbox label="Plain text" checked={options.plain} disabled={busy}
                            onChange={(event) => obsidian.setFormats(event.currentTarget.checked, options.timestamped)} />
                        <Checkbox label="Timestamped transcript" checked={options.timestamped} disabled={busy}
                            onChange={(event) => obsidian.setFormats(options.plain, event.currentTarget.checked)} />
                        {!hasFormat && <Text size="sm" c="red" role="alert">Select at least one transcript format.</Text>}
                    </Stack>
                    {obsidian.message && <Text size="sm" c="red" role="alert">{obsidian.message}</Text>}
                    <Group justify="flex-end">
                        <Button variant="default" disabled={busy} onClick={() => obsidian.dismiss()}>Cancel</Button>
                        <Button type="submit" disabled={!options.folder || !hasFormat || busy} loading={busy}>
                            {obsidian.choosingForExport ? 'Export note' : 'Save options'}
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Modal>
        <Modal opened={existing || stage === 'missing'} centered={true} onClose={() => obsidian.dismiss()}
            title={existing ? 'Already exported' : 'Previous note not found'}
            closeButtonProps={{ disabled: busy, 'aria-label': 'Close export dialog' }} closeOnEscape={!busy} closeOnClickOutside={!busy}>
            <Stack gap="md">
                <Text size="sm">
                    {existing ? 'This session already has an exported note. You can open it or save a new copy.' :
                        'The previous note may have been moved or renamed. You can save a new copy.'}
                </Text>
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" disabled={busy} onClick={() => obsidian.dismiss()}>Cancel</Button>
                    {existing && <Button variant="default" disabled={busy} onClick={() => void obsidian.openNote()}>Open in Obsidian</Button>}
                    <Button disabled={busy} onClick={() => void obsidian.saveNewCopy()}>Save new copy</Button>
                </Group>
            </Stack>
        </Modal>
        {(stage === 'saved' || stage === 'error') && <Box className={styles.copyNotificationWrapper}>
            <Notification role={stage === 'saved' ? 'status' : 'alert'} color={stage === 'saved' ? 'green' : 'red'}
                withBorder={true} onClose={() => obsidian.dismiss()} closeButtonProps={{ disabled: busy, 'aria-label': 'Dismiss export notification' }}>
                <Stack gap={4}>
                    <Text size="sm">{stage === 'saved' ? 'Note exported' : obsidian.message}</Text>
                    {stage === 'saved' && <Button variant="subtle" size="compact-sm" w="fit-content"
                        rightSection={<IconExternalLink size={14} />} disabled={busy} onClick={() => void obsidian.openNote()}>
                        Open in Obsidian
                    </Button>}
                </Stack>
            </Notification>
        </Box>}
    </>;
});
