import { AppStore, createPreloadAdapter } from './stores';

export const appStore = new AppStore(createPreloadAdapter(window.api));
