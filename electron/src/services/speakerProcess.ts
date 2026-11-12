import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import type { SpeakerErrorCode } from '../types/transcription';

export class SpeakerAnalysisError extends Error {
    constructor(public readonly code: SpeakerErrorCode, options?: ErrorOptions) {
        super(code, options);
    }
}

export const runSpeakerProcess = (binary: string, args: string[], signal: AbortSignal, cwd: string, env?: NodeJS.ProcessEnv, onProgress?: (percent: number) => void, stdoutLimit = 2_000_000, lowPriority = false): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const child = spawn(binary, args, { cwd, env, signal, windowsHide: true });
        const timeout = setTimeout(() => { processError = new Error('Speaker worker timed out'); child.kill(); }, 2 * 60 * 60 * 1000);
        let stdout = '';
        let stderr = '';
        let processError: Error | null = null;
        let progressBuffer = '';
        let lastPercent = -1;
        if (lowPriority) child.once('spawn', () => {
            try { os.setPriority(child.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL); }
            catch (error) { console.warn('Could not lower speaker process priority', error); }
        });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            if (stdout.length > stdoutLimit) {
                processError = new Error('Speaker worker output exceeded the limit');
                child.kill();
            }
        });
        child.stderr.on('data', (chunk: string) => {
            stderr = (stderr + chunk).slice(-100_000);
            progressBuffer += chunk;
            const lines = progressBuffer.split(/[\r\n]/);
            progressBuffer = (lines.pop() ?? '').slice(-1000);
            for (const line of lines) {
                const match = /^progress (\d+(?:\.\d+)?)%$/.exec(line.trim());
                if (!match) continue;
                const percent = Math.min(100, Math.floor(Number(match[1])));
                if (percent > lastPercent) {
                    lastPercent = percent;
                    onProgress?.(percent);
                }
            }
        });
        child.on('error', (error) => { processError = error; });
        child.on('close', (code) => {
            clearTimeout(timeout);
            if (signal.aborted) reject(new Error('Speaker analysis cancelled'));
            else if (processError) reject(processError);
            else if (code !== 0) reject(Object.assign(new Error(`${path.basename(binary)} exited with ${code}: ${stderr}`), { exitCode: code }));
            else resolve({ stdout, stderr });
        });
    });
