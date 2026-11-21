"""Stage the pinned llama.cpp completion runtime for the selected FineListener build."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import zipfile

from speaker_assets import acquire

ROOT = Path(__file__).resolve().parent.parent
TAG = 'b12503'
ARCHIVES = {
    'win-x64-cpu': ('win-cpu-x64.zip', 25521102, '64bee9b6fece8e66c665c40290cbb84706af23c670041d024b56a71a39859d77'),
    'win-x64-gpu': ('win-vulkan-x64.zip', 38603975, '6c83027548f989a4d5c9502b31b580dc5e1254998bd49c1d78e85f316900d118'),
    'mac-arm64': ('macos-arm64.tar.gz', 17282183, 'e88d7e91198d0de6ceb3d33711ac01ee0d5b519cd9ba4e81854e3bba84f22214'),
}
LICENSES = [
    {'name': 'llama.cpp-LICENSE.txt', 'url': f'https://raw.githubusercontent.com/ggml-org/llama.cpp/{TAG}/LICENSE',
     'bytes': 1078, 'sha256': '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d'},
    {'name': 'Qwen3-4B-Instruct-2507-LICENSE.txt',
     'url': 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/cdbee75f17c01a7cc42f958dc650907174af0554/LICENSE',
     'bytes': 11343, 'sha256': '832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e'},
]


def prepare(variant):
    suffix, size, sha256 = ARCHIVES[variant]
    name = f'llama-{TAG}-bin-{suffix}'
    cache = ROOT / 'build-assets/summary-downloads'
    archive = acquire({'name': name, 'bytes': size, 'sha256': sha256,
                       'url': f'https://github.com/ggml-org/llama.cpp/releases/download/{TAG}/{name}'}, cache)
    destination = ROOT / 'build-assets' / variant / 'summary'
    destination.mkdir(parents=True, exist_ok=True)
    for license_entry in LICENSES:
        shutil.copyfile(acquire(license_entry, cache), destination / license_entry['name'])

    if variant == 'mac-arm64':
        executable = 'llama-completion'
        # The Mach-O binaries resolve these versioned names relative to the executable.
        libs = ['ggml', 'ggml-base', 'ggml-cpu', 'ggml-blas', 'ggml-metal', 'ggml-rpc', 'llama', 'llama-common']
        with tarfile.open(archive) as tar:
            for name in [executable, 'llama-tokenize', 'libllama-completion-impl.dylib', *(f'lib{lib}.1.dylib' for lib in libs)]:
                # Read through the archive's dylib aliases and ship regular files for Forge.
                with tar.extractfile(f'llama-{TAG}/{name}') as source, (destination / name).open('wb') as target:
                    shutil.copyfileobj(source, target)
                (destination / name).chmod(0o755)
    else:
        executable = 'llama-completion.exe'
        names = [executable, 'llama-tokenize.exe', 'llama-completion-impl.dll', 'llama-common.dll', 'llama.dll', 'ggml.dll',
                 'ggml-base.dll', 'ggml-cpu-x64.dll', 'libomp.dll', 'LICENSE-LLVM-OpenMP']
        if variant == 'win-x64-gpu':
            names.append('ggml-vulkan.dll')
        with zipfile.ZipFile(archive) as archive_zip:
            names.extend(name for name in archive_zip.namelist()
                         if name.startswith('ggml-cpu-') and name.endswith('.dll') and name not in names)
            for name in names:
                with archive_zip.open(name) as source, (destination / name).open('wb') as target:
                    shutil.copyfileobj(source, target)

    if sys.platform == ('darwin' if variant == 'mac-arm64' else 'win32'):
        env = os.environ.copy()
        if sys.platform == 'win32':
            env['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32')
        command = str(destination / executable)
        help_text = subprocess.check_output([command, '--help'], env=env, encoding='utf-8', errors='replace')
        if not all(flag in help_text for flag in ['--no-display-prompt', '--no-conversation', '--file', '--ctx-size']):
            raise ValueError('The summary runtime is missing a required completion option')
        subprocess.run([command, '--version'], env=env, check=True)
    print(f'Prepared llama.cpp {TAG} for {variant}: {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variant', choices=ARCHIVES)
    prepare(parser.parse_args().variant)
