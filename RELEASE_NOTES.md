# FineListener 1.6.0-beta.1

FineListener 1.6 adds local summaries, Obsidian export and a redesigned workspace for recording, transcribing and reviewing sessions.

## What's new since 1.5.0-beta.1

- **Summaries.** Generate a **Brief overview** and **Detailed notes** from a saved transcript. Edit the prompt, save it as a preset, and continue eligible stopped runs from the last saved progress. Results stay with the session. Download the 2.50 GB summary model once to use it offline.
- **Obsidian export.** Save a session as a Markdown note in your vault with its available summary and a plain-text transcript, a timestamped transcript, or both. FineListener remembers your export options and lets you save a new copy while preserving the original note and your edits.
- **Redesigned workspace.** Drop in an audio file or record directly from the empty workspace. With audio loaded, the right panel keeps **Audio source** and **Transcribe** at the top. Recording and transcription show progress, and you can skip speaker analysis once the transcript is saved.
- **Offline speaker analysis from first use.** Each installer includes the verified Nemotron model and runtime. FineListener prepares it locally when needed.
- **Faster review.** Long speaker transcripts and large session lists load faster. Waveform selection stays aligned when the player is resized.

## Downloads

| Platform | Installer | ZIP archive |
| --- | --- | --- |
| Windows x64 CPU | [Download installer](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-win-x64-cpu-setup.exe) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-win-x64-cpu.zip) |
| Windows x64 GPU | [Download installer](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-win-x64-gpu-setup.exe) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-win-x64-gpu.zip) |
| macOS Apple Silicon | [Download DMG](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-mac-arm64.dmg) | [Download ZIP](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/FineListener-1.6.0-beta.1-mac-arm64.zip) |

Choose Windows CPU if you are unsure which Windows build to use. The Mac beta targets macOS 15 or later on M1 or newer; Intel Macs are not supported by this release. Windows requires Windows 10 version 1903 or later.

[Installation and first-launch instructions](https://github.com/Axepuff/finelistener/blob/v1.6.0-beta.1/INSTALL.md) · [SHA-256 checksums](https://github.com/Axepuff/finelistener/releases/download/v1.6.0-beta.1/SHA256SUMS.txt)

The installer includes the basic Whisper transcription model and Nemotron 3 for speaker analysis. Audio processing stays on your computer. No Python installation, CUDA Toolkit or account login is required. Choose the installer or ZIP for your platform from the table above. FineListener manages the separate Nemotron component files automatically.

## First launch

**Windows:** the beta is unsigned and may show SmartScreen's **Windows protected your PC** prompt. For a verified official download, use **More info → Run anyway** if your computer permits it.

**macOS:** drag the app to Applications. The beta has an ad-hoc signature and is not notarized. After a blocked launch, use **System Settings → Privacy & Security → Open Anyway**. The installation guide includes a targeted Terminal fallback for download quarantine.

## Beta limitations

- This is a prerelease. Clean-machine installation, the full packaged macOS UI and broader GPU/driver combinations still need user testing. Build and native-component smoke checks do not replace those checks.
- The first Metal capability check may take about a minute. If GPU speaker analysis fails, choose CPU and retry; the saved transcript remains available.
- Automatic updates are not included. Install newer releases manually.
- Recognition and speaker labels can be inaccurate, especially during overlapping speech. Review important transcripts.
- Summaries can omit details or contain incorrect claims. Check important results against the transcript and recording. Generation can fail; completed detailed notes are saved so the brief can be retried with the same prompt.

[Report a problem](https://github.com/Axepuff/finelistener/issues) with the version, OS, selected build and reproduction steps. Avoid attaching private recordings or transcripts.
