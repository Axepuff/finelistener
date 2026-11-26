interface ByteRange {
    start: number;
    end: number;
}

export const getFileByteRange = (header: string, size: number): ByteRange | null => {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
    if (!match || (!match[1] && !match[2])) return null;

    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;

    return start <= end ? { start, end } : null;
};
