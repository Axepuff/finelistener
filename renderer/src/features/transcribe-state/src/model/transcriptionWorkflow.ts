// Deterministic operator-mode workflow for an industrial-style control panel.
export type TranscriptionWorkflowState = 'empty' | 'loaded' | 'transcribing' | 'done';
export type TranscriptionRunOutcome = 'none' | 'success' | 'error';
export type TranscriptionLifecycleState = 'initial' | 'transcribing' | 'ready';

export interface TranscriptionWorkflowInput {
    lifecycleState: TranscriptionLifecycleState;
    hasAudioSource: boolean;
    hasRenderedOutput: boolean;
    runOutcome: TranscriptionRunOutcome;
}

export interface TranscriptionWorkflowSnapshot {
    state: TranscriptionWorkflowState;
    outcome: TranscriptionRunOutcome;
    hasAudioSource: boolean;
    hasRenderedOutput: boolean;
    hasError: boolean;
}

interface WorkflowStateContract {
    primaryAction: 'choose-audio' | 'transcribe' | 'stop' | 'review-output';
    allowsStopAction: boolean;
    allowsResetAction: boolean;
    showsProgress: boolean;
    operatorSignal: 'standby' | 'armed' | 'running' | 'report';
}

export const TRANSCRIPTION_WORKFLOW_CONTRACT: Record<TranscriptionWorkflowState, WorkflowStateContract> = {
    empty: {
        primaryAction: 'choose-audio',
        allowsStopAction: false,
        allowsResetAction: false,
        showsProgress: false,
        operatorSignal: 'standby',
    },
    loaded: {
        primaryAction: 'transcribe',
        allowsStopAction: false,
        allowsResetAction: true,
        showsProgress: false,
        operatorSignal: 'armed',
    },
    transcribing: {
        primaryAction: 'stop',
        allowsStopAction: true,
        allowsResetAction: false,
        showsProgress: true,
        operatorSignal: 'running',
    },
    done: {
        primaryAction: 'review-output',
        allowsStopAction: false,
        allowsResetAction: true,
        showsProgress: false,
        operatorSignal: 'report',
    },
};

// Baseline KPI targets for an industrial control-panel UX.
export const TRANSCRIPTION_WORKFLOW_KPI_TARGETS = Object.freeze({
    minBodyTextContrastRatio: 4.5,
    minCriticalTextContrastRatio: 7,
    maxPrimaryActionsPerState: 2,
    maxCriticalActionLatencyMs: 150,
    maxAmbiguousStatusIndicators: 0,
});

export const evaluateTranscriptionWorkflow = ({
    lifecycleState,
    hasAudioSource,
    hasRenderedOutput,
    runOutcome,
}: TranscriptionWorkflowInput): TranscriptionWorkflowSnapshot => {
    if (lifecycleState === 'transcribing') {
        return {
            state: 'transcribing',
            outcome: runOutcome,
            hasAudioSource,
            hasRenderedOutput,
            hasError: runOutcome === 'error',
        };
    }

    if (!hasAudioSource) {
        return {
            state: 'empty',
            outcome: 'none',
            hasAudioSource: false,
            hasRenderedOutput: false,
            hasError: false,
        };
    }

    const resolvedOutcome = runOutcome === 'none' && hasRenderedOutput
        ? 'success'
        : runOutcome;
    const state: TranscriptionWorkflowState = resolvedOutcome === 'none'
        ? 'loaded'
        : 'done';

    return {
        state,
        outcome: resolvedOutcome,
        hasAudioSource,
        hasRenderedOutput,
        hasError: resolvedOutcome === 'error',
    };
};
