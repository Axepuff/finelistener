import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    transcribe: (lang: string) => ipcRenderer.invoke('transcribe', lang),
    saveText: (content: string) => ipcRenderer.invoke('saveText', content),
});
