import { createContext, useContext } from 'react';
import type { AppStore } from './stores';

export const AppContext = createContext<AppStore | null>(null);

export const useAppStore = (): AppStore => {
    const store = useContext(AppContext);

    if (!store) {
        throw new Error('useAppStore must be used inside AppContext');
    }

    return store;
};
