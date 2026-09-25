#pragma once
#include <cstdint>
#include <utility>
#include <algorithm>
#include <cmath>
#include <vector>

inline uint64_t timelineFrame(uint64_t time, uint64_t epoch, unsigned rate) {
    return time > epoch ? static_cast<uint64_t>((static_cast<long double>(time - epoch) * rate) / 10000000) : 0;
}
inline std::pair<uint64_t, uint64_t> timelineInterval(uint64_t start, uint64_t end, uint64_t epoch, unsigned rate) {
    return {timelineFrame(start, epoch, rate), timelineFrame(end, epoch, rate)};
}
inline uint64_t packetEnd(uint64_t start, uint64_t nominal, uint64_t next, bool discontinuity) {
    const uint64_t tolerance = nominal > start ? (nominal - start) / 100 : 0;
    return !discontinuity && next >= start && next < nominal + tolerance && next + tolerance > nominal ? next : nominal;
}

// Windowed-sinc interpolation rejects frequencies above the output Nyquist
// limit before mapping a hardware packet to its QPC-sized output interval.
inline float resampleFrame(const std::vector<float>& input, uint64_t frame, uint64_t outputFrames) {
    if (input.empty() || outputFrames == 0) return 0;
    constexpr double pi = 3.14159265358979323846;
    constexpr int radius = 32;
    const double ratio = static_cast<double>(input.size()) / outputFrames;
    const double cutoff = 0.94 / (std::max)(1.0, ratio);
    const double position = static_cast<double>(frame) * ratio;
    const int center = static_cast<int>(position);
    double value = 0, weights = 0;
    for (int tap = center - radius + 1; tap <= center + radius; ++tap) {
        const double distance = position - tap;
        if (std::abs(distance) >= radius) continue;
        const double x = pi * distance * cutoff;
        const double sinc = std::abs(x) < 1e-12 ? 1 : std::sin(x) / x;
        const double window = 0.5 + 0.5 * std::cos(pi * distance / radius);
        const double weight = cutoff * sinc * window;
        const size_t index = static_cast<size_t>((std::clamp)(tap, 0, static_cast<int>(input.size()) - 1));
        value += input[index] * weight;
        weights += weight;
    }
    return weights ? static_cast<float>(value / weights) : 0;
}
