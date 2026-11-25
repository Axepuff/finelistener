import { defaultRecordingSummaryOptions, maxSummaryPromptLength } from './summaryOptions';

export interface SummaryPromptPreset {
    name: string;
    prompt: string;
}

export const builtInSummaryPresets: readonly SummaryPromptPreset[] = [
    { name: 'Default', prompt: defaultRecordingSummaryOptions.prompt },
    { name: 'Meeting notes', prompt: 'Summarize the meeting topics, decisions and open questions. Include agreed next steps, owners and deadlines only when the speakers stated them. Distinguish proposals from decisions.' },
    { name: 'Action items', prompt: 'List the actions the speakers agreed to take. Include the responsible person and deadline when stated. Keep suggestions and unresolved requests separate from commitments. If no action was agreed, say so.' },
    { name: 'Interview', prompt: 'Summarize the questions and the interviewee’s main answers by topic. Preserve relevant examples and qualifications. Attribute statements to the speaker when clear and use only information from the conversation.' },
];

export const isUserSummaryPresets = (value: unknown): value is SummaryPromptPreset[] => {
    if (!Array.isArray(value)) return false;
    const names = new Set(builtInSummaryPresets.map(({ name }) => name.toLowerCase()));
    return value.every((item: unknown) => {
        if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string'
            || !item.name.trim() || item.name !== item.name.trim() || names.has(item.name.toLowerCase())
            || !('prompt' in item) || typeof item.prompt !== 'string' || !item.prompt.trim() || item.prompt.length > maxSummaryPromptLength) return false;
        names.add(item.name.toLowerCase());
        return true;
    });
};
