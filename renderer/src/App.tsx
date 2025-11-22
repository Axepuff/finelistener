import React from 'react';
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
            openDevTools: () => Promise<boolean>;
        };
    }
}

export const App: React.FC = () => {

    return (
        <AppContext value={{ isElectron: !!window.api }}>
            <Home />
        </AppContext>
    );
};
