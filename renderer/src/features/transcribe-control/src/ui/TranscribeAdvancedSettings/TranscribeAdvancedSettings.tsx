import {
    Checkbox,
    Collapse,
    NumberInput,
    Stack,
    Switch,
} from '@mantine/core';
import React, { useState } from 'react';

// TODO rework props to atoms
interface Props {
    maxContext: number | null;
    onChangeMaxContext: (value: number | null) => void;
    maxLen: number | null;
    onChangeMaxLen: (value: number | null) => void;
    splitOnWord: boolean;
    onChangeSplitOnWord: (value: boolean) => void;
    useVad: boolean;
    onChangeUseVad: (value: boolean) => void;
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
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Switch
                checked={isOpen}
                onChange={() => setIsOpen((prev) => !prev)}
                label="Advanced settings"
            />
            <Collapse in={isOpen}>
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
                </Stack>
            </Collapse>
        </>
    );
};
