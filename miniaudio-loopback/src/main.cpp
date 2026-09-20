#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"
#include "timeline.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {
constexpr unsigned sampleRate = 16000;
std::string escape(const std::string& value) {
    std::string out;
    for (unsigned char c : value) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (c < 32) { char buf[7]; std::snprintf(buf, sizeof(buf), "\\u%04x", c); out += buf; }
        else out += c;
    }
    return out;
}
std::wstring wide(const std::string& text) {
    int count = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
    std::wstring result(count, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, result.data(), count);
    if (!result.empty()) result.pop_back();
    return result;
}
std::string utf8(const wchar_t* text) {
    int count = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string result(count, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), count, nullptr, nullptr);
    if (!result.empty()) result.pop_back();
    return result;
}
void emit(const std::string& text) { std::puts(text.c_str()); std::fflush(stdout); }
void error(const std::string& text, bool recoverable = false) {
    emit("{\"type\":\"error\",\"message\":\"" + escape(text) + "\"" + (recoverable ? ",\"recoverable\":true" : "") + "}");
}
uint64_t qpcTime() {
    LARGE_INTEGER now, frequency;
    QueryPerformanceCounter(&now); QueryPerformanceFrequency(&frequency);
    return static_cast<uint64_t>(static_cast<long double>(now.QuadPart) * 10000000 / frequency.QuadPart);
}
template<class T> void release(T*& ptr) { if (ptr) ptr->Release(); ptr = nullptr; }
struct Source {
    std::string kind, path, id;
    IMMDevice* device = nullptr;
    IAudioClient* client = nullptr;
    IAudioCaptureClient* capture = nullptr;
    WAVEFORMATEX* format = nullptr;
    ma_encoder encoder{};
    bool encoded = false, started = false, failed = false;
    uint64_t frames = 0, packetTime = 0;
    std::vector<float> pending;
    float rms = 0, peak = 0;
    ~Source() {
        if (started) client->Stop();
        release(capture); release(client); release(device);
        CoTaskMemFree(format);
        if (encoded) ma_encoder_uninit(&encoder);
    }
};
bool writeFrames(Source& source, const ma_int16* samples, size_t count) {
    ma_uint64 written = 0;
    if (ma_encoder_write_pcm_frames(&source.encoder, samples, count, &written) != MA_SUCCESS || written != count) return false;
    source.frames += written;
    return true;
}
bool pad(Source& source, uint64_t until) {
    const ma_int16 silence[4096] = {};
    while (source.frames < until) {
        if (!writeFrames(source, silence, static_cast<size_t>((std::min)(until - source.frames, uint64_t(4096))))) return false;
    }
    return true;
}
// Packet QPC timestamps share the system clock across endpoints. Resampling each
// packet onto that clock prevents independent device clocks accumulating drift.
bool flushPacket(Source& source, uint64_t endTime, uint64_t epoch) {
    if (source.pending.empty()) return true;
    const auto interval = timelineInterval(source.packetTime, endTime, epoch, sampleRate);
    const uint64_t first = (std::max)(interval.first, source.frames);
    if (!pad(source, interval.first)) return false;
    if (interval.second > first) {
        std::vector<ma_int16> samples(static_cast<size_t>(interval.second - first));
        for (size_t i = 0; i < samples.size(); ++i) {
            const float value = resampleFrame(source.pending, first + i - interval.first, interval.second - interval.first);
            samples[i] = static_cast<ma_int16>((std::clamp)(value * 32767.0f, -32768.0f, 32767.0f));
        }
        if (!writeFrames(source, samples.data(), samples.size())) return false;
    }
    source.pending.clear();
    return true;
}
uint64_t nominalEnd(const Source& source) {
    return source.packetTime + static_cast<uint64_t>(source.pending.size()) * 10000000 / source.format->nSamplesPerSec;
}
float sampleValue(const BYTE* bytes, const WAVEFORMATEX* format) {
    const bool floating = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
        (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    if (floating) { float sample; std::memcpy(&sample, bytes, 4); return std::isfinite(sample) ? sample : 0; }
    if (format->wBitsPerSample == 16) { int16_t sample; std::memcpy(&sample, bytes, 2); return sample / 32768.0f; }
    if (format->wBitsPerSample == 24) { uint32_t packed = uint32_t(bytes[0]) << 8 | uint32_t(bytes[1]) << 16 | uint32_t(bytes[2]) << 24; return static_cast<int32_t>(packed) / 2147483648.0f; }
    int32_t sample; std::memcpy(&sample, bytes, 4); return sample / 2147483648.0f;
}
HRESULT readPackets(Source& source, uint64_t epoch) {
    UINT32 available = 0;
    HRESULT result = source.capture->GetNextPacketSize(&available);
    while (SUCCEEDED(result) && available) {
        BYTE* data = nullptr; UINT32 count = 0; DWORD flags = 0; UINT64 position = 0, timestamp = 0;
        result = source.capture->GetBuffer(&data, &count, &flags, &position, &timestamp);
        if (FAILED(result)) break;
        if (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR) timestamp = qpcTime() - uint64_t(count) * 10000000 / source.format->nSamplesPerSec;
        // A gap/discontinuity must be silence, never stretched old speech.
        const uint64_t end = packetEnd(source.packetTime, nominalEnd(source), timestamp, (flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) != 0);
        if (!flushPacket(source, end, epoch)) { source.capture->ReleaseBuffer(count); return E_FAIL; }
        source.packetTime = timestamp;
        source.pending.assign(count, 0);
        double squares = 0; float peak = 0;
        for (UINT32 frame = 0; frame < count; ++frame) {
            float mono = 0;
            if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
                for (unsigned channel = 0; channel < source.format->nChannels; ++channel)
                    mono += sampleValue(data + frame * source.format->nBlockAlign + channel * (source.format->wBitsPerSample / 8), source.format);
                mono /= source.format->nChannels;
            }
            source.pending[frame] = mono; squares += mono * mono; peak = (std::max)(peak, std::abs(mono));
        }
        source.rms = count ? static_cast<float>(std::sqrt(squares / count)) : 0; source.peak = peak;
        result = source.capture->ReleaseBuffer(count);
        if (FAILED(result)) break;
        result = source.capture->GetNextPacketSize(&available);
    }
    return result;
}
HRESULT initialize(Source& source, IMMDeviceEnumerator* enumerator) {
    const EDataFlow flow = source.kind == "system" ? eRender : eCapture;
    HRESULT result = source.id.empty() ? enumerator->GetDefaultAudioEndpoint(flow, eConsole, &source.device)
                                      : enumerator->GetDevice(wide(source.id).c_str(), &source.device);
    if (FAILED(result)) return result;
    IMMEndpoint* endpoint = nullptr; EDataFlow actual = eAll;
    result = source.device->QueryInterface(__uuidof(IMMEndpoint), reinterpret_cast<void**>(&endpoint));
    if (SUCCEEDED(result)) result = endpoint->GetDataFlow(&actual);
    release(endpoint);
    if (FAILED(result) || actual != flow) return E_INVALIDARG;
    result = source.device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&source.client));
    if (FAILED(result)) return result;
    result = source.client->GetMixFormat(&source.format);
    if (FAILED(result)) return result;
    const bool floating = source.format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT || (source.format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && reinterpret_cast<WAVEFORMATEXTENSIBLE*>(source.format)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    const bool pcm = source.format->wFormatTag == WAVE_FORMAT_PCM || (source.format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && reinterpret_cast<WAVEFORMATEXTENSIBLE*>(source.format)->SubFormat == KSDATAFORMAT_SUBTYPE_PCM);
    if ((!floating && !pcm) || (floating && source.format->wBitsPerSample != 32) || (pcm && source.format->wBitsPerSample != 16 && source.format->wBitsPerSample != 24 && source.format->wBitsPerSample != 32)) return AUDCLNT_E_UNSUPPORTED_FORMAT;
    result = source.client->Initialize(AUDCLNT_SHAREMODE_SHARED, source.kind == "system" ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0, 1000000, 0, source.format, nullptr);
    if (FAILED(result)) return result;
    result = source.client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&source.capture));
    if (FAILED(result)) return result;
    const auto config = ma_encoder_config_init(ma_encoding_format_wav, ma_format_s16, 1, sampleRate);
    if (ma_encoder_init_file_w(wide(source.path).c_str(), &config, &source.encoder) != MA_SUCCESS) return E_FAIL;
    source.encoded = true;
    return S_OK;
}
bool stopRequested() {
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE); DWORD available = 0;
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) return true;
    if (!available) return false;
    char text[64]; DWORD read = 0;
    return ReadFile(input, text, (std::min)(available, DWORD(sizeof(text))), &read, nullptr) && read > 0;
}
bool listDevices(IMMDeviceEnumerator* enumerator) {
    std::string json = "["; bool first = true;
    for (EDataFlow flow : {eRender, eCapture}) {
        IMMDeviceCollection* collection = nullptr;
        if (FAILED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection))) return false;
        IMMDevice* defaultDevice = nullptr; LPWSTR defaultId = nullptr;
        if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &defaultDevice))) defaultDevice->GetId(&defaultId);
        UINT count = 0; collection->GetCount(&count);
        for (UINT i = 0; i < count; ++i) {
            IMMDevice* device = nullptr; IPropertyStore* properties = nullptr; LPWSTR id = nullptr;
            PROPVARIANT name; PropVariantInit(&name);
            if (SUCCEEDED(collection->Item(i, &device)) && SUCCEEDED(device->GetId(&id)) && SUCCEEDED(device->OpenPropertyStore(STGM_READ, &properties)) && SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &name)) && name.vt == VT_LPWSTR) {
                if (!first) json += ','; first = false;
                json += "{\"id\":\"" + escape(utf8(id)) + "\",\"name\":\"" + escape(utf8(name.pwszVal)) + "\",\"source\":\"" + (flow == eRender ? "system" : "microphone") + "\",\"isDefault\":" + (defaultId && std::wcscmp(id, defaultId) == 0 ? "true" : "false") + "}";
            }
            PropVariantClear(&name); CoTaskMemFree(id); release(properties); release(device);
        }
        CoTaskMemFree(defaultId); release(defaultDevice); release(collection);
    }
    emit(json + "]"); return true;
}
}

int wmain(int argc, wchar_t** wideArgv) {
    std::vector<std::string> arguments;
    for (int i = 0; i < argc; ++i) arguments.push_back(utf8(wideArgv[i]));
    std::vector<const char*> argv;
    for (auto& argument : arguments) argv.push_back(argument.c_str());
    std::string output, microphoneOutput, systemId, microphoneId; bool list = false, system = true;
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--list-devices") list = true;
        else if (arg == "--system-off") system = false;
        else if (i + 1 < argc && arg == "--output") output = argv[++i];
        else if (i + 1 < argc && arg == "--microphone-output") microphoneOutput = argv[++i];
        else if (i + 1 < argc && arg == "--device-id") systemId = argv[++i];
        else if (i + 1 < argc && arg == "--microphone-device-id") microphoneId = argv[++i];
        else if (i + 1 < argc && (arg == "--sample-rate" || arg == "--channels" || arg == "--bit-depth")) {
            std::string expected = arg == "--sample-rate" ? "16000" : arg == "--channels" ? "1" : "16";
            if (argv[++i] != expected) { error("Unsupported output format."); return 1; }
        } else { error("Invalid capture arguments."); return 1; }
    }
    if (!list && (output.empty() || (!system && microphoneOutput.empty()))) { error("No recording source selected."); return 1; }
    HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(result)) { error("Audio initialization failed."); return 1; }
    IMMDeviceEnumerator* enumerator = nullptr;
    result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (FAILED(result)) { CoUninitialize(); error("Audio device enumeration failed."); return 1; }
    if (list) { bool ok = listDevices(enumerator); release(enumerator); CoUninitialize(); return ok ? 0 : 1; }
    std::vector<std::unique_ptr<Source>> sources;
    auto add = [&](std::string kind, std::string path, std::string id) { auto source = std::make_unique<Source>(); source->kind = kind; source->path = path; source->id = id; sources.push_back(std::move(source)); };
    if (system) add("system", output, systemId);
    if (!microphoneOutput.empty()) add("microphone", microphoneOutput, microphoneId);
    auto abortStart = [&]() { sources.clear(); release(enumerator); CoUninitialize(); return 1; };
    for (auto& source : sources) {
        result = initialize(*source, enumerator);
        if (FAILED(result)) { error("Could not initialize " + source->kind + " (" + std::to_string(result) + ")."); return abortStart(); }
    }
    const uint64_t epoch = qpcTime();
    for (auto& source : sources) {
        result = source->client->Start();
        if (FAILED(result)) { error("Could not start " + source->kind + " (" + std::to_string(result) + ")."); return abortStart(); }
        source->started = true;
    }
    emit("{\"type\":\"ready\"}");
    uint64_t lastProgress = epoch;
    auto fail = [&](Source& source, HRESULT reason) {
        source.failed = true;
        std::fprintf(stderr, "Capture failure for %s: %ld\n", source.kind.c_str(), static_cast<long>(reason));
        flushPacket(source, nominalEnd(source), epoch);
        source.client->Stop(); source.started = false;
        emit("{\"type\":\"source-error\",\"source\":\"" + source.kind + "\",\"message\":\"Recording source became unavailable.\"}");
    };
    while (!stopRequested()) {
        bool active = false;
        for (auto& source : sources) {
            if (source->failed) continue;
            DWORD state = 0;
            result = source->device->GetState(&state);
            if (SUCCEEDED(result) && state != DEVICE_STATE_ACTIVE) result = AUDCLNT_E_DEVICE_INVALIDATED;
            if (SUCCEEDED(result)) result = readPackets(*source, epoch);
            if (FAILED(result)) fail(*source, result); else active = true;
        }
        const uint64_t now = qpcTime();
        if (now - lastProgress > 2500000) {
            lastProgress = now;
            emit("{\"type\":\"progress\",\"durationMs\":" + std::to_string((now - epoch) / 10000) + "}");
            for (auto& source : sources) {
                // Loopback may produce no packets while the system is silent.
                if (now > nominalEnd(*source) + 2500000) { source->rms = 0; source->peak = 0; }
                emit("{\"type\":\"level\",\"source\":\"" + source->kind + "\",\"rms\":" + std::to_string(source->rms) + ",\"peak\":" + std::to_string(source->peak) + ",\"clipped\":" + (source->peak >= 1 ? "true" : "false") + "}");
            }
        }
        if (!active) break;
        Sleep(5);
    }
    const uint64_t end = qpcTime();
    bool finalized = true;
    for (auto& source : sources) {
        if (source->started) {
            result = readPackets(*source, epoch);
            if (FAILED(result)) fail(*source, result);
            source->client->Stop(); source->started = false;
        }
        if (!flushPacket(*source, (std::min)(nominalEnd(*source), end), epoch) || !pad(*source, timelineFrame(end, epoch, sampleRate))) finalized = false;
    }
    sources.clear(); release(enumerator); CoUninitialize();
    if (!finalized) { error("Could not finalize recording audio.", true); return 1; }
    emit("{\"type\":\"finished\",\"durationMs\":" + std::to_string((end - epoch) / 10000) + "}");
    return 0;
}
