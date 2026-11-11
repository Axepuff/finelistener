// Native regression check: use a short speech WAV with leading silence and pauses.
// Run against a dedicated server; this intentionally toggles VAD between requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
    const [baseUrl, wavPath] = process.argv.slice(2);
    assert(baseUrl && wavPath, 'Usage: node scripts/check-whisper-timestamps.cjs http://127.0.0.1:PORT sample.wav');
    const wav = fs.readFileSync(wavPath);
    for (const vad of [true, false, true]) {
        const form = new FormData();
        form.append('file', new Blob([wav]), 'sample.wav');
        form.append('language', 'ru');
        form.append('response_format', 'verbose_json');
        form.append('vad', String(vad));
        const response = await fetch(`${baseUrl}/inference`, { method: 'POST', body: form });
        assert(response.ok, `Inference failed: ${response.status}`);
        const result = await response.json();
        let checked = 0;
        for (const segment of result.segments ?? []) {
            for (const word of segment.words ?? []) {
                if (!(word.end > word.start) || !/[\p{L}\p{N}]/u.test(word.word ?? '')) continue;
                assert(word.start >= segment.start - 0.05 && word.end <= segment.end + 0.05,
                    `VAD=${vad}: token ${word.start}..${word.end} outside segment ${segment.start}..${segment.end}`);
                checked += 1;
            }
        }
        assert(checked > 0, 'Sample produced no timed speech; use a different fixture');
        console.log(`VAD=${vad}: ${checked} token timestamps on the original timeline`);
    }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
