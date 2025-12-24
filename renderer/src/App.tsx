import React, { useEffect } from 'react';
import { AppContext } from './AppContext';
import { Home } from './Home';

declare global {
    interface Window {
        api?: {
            pickAudio: () => Promise<string | null>;
            transcribeStream: (audioPath: string, opts: any) => Promise<string>;
            saveText: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
            onTranscribeText: (cb: (chunk: string) => void) => () => void;
            onTranscribeProgressValue: (cb: (value: number) => void) => () => void;
            onTranscribeLog: (cb: (line: string) => void) => () => void;
            stopTranscription: () => Promise<boolean>;
            openDevTools: () => Promise<boolean>;
        };
    }
}

export const App: React.FC = () => {
    useEffect(() => {
        if (!window.api?.openDevTools) {
            return;
        }

        const targetSequence = 'iddqd';
        let buffer = '';

        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            if (key.length !== 1) {
                buffer = '';

                return;
            }

            buffer = (buffer + key).slice(-targetSequence.length);

            if (buffer === targetSequence) {
                window.api
                    ?.openDevTools?.()
                    .catch((error: unknown) => console.error('Failed to open devtools', error));
                buffer = '';
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    return (
        <AppContext value={{ isElectron: !!window.api }}>
            <Home />
        </AppContext>
    );
};
