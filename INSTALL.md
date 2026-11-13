# Install FineListener beta

Download builds only from [FineListener Releases](https://github.com/Axepuff/finelistener/releases). The first public beta is **1.4.0-beta.1**.

## Choose a download

| Computer | Recommended download |
| --- | --- |
| Windows x64, no compatible GPU or unsure | `FineListener-1.4.0-beta.1-win-x64-cpu-setup.exe` |
| Windows x64 with a compatible GPU and current graphics drivers | `FineListener-1.4.0-beta.1-win-x64-gpu-setup.exe` |
| Mac with Apple Silicon (M1 or later) | `FineListener-1.4.0-beta.1-mac-arm64.dmg` |

Windows requires Windows 10 version 1903 or later. The Mac beta targets macOS 15 or later on Apple Silicon; no Intel Mac, Windows ARM or Linux build is provided. ZIP archives are also available for manual extraction.

Both Windows builds can analyze speakers on CPU. The GPU build additionally supports Vulkan speaker analysis and CUDA/Vulkan transcription. The Mac build supports Metal and CPU. You do not need Node.js, Python, a CUDA Toolkit or a Hugging Face account to use the app.

## Windows

1. Run the downloaded `-setup.exe` and start FineListener.
2. This beta is not signed with a trusted publisher certificate. If SmartScreen shows **Windows protected your PC**, verify that the file came from the official release, then choose **More info → Run anyway** if available. Organization policies or Smart App Control may prevent an override; do not disable system-wide protection to install the beta.
3. Allow microphone access when prompted if you want to record a microphone.

For a ZIP build, extract the entire archive before running `Finelistener.exe`. Keep the files together.

## macOS

1. Open the `.dmg` and drag **Finelistener.app** into **Applications**. Eject the disk image, then launch the app from Applications.
2. This beta uses an ad-hoc signature and is not notarized by Apple. If macOS blocks it because the developer cannot be verified, open **System Settings → Privacy & Security → Open Anyway** after attempting to launch it, then confirm **Open**. See [Apple's instructions](https://support.apple.com/en-sg/guide/mac-help/mchleab3a043/mac).
3. Allow microphone and system-audio recording permissions when requested for the sources you want to record. Restart the app if macOS requests it.

If the verified official build remains blocked by download quarantine, you can remove that attribute from this app in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Finelistener.app"
```

This changes the quarantine attribute only for that app and its contents. It does not repair a corrupted download or an invalid signature. If macOS reports malware, do not bypass that warning. See the [Apple `xattr` manual](https://github.com/apple-oss-distributions/file_cmds/blob/main/xattr/xattr.1).

## First transcription

Import an audio file or make a recording, then select **Transcribe**. A basic Whisper transcription model is bundled. Audio and transcripts are processed and stored locally.

The first speaker analysis downloads a verified Nemotron component from the same GitHub release: approximately 110 MB for Windows CPU, 124 MB for Windows GPU or 117 MB for Mac. The app shows preparation progress and supports cancellation. Do not manually unpack the `finelistener-nemotron-*.zip` release assets. Once the component is installed, it can be reused offline. Microphone-only recordings do not need this download.

On Apple Silicon, the first GPU capability check can take about a minute while Metal shaders are compiled. If GPU analysis fails, select **CPU** in **Speaker analysis device** and retry; saved transcription remains available.

## Verify a download

Compare the result with the matching filename in `SHA256SUMS.txt` from the release.

Windows PowerShell:

```powershell
Get-FileHash .\FineListener-1.4.0-beta.1-win-x64-cpu-setup.exe -Algorithm SHA256
```

macOS Terminal:

```bash
shasum -a 256 ~/Downloads/FineListener-1.4.0-beta.1-mac-arm64.dmg
```

## Updates and feedback

This beta does not install updates automatically. Download and install a newer release when available. Keep a backup of important recordings before testing beta versions.

Report problems in [GitHub Issues](https://github.com/Axepuff/finelistener/issues), including the app version, operating system, CPU/GPU build and steps to reproduce. Do not attach private recordings or transcripts unless you intend to share them publicly.
