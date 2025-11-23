import CircularProgress from '@mui/material/CircularProgress';
import { useAtomValue } from 'jotai';
import { FC } from 'react';
import { atoms } from 'renderer/src/atoms';

const { appState } = atoms;

export const TranscribeState: FC = () => {
    const state = useAtomValue(appState.uiState);

    if (state === 'transcribing') {
        return <CircularProgress color="success" />;
    }

    return null;
};
