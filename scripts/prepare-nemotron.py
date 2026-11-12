"""Prepare the pinned Windows Vulkan CLI, Q8 model and notices; no Python runtime is shipped."""
import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import zipfile
from speaker_assets import acquire, checked, digest

ROOT = Path(__file__).resolve().parent.parent


def enable_utf8_paths(executable):
    # v0.3.0 uses narrow argv/file APIs. Its asInvoker manifest otherwise keeps the system ANSI code page.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.BeginUpdateResourceW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL]
    kernel.BeginUpdateResourceW.restype = wintypes.HANDLE
    kernel.UpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                      wintypes.WORD, ctypes.c_void_p, wintypes.DWORD]
    kernel.UpdateResourceW.restype = wintypes.BOOL
    kernel.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    kernel.EndUpdateResourceW.restype = wintypes.BOOL
    manifest = (ROOT / 'resources/nemotron/nemo-speech.manifest').read_bytes()
    handle = kernel.BeginUpdateResourceW(str(executable), False)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.UpdateResourceW(handle, ctypes.cast(24, wintypes.LPCWSTR),
                                  ctypes.cast(1, wintypes.LPCWSTR), 1033, manifest, len(manifest)):
        error = ctypes.WinError(ctypes.get_last_error())
        kernel.EndUpdateResourceW(handle, True)
        raise error
    if not kernel.EndUpdateResourceW(handle, False):
        raise ctypes.WinError(ctypes.get_last_error())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / 'build-assets/nemotron-downloads')
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise ValueError('Prepare the Windows Vulkan component on Windows')
    lock = json.loads((ROOT / 'scripts/nemotron-assets.json').read_text())
    runtime = acquire(lock['runtime'], args.cache)
    model = acquire(lock['model'], args.cache)
    stage = ROOT / 'build-assets/nemotron-runtime' / lock['variant']
    if stage.exists():
        raise ValueError(f'Stage already exists; inspect before rebuilding: {stage}')
    stage.mkdir(parents=True)
    with zipfile.ZipFile(runtime) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            name = entry.filename.removeprefix(lock['runtime']['prefix'])
            if not (name.startswith('bin/') or name.startswith('share/licenses/')):
                continue
            parts = PurePosixPath(name).parts
            if name.startswith('/') or '\\' in name or ':' in name or '..' in parts or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe runtime archive entry')
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open('wb') as destination:
                shutil.copyfileobj(source, destination)
    enable_utf8_paths(stage / 'bin/nemo-speech.exe')
    (stage / 'model').mkdir()
    shutil.copyfile(model, stage / 'model' / lock['model']['name'])
    (stage / 'notices').mkdir()
    for name, entry in lock['notices'].items():
        source = ROOT / 'resources/nemotron/notices' / name
        checked(source, entry)
        shutil.copyfile(source, stage / 'notices' / name)
    shutil.copyfile(ROOT / 'scripts/nemotron-assets.json', stage / 'notices/build-lock.json')
    shutil.copyfile(ROOT / 'resources/nemotron/nemo-speech.manifest', stage / 'notices/nemo-speech.manifest')
    (stage / 'notices/runtime-modification.txt').write_text(
        'FineListener modifies only the embedded application manifest of nemo-speech.exe to enable UTF-8 paths.\n'
        'The upstream NeMo-Speech.cpp 0.3.0 executable code and DLLs are unchanged.\n', encoding='utf-8')
    for name in ['bin/nemo-speech.exe', 'bin/ggml-vulkan.dll', 'share/licenses/nemo-speech/LICENSE',
                 'share/licenses/nemo-speech/NOTICE', 'share/licenses/nemo-speech/THIRD_PARTY_NOTICES.md']:
        if not (stage / name).is_file():
            raise ValueError(f'Missing native runtime resource: {name}')
    files = {p.relative_to(stage).as_posix(): {'bytes': p.stat().st_size, 'sha256': digest(p)}
             for p in sorted(stage.rglob('*')) if p.is_file()}
    output = ROOT / 'build-assets/release-components'
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / f"finelistener-{lock['version']}-{lock['variant']}.zip"
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in files:
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            with (stage / name).open('rb') as source, archive.open(entry, 'w') as target:
                shutil.copyfileobj(source, target)
    app_version = json.loads((ROOT / 'package.json').read_text())['version']
    manifest = {'version': lock['version'], 'variant': lock['variant'],
                'url': f'https://github.com/Axepuff/finelistener/releases/download/v{app_version}/{archive_path.name}',
                'bytes': archive_path.stat().st_size, 'sha256': digest(archive_path), 'files': files,
                'executable': 'bin/nemo-speech.exe', 'model': 'model/' + lock['model']['name'],
                'modelRevision': lock['model']['revision'], 'runtimeRevision': lock['runtime']['revision'],
                'runtimeSha256': lock['runtime']['sha256']}
    destination = ROOT / 'build-assets' / lock['variant'] / 'nemotron'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'component.json').write_text(json.dumps(manifest, indent=2))
    (output / 'win-x64-gpu-nemotron-component.json').write_text(json.dumps(manifest, indent=2))
    shutil.copytree(stage / 'notices', destination / 'notices', dirs_exist_ok=True)
    shutil.copytree(stage / 'share/licenses', destination / 'notices/runtime', dirs_exist_ok=True)
    print(json.dumps({'variant': lock['variant'], 'compressedBytes': manifest['bytes'],
                      'installedBytes': sum(f['bytes'] for f in files.values()), 'externalComponent': True}))


if __name__ == '__main__':
    main()
