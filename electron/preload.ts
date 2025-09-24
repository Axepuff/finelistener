import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    pickAudio: (lang: string) => ipcRenderer.invoke('pickAudio', lang),
    saveText: (content: string) => ipcRenderer.invoke('saveText', content),
    transcribeStream: (audioPath: string, opts: any) => ipcRenderer.invoke('transcribeStream', audioPath, opts),
    stopTranscription: () => ipcRenderer.invoke('stop-transcription'),
    onTranscribeProgress: (cb: (chunk: string) => void) => {
        const handler = (_e: unknown, chunk: string) => cb(chunk);

        ipcRenderer.on('transcribe:progress', handler);

        return () => ipcRenderer.removeListener('transcribe:progress', handler);
    },
    onTranscribeLog: (cb: (line: string) => void) => {
        const handler = (_e: unknown, line: string) => cb(line);

        ipcRenderer.on('transcribe:log', handler);

        return () => ipcRenderer.removeListener('transcribe:log', handler);
    },
});
