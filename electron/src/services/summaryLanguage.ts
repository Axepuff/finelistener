import type { SummarySourceRow } from '../types/sessions';

export interface SummaryLanguage {
    instruction: string;
    reference: string;
    accepts: (text: string, reviewedParagraph?: string) => boolean;
}

// A quoted email or a product name can be in a different language from the people discussing it.
const narrative = (text: string): string => {
    const prose = text.replace(/«[^»]*»|“[^”]*”|"[^"\n]*"|`[^`\n]*`|https?:\/\/\S+|\b[A-Z][A-Z\d_]+\b/gu, ' ').replace(/\s+/gu, ' ').trim();
    return /\p{L}/u.test(prose) ? prose : text;
};

const sampleAcrossRecording = (text: string): string => {
    // ELD reads at most 1,000 characters. Include speech from across the recording.
    if (text.length <= 960) return text;
    return Array.from({ length: 5 }, (_, i) => {
        const start = Math.round((text.length - 192) * i / 4);
        return text.slice(start, start + 192);
    }).join(' ');
};

export const getSummaryLanguage = async (rows: SummarySourceRow[], hint?: string): Promise<SummaryLanguage> => {
    const { eld } = await import('eld/small');
    const speech = rows.map((row) => row.text).join('\n');
    const sample = sampleAcrossRecording(narrative(speech));
    const detected = eld.detect(sample);
    const hintCode = hint?.trim().toLowerCase().split(/[-_]/u)[0];
    const validHint = hintCode && /^[a-z]{2,3}$/u.test(hintCode) && hintCode !== 'und' ? hintCode : undefined;
    // Related languages often score almost identically on a two- or three-word answer.
    const plausible = (text: string, guess: typeof detected, code: string): boolean => {
        if (!guess.language || text.length > 40) return false;
        const scores = guess.getScores();
        return (scores[code] ?? 0) >= scores[guess.language] * 0.93;
    };
    const scriptOf = (code: string | undefined): string | undefined => code ? new Intl.Locale(code).maximize().script : undefined;
    let code: string | undefined;
    const uncertainScriptMatch = !detected.isReliable() && (!detected.language || scriptOf(validHint) === scriptOf(detected.language));
    if (validHint && (plausible(sample, detected, validHint) || uncertainScriptMatch)) {
        code = validHint;
    } else if (detected.isReliable()) {
        const ambiguous = Object.keys(detected.getScores()).some((other) => other !== detected.language && plausible(sample, detected, other));
        if (!ambiguous) code = detected.language;
    }
    const name = code && new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(code);
    const canCheck = code && name && Object.values(eld.info().Languages).includes(code);
    const sourceScript = scriptOf(code ?? detected.language);
    return {
        instruction: name ? `Write all narrative prose in ${name}, the language of the original transcript. Keep names and quoted terms when needed.` :
            'Write in the language the speakers use in the original transcript sample. Keep that language throughout the answer.',
        reference: name ? '' : sample.slice(0, 200),
        accepts: (text, reviewedParagraph) => {
            const prose = narrative(text);
            const actual = eld.detect(prose);
            if (code && actual.language === code) return true;
            if (code && plausible(prose, actual, code)) {
                if (!reviewedParagraph || !actual.isReliable()) return true;
                // Short headings can resemble another language even when they reuse the paragraph's vocabulary.
                const words = (value: string) => value.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
                const paragraphWords = new Set(words(reviewedParagraph));
                if (words(prose).every((word) => paragraphWords.has(word) || eld.detect(word).language === code)) return true;
            }
            if (sourceScript && actual.language && scriptOf(actual.language) !== sourceScript) return false;
            return !canCheck || !actual.isReliable();
        },
    };
};
