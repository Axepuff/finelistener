#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace {

constexpr ma_uint32 kDefaultSampleRate = 16000;
constexpr ma_uint32 kDefaultChannels = 1;
constexpr ma_uint32 kDefaultBitDepth = 16;

struct Options {
    bool listDevices = false;
    std::string outputPath;
    std::string deviceId;
    int deviceIndex = -1;
    ma_uint32 sampleRate = kDefaultSampleRate;
    ma_uint32 channels = kDefaultChannels;
    ma_uint32 bitDepth = kDefaultBitDepth;
};

struct DeviceChoice {
    bool hasId = false;
    bool hasIndex = false;
    ma_device_id id{};
    int index = -1;
};

struct AppState {
    ma_encoder encoder{};
    std::atomic<ma_uint64> totalFrames{0};
    std::atomic<ma_uint64> bytesWritten{0};
    std::atomic<float> rms{0.0f};
    std::atomic<float> peak{0.0f};
    std::atomic<int> clipped{0};
    std::atomic<int> lastError{MA_SUCCESS};
    ma_uint32 sampleRate = kDefaultSampleRate;
    ma_uint32 channels = kDefaultChannels;
    ma_uint32 bytesPerFrame = 2;
};

std::atomic<bool> g_shouldQuit{false};

void onSignal(int) {
    g_shouldQuit.store(true);
}

void printUsage() {
    std::fprintf(stderr,
        "miniaudio-loopback --output <path> [--device-id <id>|--device-index <n>] "
        "[--sample-rate <hz>] [--channels <n>] [--bit-depth <n>] [--list-devices]\n");
}

bool parseInt(const char* text, int& out) {
    if (!text) return false;
    errno = 0;
    char* end = nullptr;
    long value = std::strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') return false;
    if (value < (std::numeric_limits<int>::min)() || value > (std::numeric_limits<int>::max)()) return false;
    out = static_cast<int>(value);
    return true;
}

bool parseUint32(const char* text, ma_uint32& out) {
    if (!text) return false;
    errno = 0;
    char* end = nullptr;
    unsigned long value = std::strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') return false;
    if (value > (std::numeric_limits<ma_uint32>::max)()) return false;
    out = static_cast<ma_uint32>(value);
    return true;
}

bool parseArgs(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; i += 1) {
        const std::string arg = argv[i];
        if (arg == "--list-devices") {
            options.listDevices = true;
        } else if (arg == "--output" && i + 1 < argc) {
            options.outputPath = argv[++i];
        } else if (arg == "--device-id" && i + 1 < argc) {
            options.deviceId = argv[++i];
        } else if (arg == "--device-index" && i + 1 < argc) {
            int value = 0;
            if (!parseInt(argv[i + 1], value) || value < 0) {
                std::fprintf(stderr, "Invalid value for --device-index: %s\n", argv[i + 1]);
                return false;
            }
            options.deviceIndex = value;
            i += 1;
        } else if (arg == "--sample-rate" && i + 1 < argc) {
            ma_uint32 value = 0;
            if (!parseUint32(argv[i + 1], value) || value == 0) {
                std::fprintf(stderr, "Invalid value for --sample-rate: %s\n", argv[i + 1]);
                return false;
            }
            options.sampleRate = value;
            i += 1;
        } else if (arg == "--channels" && i + 1 < argc) {
            ma_uint32 value = 0;
            if (!parseUint32(argv[i + 1], value) || value == 0) {
                std::fprintf(stderr, "Invalid value for --channels: %s\n", argv[i + 1]);
                return false;
            }
            options.channels = value;
            i += 1;
        } else if (arg == "--bit-depth" && i + 1 < argc) {
            ma_uint32 value = 0;
            if (!parseUint32(argv[i + 1], value) || value == 0) {
                std::fprintf(stderr, "Invalid value for --bit-depth: %s\n", argv[i + 1]);
                return false;
            }
            options.bitDepth = value;
            i += 1;
        } else if (arg == "--help" || arg == "-h") {
            printUsage();
            return false;
        } else {
            std::fprintf(stderr, "Unknown argument: %s\n", arg.c_str());
            printUsage();
            return false;
        }
    }

    if (!options.listDevices && options.outputPath.empty()) {
        std::fprintf(stderr, "--output is required unless --list-devices is used.\n");
        printUsage();
        return false;
    }

    return true;
}

std::string jsonEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size());
    for (char c : value) {
        switch (c) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\b':
                out += "\\b";
                break;
            case '\f':
                out += "\\f";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[7] = {};
                    std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned char>(c));
                    out += buf;
                } else {
                    out += c;
                }
                break;
        }
    }
    return out;
}

#ifdef _WIN32
std::string wasapiIdToUtf8(const ma_device_id& id) {
    const wchar_t* wide = reinterpret_cast<const wchar_t*>(id.wasapi);
    if (wide[0] == L'\0') return {};

    int length = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 0) return {};
    std::string out(static_cast<size_t>(length), '\0');
    int written = WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), length, nullptr, nullptr);
    if (written <= 0) return {};
    if (out.back() == '\0') {
        out.pop_back();
    }
    return out;
}

bool utf8ToWasapiId(const std::string& value, ma_device_id& outId) {
    std::memset(&outId, 0, sizeof(outId));
    if (value.empty()) return false;

    int length = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
    if (length <= 0) return false;

    const size_t maxChars = sizeof(outId.wasapi) / sizeof(outId.wasapi[0]);
    if (static_cast<size_t>(length) > maxChars) {
        return false;
    }

    MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, reinterpret_cast<wchar_t*>(outId.wasapi), length);
    return true;
}
#endif

void emitJsonLine(const std::string& line) {
    std::fwrite(line.c_str(), 1, line.size(), stdout);
    std::fwrite("\n", 1, 1, stdout);
    std::fflush(stdout);
}

void emitError(const std::string& message) {
    emitJsonLine("{\"type\":\"error\",\"message\":\"" + jsonEscape(message) + "\"}");
}

ma_result listDevices() {
    ma_backend backends[] = { ma_backend_wasapi };
    ma_context context;
    ma_context_config config = ma_context_config_init();
    ma_result result = ma_context_init(backends, 1, &config, &context);
    if (result != MA_SUCCESS) {
        return result;
    }

    ma_device_info* playbackInfos = nullptr;
    ma_uint32 playbackCount = 0;
    ma_device_info* captureInfos = nullptr;
    ma_uint32 captureCount = 0;
    result = ma_context_get_devices(&context, &playbackInfos, &playbackCount, &captureInfos, &captureCount);

    if (result != MA_SUCCESS) {
        ma_context_uninit(&context);
        return result;
    }

    std::string payload = "[";
    for (ma_uint32 i = 0; i < playbackCount; i += 1) {
        const ma_device_info& info = playbackInfos[i];
        if (i > 0) payload += ",";
        std::string idStr = wasapiIdToUtf8(info.id);
        payload += "{\"id\":\"" + jsonEscape(idStr) + "\",\"name\":\""
            + jsonEscape(info.name) + "\",\"isDefault\":"
            + (info.isDefault ? "true" : "false") + ",\"index\":"
            + std::to_string(i) + "}";
    }
    payload += "]";
    std::fwrite(payload.c_str(), 1, payload.size(), stdout);
    std::fflush(stdout);

    ma_context_uninit(&context);
    return MA_SUCCESS;
}

void dataCallback(ma_device* device, void* /*pOutput*/, const void* pInput, ma_uint32 frameCount) {
    if (!device || !pInput) return;

    auto* state = reinterpret_cast<AppState*>(device->pUserData);
    if (!state) return;

    ma_result result = ma_encoder_write_pcm_frames(&state->encoder, pInput, frameCount, nullptr);
    if (result != MA_SUCCESS) {
        state->lastError.store(result);
        g_shouldQuit.store(true);
        return;
    }

    const ma_uint64 frames = static_cast<ma_uint64>(frameCount);
    state->totalFrames.fetch_add(frames);
    state->bytesWritten.fetch_add(frames * state->bytesPerFrame);

    const auto* samples = reinterpret_cast<const ma_int16*>(pInput);
    const ma_uint64 sampleCount = frames * state->channels;
    if (sampleCount == 0) return;

    double sumSquares = 0.0;
    ma_int32 peak = 0;
    bool clipped = false;

    for (ma_uint64 i = 0; i < sampleCount; i += 1) {
        const ma_int32 sample = samples[i];
        const ma_int32 absValue = sample < 0 ? -sample : sample;
        if (absValue >= 32767) clipped = true;
        if (absValue > peak) peak = absValue;
        const double normalized = static_cast<double>(sample) / 32768.0;
        sumSquares += normalized * normalized;
    }

    const double rms = std::sqrt(sumSquares / static_cast<double>(sampleCount));
    const double peakNorm = static_cast<double>(peak) / 32768.0;

    state->rms.store(static_cast<float>(rms));
    state->peak.store(static_cast<float>(peakNorm));
    state->clipped.store(clipped ? 1 : 0);
}

DeviceChoice resolveDeviceChoice(const Options& options) {
    DeviceChoice choice;
#ifdef _WIN32
    if (!options.deviceId.empty()) {
        if (utf8ToWasapiId(options.deviceId, choice.id)) {
            choice.hasId = true;
        }
    }
#endif
    if (options.deviceIndex >= 0) {
        choice.hasIndex = true;
        choice.index = options.deviceIndex;
    }
    return choice;
}

ma_result resolveDeviceIdFromIndex(ma_context& context, int index, ma_device_id& outId) {
    ma_device_info* playbackInfos = nullptr;
    ma_uint32 playbackCount = 0;
    ma_device_info* captureInfos = nullptr;
    ma_uint32 captureCount = 0;
    ma_result result = ma_context_get_devices(&context, &playbackInfos, &playbackCount, &captureInfos, &captureCount);
    if (result != MA_SUCCESS) return result;
    if (index < 0 || static_cast<ma_uint32>(index) >= playbackCount) return MA_INVALID_ARGS;

    outId = playbackInfos[index].id;
    return MA_SUCCESS;
}

} // namespace

int main(int argc, char** argv) {
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);

    Options options;
    if (!parseArgs(argc, argv, options)) {
        return 1;
    }

    if (options.listDevices) {
        ma_result result = listDevices();
        if (result != MA_SUCCESS) {
            std::fprintf(stderr, "Failed to list devices: %s\n", ma_result_description(result));
            return 1;
        }
        return 0;
    }

    if (options.bitDepth != 16) {
        std::fprintf(stderr, "Only 16-bit PCM is supported.\n");
        return 1;
    }

    ma_backend backends[] = { ma_backend_wasapi };
    ma_context context;
    ma_context_config contextConfig = ma_context_config_init();
    ma_result result = ma_context_init(backends, 1, &contextConfig, &context);
    if (result != MA_SUCCESS) {
        emitError(std::string("Failed to init audio context: ") + ma_result_description(result));
        return 1;
    }

    DeviceChoice choice = resolveDeviceChoice(options);
    ma_device_id resolvedDeviceId{};
    const ma_device_id* deviceIdPtr = nullptr;

    if (choice.hasId) {
        resolvedDeviceId = choice.id;
        deviceIdPtr = &resolvedDeviceId;
    } else if (choice.hasIndex) {
        result = resolveDeviceIdFromIndex(context, choice.index, resolvedDeviceId);
        if (result != MA_SUCCESS) {
            ma_context_uninit(&context);
            emitError(std::string("Invalid device index: ") + std::to_string(choice.index));
            return 1;
        }
        deviceIdPtr = &resolvedDeviceId;
    }

    AppState state;
    state.sampleRate = options.sampleRate;
    state.channels = options.channels;
    state.bytesPerFrame = options.channels * (options.bitDepth / 8);

    ma_encoder_config encoderConfig = ma_encoder_config_init(
        ma_encoding_format_wav,
        ma_format_s16,
        options.channels,
        options.sampleRate
    );
    result = ma_encoder_init_file(options.outputPath.c_str(), &encoderConfig, &state.encoder);
    if (result != MA_SUCCESS) {
        ma_context_uninit(&context);
        emitError(std::string("Failed to open output: ") + ma_result_description(result));
        return 1;
    }

    ma_device_config deviceConfig = ma_device_config_init(ma_device_type_loopback);
    deviceConfig.capture.format = ma_format_s16;
    deviceConfig.capture.channels = options.channels;
    deviceConfig.capture.pDeviceID = deviceIdPtr;
    deviceConfig.capture.shareMode = ma_share_mode_shared;
    deviceConfig.sampleRate = options.sampleRate;
    deviceConfig.dataCallback = dataCallback;
    deviceConfig.pUserData = &state;

    ma_device device;
    result = ma_device_init(&context, &deviceConfig, &device);
    if (result != MA_SUCCESS) {
        ma_encoder_uninit(&state.encoder);
        ma_context_uninit(&context);
        emitError(std::string("Failed to init loopback device: ") + ma_result_description(result));
        return 1;
    }

    emitJsonLine("{\"type\":\"format\",\"sampleRateHz\":" + std::to_string(options.sampleRate)
        + ",\"channels\":" + std::to_string(options.channels)
        + ",\"bitDepth\":16,\"codec\":\"pcm_s16le\"}");

    result = ma_device_start(&device);
    if (result != MA_SUCCESS) {
        ma_device_uninit(&device);
        ma_encoder_uninit(&state.encoder);
        ma_context_uninit(&context);
        emitError(std::string("Failed to start loopback device: ") + ma_result_description(result));
        return 1;
    }

    using clock = std::chrono::steady_clock;
    auto lastProgressAt = clock::now();
    auto lastLevelAt = clock::now();

    while (!g_shouldQuit.load()) {
        if (state.lastError.load() != MA_SUCCESS) {
            emitError(std::string("Encoder error: ") + ma_result_description(static_cast<ma_result>(state.lastError.load())));
            break;
        }

        const auto now = clock::now();
        if (now - lastProgressAt >= std::chrono::milliseconds(300)) {
            lastProgressAt = now;
            const auto frames = state.totalFrames.load();
            const double durationMs = options.sampleRate > 0
                ? (static_cast<double>(frames) / static_cast<double>(options.sampleRate)) * 1000.0
                : 0.0;
            emitJsonLine("{\"type\":\"progress\",\"durationMs\":" + std::to_string(static_cast<long long>(durationMs))
                + ",\"bytesWritten\":" + std::to_string(state.bytesWritten.load()) + "}");
        }

        if (now - lastLevelAt >= std::chrono::milliseconds(250)) {
            lastLevelAt = now;
            const float rms = state.rms.load();
            const float peak = state.peak.load();
            const bool clipped = state.clipped.load() != 0;
            emitJsonLine("{\"type\":\"level\",\"rms\":" + std::to_string(rms)
                + ",\"peak\":" + std::to_string(peak)
                + ",\"clipped\":" + std::string(clipped ? "true" : "false") + "}");
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    ma_device_stop(&device);
    ma_device_uninit(&device);
    ma_encoder_uninit(&state.encoder);
    ma_context_uninit(&context);

    return 0;
}
