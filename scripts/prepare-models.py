"""Acquire the bundled Whisper/VAD models with pinned hashes for clean builds."""
from pathlib import Path
import shutil
from speaker_assets import acquire

ROOT = Path(__file__).resolve().parent.parent
MODELS = [
    {'name': 'ggml-base.bin', 'bytes': 147951465,
     'sha256': '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
     'url': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'},
    {'name': 'ggml-silero-v5.1.2.bin', 'bytes': 885098,
     'sha256': '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
     'url': 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin'},
]


def main():
    destination = ROOT / 'build-assets/models'
    destination.mkdir(parents=True, exist_ok=True)
    for entry in MODELS:
        source = acquire(entry, ROOT / 'models')
        shutil.copyfile(source, destination / entry['name'])
        print('Prepared ' + entry['name'])


if __name__ == '__main__':
    main()
