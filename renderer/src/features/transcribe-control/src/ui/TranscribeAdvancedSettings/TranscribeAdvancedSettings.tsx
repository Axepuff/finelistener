import {
    Checkbox,
    Collapse,
    NumberInput,
    Stack,
} from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import React, { useId, useState } from 'react';

interface Props {
    maxContext: number | null;
    onChangeMaxContext: (value: number | null) => void;
    maxLen: number | null;
    onChangeMaxLen: (value: number | null) => void;
    splitOnWord: boolean;
    onChangeSplitOnWord: (value: boolean) => void;
    useVad: boolean;
    onChangeUseVad: (value: boolean) => void;
    microphoneGateEnabled: boolean;
    onChangeMicrophoneGateEnabled: (value: boolean) => void;
}

const parseNumberInputValue = (value: string | number): number | null => {
    if (typeof value !== 'number') return null;
    if (!Number.isFinite(value)) return null;

    return value;
};

export const TranscribeAdvancedSettings: React.FC<Props> = ({
    maxContext,
    onChangeMaxContext,
    maxLen,
    onChangeMaxLen,
    splitOnWord,
    onChangeSplitOnWord,
    useVad,
    onChangeUseVad,
    microphoneGateEnabled,
    onChangeMicrophoneGateEnabled,
}) => {
    const id = useId();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button type="button" className="settings-advanced" aria-expanded={isOpen} aria-controls={id} onClick={() => setIsOpen((prev) => !prev)}>
                Advanced settings <IconChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} aria-hidden="true" />
            </button>
            <Collapse in={isOpen} id={id}>
                <Stack gap={8}>
                    <NumberInput
                        label="Max context"
                        description="--max-context"
                        value={maxContext ?? ''}
                        onChange={(value) => onChangeMaxContext(parseNumberInputValue(value))}
                    />
                    <NumberInput
                        label="Max segment length"
                        description="--max-len"
                        value={maxLen ?? ''}
                        onChange={(value) => onChangeMaxLen(parseNumberInputValue(value))}
                    />
                    <Checkbox
                        checked={splitOnWord}
                        onChange={(event) => onChangeSplitOnWord(event.currentTarget.checked)}
                        label="Split on words"
                    />
                    <Checkbox
                        checked={useVad}
                        onChange={(event) => onChangeUseVad(event.currentTarget.checked)}
                        label="Use voice activity detection"
                    />
                    <Checkbox
                        checked={microphoneGateEnabled}
                        onChange={(event) => onChangeMicrophoneGateEnabled(event.currentTarget.checked)}
                        label="Reduce speaker bleed in microphone transcription"
                        description="Applied on the next transcription when both recording tracks are available."
                    />
                </Stack>
            </Collapse>
        </>
    );
};
