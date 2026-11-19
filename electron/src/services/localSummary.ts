import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { runNativeProcess } from './nativeProcess';
import { generateRecordingNotes, summaryContext } from './recordingNotes';
import type { ReviewedSummaryChunk, SummarySourceRow } from '../types/sessions';

export const SUMMARY_MODEL = 'Qwen3-4B-Instruct-2507 Q4_K_M';

const runtimeBinary = (): string => {
    const windows = process.platform === 'win32';
    const variants = windows && process.env.BUILD_VARIANT !== 'win-x64-cpu' ? ['win-x64-gpu', 'win-x64-cpu'] :
        [windows ? 'win-x64-cpu' : 'mac-arm64'];
    const directories = app.isPackaged ? [path.join(process.resourcesPath, 'summary')] :
        variants.map((variant) => path.join(app.getAppPath(), 'build-assets', variant, 'summary'));
    const directory = directories.find((dir) => ['llama-tokenize', 'llama-completion'].every((name) =>
        existsSync(path.join(dir, windows ? name + '.exe' : name))));
    if (!directory) throw new Error('SUMMARY_RUNTIME_UNAVAILABLE');
    return path.join(directory, windows ? 'llama-completion.exe' : 'llama-completion');
};

export const generateLocalSummary = async (
    rows: SummarySourceRow[], modelPath: string, signal: AbortSignal, progress: (message: string) => void,
    onReviewed: (chunks: ReviewedSummaryChunk[]) => Promise<void>, cachedChunks?: ReviewedSummaryChunk[], languageHint?: string,
): Promise<{ brief: string; detailed: string }> => {
    const binary = runtimeBinary();
    const tokenizer = path.join(path.dirname(binary), process.platform === 'win32' ? 'llama-tokenize.exe' : 'llama-tokenize');
    const directory = path.dirname(modelPath);
    const modelFile = path.basename(modelPath);
    const promptFile = `prompt-${randomUUID()}.txt`;
    const promptPath = path.join(directory, promptFile);
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const env: NodeJS.ProcessEnv = process.platform === 'win32' ? {
        SystemRoot: systemRoot, WINDIR: systemRoot, USERPROFILE: os.homedir(), LOCALAPPDATA: process.env.LOCALAPPDATA,
        PATH: [path.dirname(binary), path.join(systemRoot, 'System32')].join(path.delimiter), TEMP: os.tmpdir(),
    } : { HOME: os.homedir(), TMPDIR: os.tmpdir(), PATH: '/usr/bin:/bin' };
    const writeInput = async (text: string): Promise<void> => {
        signal.throwIfAborted();
        await fs.writeFile(promptPath, text, { mode: 0o600, signal });
    };
    const countTokens = async (text: string): Promise<number> => {
        await writeInput(text);
        const { stdout, stderr } = await runNativeProcess(tokenizer, [
            '--model', modelFile, '--file', promptFile, '--ids', '--show-count', '--no-bos', '--no-escape', '--offline',
        ], signal, directory, env);
        const count = /Total number of tokens:\s*(\d+)/u.exec(stdout + '\n' + stderr);
        if (!count) throw new Error('The local tokenizer did not return a count');
        return Number(count[1]);
    };
    const complete = async (prompt: string, maxTokens: number): Promise<string | null> => {
        await writeInput(prompt);
        // Relative filenames also work on Windows installations with a non-ASCII user profile.
        const { stdout } = await runNativeProcess(binary, [
            '--model', modelFile, '--file', promptFile, '--offline', '--no-conversation', '--no-display-prompt',
            '--simple-io', '--no-escape', '--no-warmup', '--ctx-size', String(summaryContext), '--predict', String(maxTokens),
            '--threads', String(Math.min(4, os.availableParallelism())), '--temp', '0', '--seed', '42',
        ], signal, directory, env, 128_000, true);
        const end = /\s*\[end of text\]\s*$/u.exec(stdout);
        return end ? stdout.slice(0, end.index).trim() || null : null;
    };
    try {
        return await generateRecordingNotes(rows, { countTokens, complete }, progress, onReviewed, cachedChunks, languageHint);
    } finally {
        await fs.rm(promptPath, { force: true });
    }
};
