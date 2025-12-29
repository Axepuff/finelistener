export interface LoudnormOptions {
    integrated?: number;
    truePeak?: number;
    loudnessRange?: number;
}

interface LoudnessNormalizerDeps {
    runFfmpegWithStderr: (args: string[]) => Promise<string>;
    buildAnalysisArgs: (audioPath: string, filterChain?: string | null) => string[];
}

interface LoudnormTarget {
    integrated: number;
    truePeak: number;
    loudnessRange: number;
}

interface LoudnormAnalysis {
    measuredI: string;
    measuredTP: string;
    measuredLRA: string;
    measuredThresh: string;
    offset: string;
}

const DEFAULT_LOUDNORM_TARGET: LoudnormTarget = {
    integrated: -19,
    truePeak: -1.0,
    loudnessRange: 9,
};

export class Loudnorm {
    private readonly runFfmpegWithStderr: (args: string[]) => Promise<string>;
    private readonly buildAnalysisArgs: (audioPath: string, filterChain?: string | null) => string[];

    constructor(deps: LoudnessNormalizerDeps) {
        this.runFfmpegWithStderr = deps.runFfmpegWithStderr;
        this.buildAnalysisArgs = deps.buildAnalysisArgs;
    }

    public async buildFilter(
        audioPath: string,
        preFilters: string[],
        options?: boolean | LoudnormOptions,
    ): Promise<string | null> {
        const target = this.resolveTarget(options);

        if (!target) {
            return null;
        }

        const analysis = await this.analyzeLoudness(audioPath, preFilters, target);

        if (analysis) {
            return this.buildPass2Filter(target, analysis);
        }

        return this.buildSinglePassFilter(target);
    }

    private resolveTarget(options?: boolean | LoudnormOptions): LoudnormTarget | null {
        if (!options) return null;

        if (options === true) {
            return { ...DEFAULT_LOUDNORM_TARGET };
        }

        return {
            integrated: this.ensureFiniteNumber(
                options.integrated ?? DEFAULT_LOUDNORM_TARGET.integrated,
                'loudnorm I',
            ),
            truePeak: this.ensureFiniteNumber(options.truePeak ?? DEFAULT_LOUDNORM_TARGET.truePeak, 'loudnorm TP'),
            loudnessRange: this.ensureFiniteNumber(
                options.loudnessRange ?? DEFAULT_LOUDNORM_TARGET.loudnessRange,
                'loudnorm LRA',
            ),
        };
    }

    private ensureFiniteNumber(value: number, label: string): number {
        if (!Number.isFinite(value)) {
            throw new Error(`Некорректное значение параметра ${label}: ${value}`);
        }

        return value;
    }

    private async analyzeLoudness(
        audioPath: string,
        preFilters: string[],
        target: LoudnormTarget,
    ): Promise<LoudnormAnalysis | null> {
        const filterChain = this.buildFilterChain([...preFilters, this.buildPass1Filter(target)]);
        const a = Date.now();

        const stderr = await this.runFfmpegWithStderr(this.buildAnalysisArgs(audioPath, filterChain));

        console.log('analyzeLoudness duration', Date.now() - a, ' ms');

        return this.parseAnalysis(stderr);
    }

    private buildFilterChain(filters: string[]): string | null {
        const normalized = filters.filter((filter) => filter.trim().length > 0);

        return normalized.length > 0 ? normalized.join(',') : null;
    }

    private buildPass1Filter(target: LoudnormTarget): string {
        return `${this.buildBaseFilter(target)}:print_format=json`;
    }

    private buildPass2Filter(target: LoudnormTarget, analysis: LoudnormAnalysis): string {
        return `${this.buildBaseFilter(target)}:measured_I=${analysis.measuredI}:measured_TP=${analysis.measuredTP}:measured_LRA=${analysis.measuredLRA}:measured_thresh=${analysis.measuredThresh}:offset=${analysis.offset}`;
    }

    private buildSinglePassFilter(target: LoudnormTarget): string {
        return this.buildBaseFilter(target);
    }

    private buildBaseFilter(target: LoudnormTarget): string {
        return `loudnorm=I=${target.integrated}:TP=${target.truePeak}:LRA=${target.loudnessRange}`;
    }

    private parseAnalysis(stderr: string): LoudnormAnalysis | null {
        const jsonText = this.extractJsonBlock(stderr);

        if (!jsonText) {
            return null;
        }
        let payload: Record<string, unknown>;

        try {
            payload = JSON.parse(jsonText) as Record<string, unknown>;
        } catch {
            return null;
        }

        const measuredI = this.pickValue(payload, ['measured_I', 'input_i']);
        const measuredTP = this.pickValue(payload, ['measured_TP', 'input_tp']);
        const measuredLRA = this.pickValue(payload, ['measured_LRA', 'input_lra']);
        const measuredThresh = this.pickValue(payload, ['measured_thresh', 'input_thresh']);
        const offset = this.pickValue(payload, ['offset', 'target_offset']);

        if (!measuredI || !measuredTP || !measuredLRA || !measuredThresh || !offset) {
            return null;
        }

        if (
            !this.isFiniteNumberString(measuredI) ||
            !this.isFiniteNumberString(measuredTP) ||
            !this.isFiniteNumberString(measuredLRA) ||
            !this.isFiniteNumberString(measuredThresh) ||
            !this.isFiniteNumberString(offset)
        ) {
            return null;
        }

        return { measuredI, measuredTP, measuredLRA, measuredThresh, offset };
    }

    private pickValue(payload: Record<string, unknown>, keys: string[]): string | null {
        for (const key of keys) {
            const value = payload[key];

            if (value === null || value === undefined) {
                continue;
            }

            // TODO wtf
            const normalized =
                typeof value === 'string'
                    ? value.trim()
                    : typeof value === 'number' || typeof value === 'boolean'
                        ? String(value)
                        : '';

            if (normalized.length > 0) {
                return normalized;
            }
        }

        return null;
    }

    private extractJsonBlock(stderr: string): string | null {
        const matches = stderr.match(/\{[\s\S]*?\}/g);

        if (!matches || matches.length === 0) {
            return null;
        }

        return matches[matches.length - 1];
    }

    private isFiniteNumberString(value: string): boolean {
        const parsed = Number.parseFloat(value);

        return Number.isFinite(parsed);
    }
}
