# finelistener
App that converts audio to txt

## Build miniaudio loopback helper (Windows)
This project uses a small helper binary for capturing system audio on Windows.

```
cmake -S miniaudio-loopback -B miniaudio-loopback/build
cmake --build miniaudio-loopback/build --config Release
```

The binary is written to `miniaudio-loopback/bin/`.
