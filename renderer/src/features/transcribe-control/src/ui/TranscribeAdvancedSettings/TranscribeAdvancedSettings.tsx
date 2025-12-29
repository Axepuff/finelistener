import {
    Checkbox,
    FormControlLabel,
    Grow,
    Stack,
    Switch,
    TextField,
} from '@mui/material';
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
            <FormControlLabel
                control={<Switch checked={isOpen} onChange={() => setIsOpen((prev) => !prev)} />}
                label="Расширенные настройки"
            />
            <Grow in={isOpen}>
                <Stack spacing={1.5}>
                    <TextField
                        type="number"
                        size="small"
                        label="Максимальный контекст"
                        helperText="--max-context"
                        value={maxContext}
                        onChange={(e) => onChangeMaxContext(e.target.value ? Number(e.target.value) : null)}
                    />
                    <TextField
                        type="number"
                        size="small"
                        label="Максимальная длина сегмента"
                        helperText="--max-len"
                        value={maxLen}
                        onChange={(e) => onChangeMaxLen(e.target.value ? Number(e.target.value) : null)}
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox
                                checked={splitOnWord}
                                onChange={(e) => onChangeSplitOnWord(e.target.checked)}
                            />
                        )}
                        label="Делить по словам"
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox checked={useVad} onChange={(e) => onChangeUseVad(e.target.checked)} />
                        )}
                        label="Использовать определение тишины"
                    />
                </Stack>
            </Grow>
        </>
    );
};
