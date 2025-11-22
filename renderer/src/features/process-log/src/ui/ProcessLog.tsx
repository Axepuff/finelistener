import { Button, FormControlLabel, Grow, Paper, Stack, Switch, Typography } from '@mui/material';
import { useAtom } from 'jotai';
import { FC, useEffect, useState } from 'react';
import { useApp } from 'renderer/src/AppContext';
import { atoms } from 'renderer/src/atoms';

const { transcription } = atoms;

export const ProcessLog: FC = () => {
    const { isElectron } = useApp();
    const [log, setLog] = useAtom(transcription.log);
    const [showLog, setShowLog] = useState(false);

    useEffect(() => {
        if (!isElectron) return;
        const off = window.api!.onTranscribeLog((line) => setLog((prev) => prev + line));

        return () => {
            off?.();
        };
    }, [isElectron, setLog]);

    return (
        <Stack>
            <FormControlLabel
                control={(
                    <Switch checked={showLog} onChange={() => setShowLog((prev) => !prev)} />
                )}
                label="Показать лог"
            />
            <Grow in={showLog} mountOnEnter={true} unmountOnExit={true}>
                <Paper
                    variant="outlined"
                    sx={{
                        p: 3,
                        height: '300px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <Stack direction="row" spacing={2}>
                        <Button variant="contained" onClick={() => setLog('')}>
                            {'Очистить лог'}
                        </Button>
                    </Stack>
                    <Typography
                        variant="body2"
                        sx={{
                            whiteSpace: 'pre-wrap',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            flex: 1,
                            p: 1,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        {log || 'No Whisper output captured yet.'}
                    </Typography>
                </Paper>
            </Grow>
        </Stack>
    );
};
