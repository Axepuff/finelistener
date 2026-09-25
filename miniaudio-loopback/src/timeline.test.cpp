#include "timeline.h"
#include <cstdio>
#include <cstdlib>

void check(bool condition, const char* message) {
    if (!condition) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}
int main() {
    constexpr uint64_t epoch = 123456789000;
    check(timelineFrame(epoch - 1000, epoch, 16000) == 0, "Pre-start packets must not underflow.");
    check(timelineFrame(epoch + 250000, epoch, 16000) == 400, "Startup offsets must retain leading silence.");
    check(packetEnd(epoch, epoch + 100000, epoch + 200000, false) == epoch + 100000, "Packet gaps must not stretch audio.");
    check(packetEnd(epoch, epoch + 100000, epoch + 150000, false) == epoch + 100000, "Sub-packet gaps must not stretch audio.");
    check(packetEnd(epoch, epoch + 100000, epoch + 100100, true) == epoch + 100000, "Discontinuities must preserve gaps.");
    for (int drift : {-250, 250}) {
        uint64_t previousEnd = 0;
        for (uint64_t packet = 0; packet < 360000; ++packet) {
            const uint64_t start = epoch + packet * (100000 + drift);
            const uint64_t next = start + 100000 + drift;
            const auto interval = timelineInterval(start, packetEnd(start, start + 100000, next, false), epoch, 16000);
            check(interval.first == previousEnd, "Clock drift must not create seams between adjacent packets.");
            previousEnd = interval.second;
        }
        check(previousEnd == timelineFrame(epoch + uint64_t(360000) * (100000 + drift), epoch, 16000), "One-hour capture must follow QPC rather than the nominal device clock.");
    }
    for (unsigned inputRate : {44100, 48000, 96000}) {
        for (double frequency : {1000.0, 12000.0}) {
            std::vector<float> input(inputRate / 10);
            for (size_t i = 0; i < input.size(); ++i) input[i] = static_cast<float>(std::sin(2 * 3.14159265358979323846 * frequency * i / inputRate));
            double squares = 0;
            for (unsigned i = 32; i < 1568; ++i) { const double sample = resampleFrame(input, i, 1600); squares += sample * sample; }
            const double rms = std::sqrt(squares / 1536);
            check(frequency < 8000 ? rms > 0.65 : rms < 0.03, "Resampling must preserve speech and reject above-Nyquist aliases.");
        }
    }
    std::puts("Timeline and resampling tests passed.");
}
