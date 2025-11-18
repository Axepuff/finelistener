import { Button, FormControlLabel, Grow, Paper, Stack, Switch, Typography } from '@mui/material';
import { FC, useEffect, useState } from 'react';
import { useApp } from 'renderer/src/AppContext';

export const ProcessLog: FC = () => {
    const { isElectron } = useApp();
    const [collapseLog, setCollapseLog] = useState(false);
    const [log, setLog] = useState('');

    useEffect(() => {
        if (!isElectron) return;
        const off2 = window.api!.onTranscribeLog((line) => setLog(l => l + line));

        return () => {
            off2?.();
        };
    }, [isElectron]);

    return (
        <Stack>
            <FormControlLabel
                control={(
                    <Switch checked={collapseLog} onChange={() => {
                        setCollapseLog((prev) => !prev);
                    }}
                    />
                )}
                label="Логи"
            />
            <Grow in={collapseLog} mountOnEnter={true} unmountOnExit={true}>
                <Paper variant="outlined" sx={{ p: 3, height: '300px', overflowY: 'auto' }}>
                    <Button variant="contained" onClick={() => setLog('')}>
                        {'Очистить лог'}
                    </Button>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }} maxHeight={300}>
                        {log}
                    </Typography>
                </Paper>
            </Grow>
        </Stack>
    );
};
