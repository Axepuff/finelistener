import {
    Checkbox,
    FormControlLabel,
    Grow,
    Stack,
    Switch,
    TextField,
} from '@mui/material';
import React, { useState } from 'react';

interface Props {
    maxContext: number;
    onChangeMaxContext: (value: number) => void;
    maxLen: number;
    onChangeMaxLen: (value: number) => void;
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
                        size="small"
                        label="Максимальный контекст (--max-context)"
                        type="number"
                        value={maxContext}
                        onChange={(e) => onChangeMaxContext(Number(e.target.value))}
                    />
                    <TextField
                        size="small"
                        label="Максимальная длина сегмента (--max-len)"
                        type="number"
                        value={maxLen}
                        onChange={(e) => onChangeMaxLen(Number(e.target.value))}
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
