import {
    Checkbox,
    FormControl,
    FormControlLabel,
    Grow,
    InputLabel,
    MenuItem,
    Select,
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
    model: 'large' | 'small';
    onChangeModel: (value: 'large' | 'small') => void;
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
    model,
    onChangeModel,
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
                    <FormControl size="small">
                        <InputLabel id="transcribe-model-label">{'Модель'}</InputLabel>
                        <Select
                            labelId="transcribe-model-label"
                            label="Модель"
                            value={model}
                            onChange={(e) => onChangeModel(e.target.value)}
                        >
                            <MenuItem value="large">{'Большая (лучшее качество, медленнее)'}</MenuItem>
                            <MenuItem value="small">{'Малая (быстрее, меньше качество)'}</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField
                        size="small"
                        label="Максимальный контекст (--max-context)"
                        type="number"
                        value={maxContext}
                        onChange={(e) => onChangeMaxContext(Number(e.target.value))}
                        helperText="Количество предыдущих токенов (рекомендуется 64–224)"
                    />
                    <TextField
                        size="small"
                        label="Максимальная длина сегмента (--max-len)"
                        type="number"
                        value={maxLen}
                        onChange={(e) => onChangeMaxLen(Number(e.target.value))}
                        helperText="Ограничение на длину сегмента (0 — без ограничения)"
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox
                                checked={splitOnWord}
                                onChange={(e) => onChangeSplitOnWord(e.target.checked)}
                            />
                        )}
                        label="Делить по словам (--split-on-word)"
                    />
                    <FormControlLabel
                        control={(
                            <Checkbox checked={useVad} onChange={(e) => onChangeUseVad(e.target.checked)} />
                        )}
                        label="Использовать VAD (--vad)"
                    />
                </Stack>
            </Grow>
        </>
    );
};

