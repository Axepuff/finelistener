import React, { useEffect } from 'react';
import { AppContext } from './AppContext';
import { Home } from './Home';

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
