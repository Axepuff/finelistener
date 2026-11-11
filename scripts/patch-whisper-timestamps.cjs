// Keep verbose JSON tokens on the same original-audio timeline as segments.
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../whisper.cpp/src/whisper.cpp');
let text = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const marker = '// FineListener: restore VAD token timestamps without mutating recognition state.';
if (!text.includes(marker)) {
    const original = `struct whisper_token_data whisper_full_get_token_data_from_state(struct whisper_state * state, int i_segment, int i_token) {
    return state->result_all[i_segment].tokens[i_token];
}

struct whisper_token_data whisper_full_get_token_data(struct whisper_context * ctx, int i_segment, int i_token) {
    return ctx->state->result_all[i_segment].tokens[i_token];
}`;
    if (!text.includes(original)) throw new Error('Unsupported whisper token accessor; review the timestamp patch');
    text = text.replace(original, `${marker}
struct whisper_token_data whisper_full_get_token_data_from_state(struct whisper_state * state, int i_segment, int i_token) {
    auto token = state->result_all[i_segment].tokens[i_token];
    if (state->has_vad_segments && !state->vad_mapping_table.empty()) {
        if (token.t0 >= 0) token.t0 = map_processed_to_original_time(token.t0, state->vad_mapping_table);
        if (token.t1 >= 0) token.t1 = map_processed_to_original_time(token.t1, state->vad_mapping_table);
    }
    return token;
}

struct whisper_token_data whisper_full_get_token_data(struct whisper_context * ctx, int i_segment, int i_token) {
    return whisper_full_get_token_data_from_state(ctx->state, i_segment, i_token);
}`);
    const entry = '    std::vector<float> vad_samples;\n    if (params.vad) {';
    if (text.split(entry).length !== 3) throw new Error('Unsupported whisper inference entry points; review the timestamp patch');
    text = text.replaceAll(entry, `    // A reused server must not apply the previous request's VAD mapping.
    ctx->state->has_vad_segments = false;
    ctx->state->vad_mapping_table.clear();
    std::vector<float> vad_samples;
    if (params.vad) {`);
    fs.writeFileSync(source, text);
}
