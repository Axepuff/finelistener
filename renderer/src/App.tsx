import React, { useEffect } from 'react';
import { useAppStore } from './AppContext';
import { Home } from './Home';

export const App: React.FC = () => {
    const store = useAppStore();

    useEffect(() => {
        store.initialize();

        return () => {
            store.dispose();
        };
    }, [store]);

    useEffect(() => {
        if (!store.isElectron) {
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
                void store.openDevTools();
                buffer = '';
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [store]);

    return <Home />;
};
