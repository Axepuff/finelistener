import { createContext, useContext } from 'react';

type AppState = {
    isElectron: boolean;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
    const context = useContext(AppContext);

    if (!context) {
        throw new Error('AppContext: useApp should only be used inside an AppContext');
    }

    return context;
}
