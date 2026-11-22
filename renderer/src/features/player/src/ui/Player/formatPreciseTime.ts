export const formatPreciseTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';

    const centiseconds = Math.round(seconds * 100);
    const minutes = Math.floor(centiseconds / 6000);
    const secs = (centiseconds % 6000) / 100;

    return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`;
};
