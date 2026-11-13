"""Bundle application-local Windows runtimes before packaging native audio helpers."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variant', choices=['win-x64-cpu', 'win-x64-gpu'])
    parser.add_argument('--cuda-license', type=Path, help='License for the installed CUDA version when the toolkit omits EULA.txt')
    args = parser.parse_args()
    base = ROOT / 'build-assets' / args.variant
    whisper = base / 'whisper'
    loopback = base / 'miniaudio-loopback'
    if not (whisper / 'whisper-server.exe').is_file() or not (loopback / 'miniaudio-loopback.exe').is_file():
        raise ValueError('Build Whisper and miniaudio before preparing their Windows runtimes')

    vswhere = Path(os.environ['ProgramFiles(x86)']) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    installation = subprocess.check_output([str(vswhere), '-latest', '-products', '*', '-requires',
                                            'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                                            '-property', 'installationPath'], text=True).strip()
    candidates = list(Path(installation).glob('VC/Redist/MSVC/*/x64/Microsoft.VC*.CRT')) if installation else []
    if not candidates:
        raise ValueError('The Visual C++ x64 redistributable directory is missing')
    crt = max(candidates, key=lambda p: tuple(int(value) for value in re.findall(r'\d+', p.parent.parent.name)))
    libraries = list(crt.glob('*.dll'))
    if not {'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'} <= {p.name.lower() for p in libraries}:
        raise ValueError('The Visual C++ x64 redistributable is incomplete')
    openmp = crt.parent / crt.name.replace('.CRT', '.OpenMP') / 'vcomp140.dll'
    if not openmp.is_file():
        raise ValueError('The Visual C++ OpenMP redistributable is missing')
    libraries.append(openmp)
    for destination in [whisper, loopback]:
        for library in libraries:
            shutil.copyfile(library, destination / library.name)
        (destination / 'Microsoft-runtime-NOTICE.txt').write_text(
            'Microsoft Visual C++ runtime libraries, distributed unmodified alongside this application.\n'
            'Microsoft Corporation. All rights reserved.\n'
            'https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution\n', encoding='utf-8')

    if args.variant == 'win-x64-gpu':
        cuda = Path(os.environ['CUDA_PATH'])
        for name in ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']:
            shutil.copyfile(cuda / 'bin' / name, whisper / name)
        license_file = args.cuda_license or cuda / 'EULA.txt'
        shutil.copyfile(license_file, whisper / f'CUDA-EULA{license_file.suffix}')
    print(f'Prepared application-local runtimes for {args.variant}')


if __name__ == '__main__':
    main()
