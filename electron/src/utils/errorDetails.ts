const errorDetails = (error: unknown, depth = 0): string => {
    if (!(error instanceof Error)) return String(error);
    const code = 'code' in error ? ` (${String(error.code)})` : '';
    const cause = error.cause !== undefined && depth < 3 ? `; caused by ${errorDetails(error.cause, depth + 1)}` : '';
    return `${error.name}${code}: ${error.message}${cause}`;
};

export const formatActivityFailure = (action: string, error: unknown): string => `${action}: ${errorDetails(error)}`;
