# miniaudio-loopback

Windows helper capturing WASAPI loopback and microphone endpoints into separate
16 kHz mono PCM WAV files. Miniaudio writes the WAV files; WASAPI packet timestamps
provide the common recording timeline.

Build (Windows):

```
cmake -S . -B build
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

The binary is written to `miniaudio-loopback/bin/`.

`--list-devices` enumerates both `system` and `microphone` endpoints. To record,
pass `--output <system.wav>` and optionally `--microphone-output <microphone.wav>`.
`--system-off` enables microphone-only capture. `--device-id` and
`--microphone-device-id` pin endpoints; omitted IDs select the defaults at start.

The helper emits newline-delimited JSON. `ready` is emitted only after every
enabled device has started. Send a line to stdin (or close the pipe) to stop;
do not terminate the process to stop normally, because WAV headers need closing.
`source-error` reports a lost endpoint while the other endpoint continues. All
endpoints lost causes automatic finalization. `finished` is emitted after files
have closed. A failed startup releases all devices and exits unsuccessfully.

Packet QPC timestamps map both tracks to a shared epoch. Leading/trailing silence
and missing intervals retain their positions. Adjacent packet intervals are
resampled to the common clock, so nominal sample-rate mismatch does not accumulate
drift. No packets during quiet loopback are treated as silence, not disconnection.
Synthetic tests cover startup offsets, gaps and one-hour positive/negative drift.
Physical device latency, long acoustic alignment and hot-unplug behavior still
require validation on the target audio hardware.
