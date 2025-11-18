import {
    Container,
    Typography,
    Box,
    Stack,
    Button,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Paper,
    CircularProgress,
    TextField,
    FormControlLabel,
    Checkbox,
} from '@mui/material';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from './AppContext';
import { Home } from './Home';

declare global {
    interface Window {
        api?: {
            pickAudio: () => Promise<string | null>;
            transcribeStream: (audioPath: string, opts: any) => Promise<string>;
            saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
            onTranscribeProgress: (cb: (chunk: string) => void) => () => void;
            onTranscribeProgressValue: (cb: (value: number) => void) => () => void;
            onTranscribeLog: (cb: (line: string) => void) => () => void;
            stopTranscription: () => Promise<boolean>;
        };
    }
}

const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'ru', label: 'Русский' },
    { code: 'es', label: 'Español' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
];

export const App: React.FC = () => {
    const isElectron = useMemo(() => !!window.api, []);
    // const [lang, setLang] = useState('ru');
    // const [text, setText] = useState('');
    // const [log, setLog] = useState('');
    // const [isStopping, setIsStopping] = useState<boolean>(false);
    // const [loading, setLoading] = useState(false);
    // const [audioPath, setAudioPath] = useState<string>('');

    // // опции чанкования / контекста
    // const [maxContext, setMaxContext] = useState<number>(128);
    // const [maxLen, setMaxLen] = useState<number>(0); // 0 = по умолчанию
    // const [splitOnWord, setSplitOnWord] = useState<boolean>(true);
    // const [useVad, setUseVad] = useState<boolean>(false);
    // const [vadModelPath, setVadModelPath] = useState<string>(''); // ggml-silero-*.bin

    // useEffect(() => {
    //     if (!isElectron) return;
    //     const off1 = window.api!.onTranscribeProgress((chunk) => setText((t) => t + chunk));
    //     const off2 = window.api!.onTranscribeLog((line) => setLog((l) => l + line));

    //     return () => {
    //         off1?.();
    //         off2?.();
    //     };
    // }, [isElectron]);

    // const handlePick = async () => {
    //     if (!isElectron) return;
    //     const file = await window.api!.pickAudio();

    //     if (file) setAudioPath(file);
    // };

    // const handleStart = async () => {
    //     if (!isElectron || !audioPath) return;
    //     setText('');
    //     setLog('');
    //     setLoading(true);
    //     try {
    //         await window.api!.transcribeStream(audioPath, {
    //             language: lang,
    //             maxContext,
    //             maxLen,
    //             splitOnWord,
    //             useVad,
    //             vadModelPath,
    //         });
    //     } finally {
    //         setLoading(false);
    //     }
    // };

    // const handleSave = async () => {
    //     if (!text) return;
    //     await window.api!.saveText(text);
    // };

    // const handleStop = async () => {
    //     setIsStopping(true);
    //     try {
    //         const stopped = await window.api!.stopTranscription();

    //         if (stopped) {
    //             setLog(log + 'Команда остановки отправлена.');
    //         } else {
    //             setLog(log + 'Процесс не был запущен — останавливать нечего.');
    //         }
    //     } catch (err: unknown) {
    //         setLog(log + `Ошибка остановки: ${(err as Error)?.message ?? String(err)}`);
    //     } finally {
    //         setIsStopping(false);
    //     }
    // };

    return (
        <AppContext value={{ isElectron: !!window.api }}>
            <Home />
        </AppContext>
    );
};
