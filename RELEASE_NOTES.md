# FineListener 1.4.0-beta.2

First public beta of FineListener: local audio recording, transcription and speaker labeling for Windows and Apple Silicon.

## Downloads

| Platform | Installer | ZIP archive |
| --- | --- | --- |
| Windows x64 CPU | [Download installer](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-win-x64-cpu-setup.exe) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-win-x64-cpu.zip) |
| Windows x64 GPU | [Download installer](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-win-x64-gpu-setup.exe) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-win-x64-gpu.zip) |
| macOS Apple Silicon | [Download DMG](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-mac-arm64.dmg) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/FineListener-1.4.0-beta.2-mac-arm64.zip) |

Choose Windows CPU if you are unsure which Windows build to use. The Mac beta targets macOS 15 or later on M1 or newer; Intel Macs are not supported by this release. Windows requires Windows 10 version 1903 or later.

[Installation and first-launch instructions](https://github.com/Axepuff/finelistener/blob/v1.4.0-beta.2/INSTALL.md) · [SHA-256 checksums](https://github.com/Axepuff/finelistener/releases/download/v1.4.0-beta.2/SHA256SUMS.txt)

## Included

- Record microphone and system audio or import an existing recording.
- Transcribe locally with Whisper and label speakers with Nemotron 3. Audio processing stays on your computer.
- Read plain text, timecodes and speaker views; correct speaker assignments and export text.
- Save sessions and reopen their recordings and transcripts, including revealing a session's folder.
- Choose CPU or supported GPU acceleration for speaker analysis. Ambiguous overlapping speech can remain **Unknown speaker**.

The basic transcription model is bundled. Speaker analysis downloads an additional verified component on first use (about 110–124 MB), then reuses it offline. No Python installation, CUDA Toolkit or account login is required. Files named `finelistener-nemotron-*` are app-managed components, not installers.

## First launch

**Windows:** the beta is unsigned and may show SmartScreen's **Windows protected your PC** prompt. For a verified official download, use **More info → Run anyway** if your computer permits it.

**macOS:** drag the app to Applications. The beta has an ad-hoc signature and is not notarized. After a blocked launch, use **System Settings → Privacy & Security → Open Anyway**. The installation guide includes a targeted Terminal fallback for download quarantine.

## Beta limitations

- This is a prerelease. Clean-machine installation, the full packaged macOS UI and broader GPU/driver combinations still need user testing. Build and native-component smoke checks do not replace those checks.
- The first Metal capability check may take about a minute. If GPU speaker analysis fails, choose CPU and retry; the saved transcript remains available.
- Automatic updates are not included. Install newer releases manually.
- Recognition and speaker labels can be inaccurate, especially during overlapping speech. Review important transcripts.

[Report a problem](https://github.com/Axepuff/finelistener/issues) with the version, OS, selected build and reproduction steps. Avoid attaching private recordings or transcripts.
