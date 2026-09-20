/** Inspect prepared PCM samples without treating a quiet voice as silence. */
export const isSilentPcmWav = (audio: Uint8Array): boolean => {
    const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
    if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF'
        || data.toString('ascii', 8, 12) !== 'WAVE') return false;
    let isPcm16 = false;
    for (let offset = 12; offset + 8 <= data.length;) {
        const name = data.toString('ascii', offset, offset + 4);
        const size = data.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = start + size;
        if (end > data.length) return false;
        if (name === 'fmt ' && size >= 16) {
            isPcm16 = data.readUInt16LE(start) === 1 && data.readUInt16LE(start + 14) === 16;
        }
        if (name === 'data') {
            if (!isPcm16 || size % 2 !== 0) return false;
            for (let sample = start; sample < end; sample += 2) {
                if (data.readInt16LE(sample) !== 0) return false;
            }
            return true;
        }
        offset = end + size % 2;
    }
    return false;
};
