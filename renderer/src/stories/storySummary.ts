import type { ReviewedSummaryChunk, SessionSummary, SessionTranscriptV1, SummaryGenerationResult, SummaryProgressEvent } from 'electron/src/types/sessions';
import { SUMMARY_MODEL_ARTIFACT, type SummaryModelStatus } from '../../../electron/src/types/summaryModel';
import { defaultRecordingSummaryOptions, recordingSummaryGenerationVersion } from '../../../electron/src/types/summaryOptions';
import type { RendererAdapter } from '../stores/rendererAdapter';

export type SummaryScenario =
    | 'summary-ready' | 'summary-incomplete' | 'summary-install' | 'summary-downloading' | 'summary-download-error' | 'summary-disk-full'
    | 'summary-generating' | 'summary-cancel' | 'summary-error'
    | 'summary-short' | 'summary-long' | 'summary-saved' | 'summary-legacy' | 'summary-partial';

export const stoppedSummaryOptions = { ...defaultRecordingSummaryOptions, prompt: 'Describe the conversation in two sentences.' };

const shortNotes = [
    ['When an interview includes several answers to the same question, listeners want to see the surrounding lines before choosing a search result.',
        'I need the surrounding lines to tell which search result actually answers the question.'],
    ['They agreed to pilot the new search list on Friday. The team will then compare results that show a speaker name with results that include only a timestamp.',
        'Earlier I said Thursday.  We’ll pilot on Friday 🎧.  Has anybody booked the training room?'],
] as const;
const followupNotes = [
    ['The test will include an interview with repeated dates, so participants have to distinguish a question from the answer.',
        'Use the interview where the date comes up three times, but only the last mention is a confirmation.'],
    ['The interviewer will remain unnamed in half the samples. This lets the team check whether unnamed speakers make results harder to follow.',
        'Leave the interviewer unnamed in half the samples and see if people can still follow the exchange.'],
    ['Participants will be asked to play back the answer before they decide which result to keep. The study will capture whether they heard the whole reply.',
        'Before they keep a result, ask them to play it and tell us what they heard.'],
    ['The pilot script will begin with a one-minute walkthrough. It will explain that each match links to both the transcript and the audio.',
        'Give them a minute to see that every match leads to the text and the audio.'],
    ['The team will use interviews with both short replies and longer explanations. Longer answers should remain readable when a search term occurs twice within the same reply.',
        'I’ll include short answers as well as a few long ones with two matches in the same reply.'],
    ['They will collect notes about phrases that were difficult to locate and record whether the timecode or speaker label helped.',
        'For any hard-to-find phrase, note whether the time or the speaker label got them there.'],
    ['The second group will use the timestamp-only layout first, so the comparison can account for people becoming familiar with the task as they go.',
        'Give the second group the timestamp layout first so practice doesn’t favor the same version twice.'],
    ['Anyone who uses keyboard shortcuts will try selecting a result and returning to the search box without using a mouse.',
        'Add a keyboard run where the participant can select a result and then get back to search.'],
    ['At the end, participants will describe what they expected to happen when they selected a result. The team will compare their descriptions with what the interface did.',
        'After the last question, ask what they expected when they selected a match.'],
    ['The team will review the pilot results on Monday and decide whether the speaker label should be part of every match or reserved for longer interviews.',
        'On Monday we can decide if labels belong everywhere or only in longer interviews.'],
] as const;

type SummaryAdapter = Pick<RendererAdapter, 'getSummaryModelStatus' | 'onSummaryModelChanged' | 'downloadSummaryModel'
    | 'cancelSummaryModelDownload' | 'generateSummary' | 'onSummaryProgress' | 'stopSummary'>;

export const createStorySummary = (scenario: string, save: (summary: SessionSummary) => void) => {
    const long = scenario === 'summary-long';
    const notes = long ? [...shortNotes, ...followupNotes] : shortNotes;
    const secondsPerChunk = long ? 8 : 6;
    const speakers = [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }];
    const segments: SessionTranscriptV1['segments'] = notes.map(([, text], index) => ({
        id: `demo-summary-${index}`, speakerId: speakers[index % 2].id,
        startSec: secondsPerChunk * index, endSec: secondsPerChunk * (index + 1), text,
    })).reverse();
    const reviewedChunks: ReviewedSummaryChunk[] = notes.map(([text], index) => {
        const segmentIndex = notes.length - index - 1;
        const segment = segments[segmentIndex];
        const excerpt = 'We’ll pilot on Friday 🎧.';
        const startChar = index === 1 ? segment.text.indexOf(excerpt) : 0;
        return {
            startSec: segment.startSec, endSec: segment.endSec!, text, speakers: [speakers[index % 2]],
            sourceRefs: [{ segmentIndex, segmentId: segment.id, startChar, endChar: index === 1 ? startChar + excerpt.length : segment.text.length }],
        };
    });
    const brief = [
        'The team compared ways to find a particular answer in a saved interview. They agreed to pilot a new search list on Friday.',
        'The pilot compares matches that show a speaker name with matches that show only a timestamp. Listeners can play the selected passage to confirm what they heard.',
        ...(long ? [
            'The interviews will include repeated dates, unnamed speakers and long replies. Each participant will try both layouts, and the second group will start with the timestamp-only version.',
            'The team will record whether the labels and timecodes help listeners find an answer. They will also ask keyboard users to select a result and return to search. The team will review the results on Monday.',
        ] : []),
    ].join('\n\n');
    const saved: SessionSummary = {
        brief, detailed: notes.map(([text]) => text).join('\n\n'),
        model: SUMMARY_MODEL_ARTIFACT.name, inputHash: 'story-summary-input',
        sourceRevision: 'story-summary-revision', generationVersion: recordingSummaryGenerationVersion,
        generatedAt: Date.parse('2026-11-20T14:12:00Z'), options: defaultRecordingSummaryOptions, reviewedChunks,
    };
    const savedSummary = (() => {
        if (scenario === 'summary-legacy') return {
            brief, detailed: saved.detailed, model: saved.model, inputHash: saved.inputHash, generationVersion: 2,
        };
        if (scenario === 'summary-partial') return { ...saved, brief: '', generatedAt: undefined };
        if (scenario === 'summary-short' || long || scenario === 'summary-saved') return saved;
        return undefined;
    })();
    const transcript: SessionTranscriptV1 = {
        version: 1, segments, summary: savedSummary, recognitionRevision: 'story-summary-recognition',
        speakers: {
            version: 1, recognitionRevision: 'story-summary-recognition', generation: 'story-summary-speakers',
            settings: {}, intervals: [], corrections: [], status: 'completed', speakers,
        },
    };
    if (scenario === 'summary-incomplete') {
        const completed = { ...segments[0], source: 'system' as const };
        transcript.segments = [completed];
        transcript.sourceRun = {
            status: 'incomplete', settings: { language: 'en', model: 'base' },
            sources: [
                { source: 'system', status: 'completed', segments: [completed] },
                { source: 'microphone', status: 'failed', segments: [] },
            ],
        };
    }

    let model: SummaryModelStatus = {
        model: SUMMARY_MODEL_ARTIFACT.name, totalBytes: SUMMARY_MODEL_ARTIFACT.bytes, downloadedBytes: 0, state: 'ready',
    };
    if (scenario === 'summary-install' || scenario === 'summary-saved') model.state = 'missing';
    if (scenario === 'summary-downloading') model = { ...model, state: 'downloading', downloadedBytes: 1_520_000_000 };
    if (scenario === 'summary-download-error') model = { ...model, state: 'error', error: 'download', downloadedBytes: 1_170_000_000 };
    if (scenario === 'summary-disk-full') model = { ...model, state: 'error', error: 'disk-space' };
    if (model.state === 'ready') model.downloadedBytes = model.totalBytes;
    let modelListener: ((status: SummaryModelStatus) => void) | undefined;
    let progressListener: ((progress: SummaryProgressEvent) => void) | undefined;
    let finishDownload: ((state: 'ready' | 'cancelled') => void) | undefined;
    let cancelGeneration: (() => void) | undefined;
    let attempts = 0;
    const setModel = (state: SummaryModelStatus['state'], downloadedBytes: number) => {
        model = { model: model.model, totalBytes: model.totalBytes, state, downloadedBytes };
        modelListener?.(model);
    };
    const adapter: SummaryAdapter = {
        getSummaryModelStatus: () => Promise.resolve(model),
        onSummaryModelChanged: (listener) => { modelListener = listener; return () => { modelListener = undefined; }; },
        downloadSummaryModel: () => new Promise<SummaryModelStatus>((resolve) => {
            const timer = setTimeout(() => finishDownload?.('ready'), 300);
            finishDownload = (state) => {
                clearTimeout(timer);
                finishDownload = undefined;
                setModel(state, state === 'ready' ? model.totalBytes : model.downloadedBytes);
                resolve(model);
            };
            setModel('downloading', Math.floor(model.totalBytes / 2));
        }),
        cancelSummaryModelDownload: () => {
            if (finishDownload) finishDownload('cancelled');
            else setModel('cancelled', model.downloadedBytes);
            return Promise.resolve(model);
        },
        onSummaryProgress: (listener) => { progressListener = listener; return () => { progressListener = undefined; }; },
        generateSummary: (sessionId, options = defaultRecordingSummaryOptions) => {
            attempts += 1;
            if (attempts === 1 && scenario === 'summary-error') return Promise.resolve({ ok: false, reason: 'failed' });
            if (attempts === 1 && (scenario === 'summary-cancel' || scenario === 'summary-generating')) {
                progressListener?.({ sessionId, message: 'Reviewing chunk 2 of 2…' });
                return new Promise<SummaryGenerationResult>((resolve) => {
                    cancelGeneration = () => resolve({ ok: false, reason: 'cancelled' });
                });
            }
            const summary = { ...saved, options };
            save(summary);
            return Promise.resolve({ ok: true, summary });
        },
        stopSummary: () => {
            cancelGeneration?.();
            cancelGeneration = undefined;
            return Promise.resolve(true);
        },
    };
    return { transcript, adapter, dispose: () => finishDownload?.('cancelled') };
};
