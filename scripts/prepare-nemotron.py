"""Prepare the pinned Nemotron CLI, Q8 model and notices for Windows or Apple Silicon."""
import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
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
    parser.add_argument('variant', choices=['win-x64-cpu', 'win-x64-gpu', 'mac-arm64'])
    parser.add_argument('--cache', type=Path, default=ROOT / 'build-assets/nemotron-downloads')
    args = parser.parse_args()
    if args.variant.startswith('win-') and sys.platform != 'win32':
        raise ValueError('Prepare Windows components on Windows to enable UTF-8 paths')
    lock = json.loads((ROOT / 'scripts/nemotron-assets.json').read_text())
    runtime_entry = lock['runtimes'][args.variant]
    runtime = acquire(runtime_entry, args.cache)
    executable = 'bin/nemo-speech' + ('.exe' if args.variant.startswith('win-') else '')
    model = acquire(lock['model'], args.cache)
    stage = ROOT / 'build-assets/nemotron-runtime' / args.variant
    if stage.exists():
        raise ValueError(f'Stage already exists; inspect before rebuilding: {stage}')
    stage.mkdir(parents=True)
    def target_for(name):
        if not name.startswith(runtime_entry['prefix']):
            raise ValueError('Unexpected runtime archive prefix')
        name = name.removeprefix(runtime_entry['prefix'])
        if not (name.startswith('bin/') or name.startswith('share/licenses/')
                or (name.startswith('lib/') and name.endswith('.dylib'))):
            return None
        if name.startswith('/') or '\\' in name or ':' in name or '..' in PurePosixPath(name).parts:
            raise ValueError('Unsafe runtime archive entry')
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    if zipfile.is_zipfile(runtime):
        with zipfile.ZipFile(runtime) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                target = target_for(entry.filename)
                if target is None:
                    continue
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('Unexpected ZIP symlink')
                with archive.open(entry) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
        enable_utf8_paths(stage / executable)
    else:
        with tarfile.open(runtime) as archive:
            for entry in archive.getmembers():
                if entry.isdir():
                    continue
                target = target_for(entry.name)
                if target is None:
                    continue
                # Ship regular copies of dylib aliases so installation never needs symlink extraction.
                source_entry = entry
                seen = set()
                while source_entry.issym():
                    if source_entry.name in seen or PurePosixPath(source_entry.linkname).name != source_entry.linkname:
                        raise ValueError('Unsafe runtime library alias')
                    seen.add(source_entry.name)
                    source_entry = archive.getmember(str(PurePosixPath(source_entry.name).parent / source_entry.linkname))
                if not source_entry.isfile():
                    raise ValueError('Only runtime files and local library aliases are allowed')
                with archive.extractfile(source_entry) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
                target.chmod(0o755 if entry.name.removeprefix(runtime_entry['prefix']).startswith(('bin/', 'lib/')) else 0o644)
    (stage / 'model').mkdir()
    shutil.copyfile(model, stage / 'model' / lock['model']['name'])
    (stage / 'notices').mkdir()
    for name, entry in lock['notices'].items():
        source = ROOT / 'resources/nemotron/notices' / name
        checked(source, entry)
        shutil.copyfile(source, stage / 'notices' / name)
    shutil.copyfile(ROOT / 'scripts/nemotron-assets.json', stage / 'notices/build-lock.json')
    if args.variant.startswith('win-'):
        shutil.copyfile(ROOT / 'resources/nemotron/nemo-speech.manifest', stage / 'notices/nemo-speech.manifest')
        (stage / 'notices/runtime-modification.txt').write_text(
            'FineListener modifies only the embedded application manifest of nemo-speech.exe to enable UTF-8 paths.\n'
            'The upstream NeMo-Speech.cpp 0.3.0 executable code and DLLs are unchanged.\n', encoding='utf-8')
    for name in [executable, 'share/licenses/nemo-speech/LICENSE',
                 'share/licenses/nemo-speech/NOTICE', 'share/licenses/nemo-speech/THIRD_PARTY_NOTICES.md']:
        if not (stage / name).is_file():
            raise ValueError(f'Missing native runtime resource: {name}')
    files = {p.relative_to(stage).as_posix(): {'bytes': p.stat().st_size, 'sha256': digest(p)}
             for p in sorted(stage.rglob('*')) if p.is_file()}
    output = ROOT / 'build-assets/release-components'
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / f"finelistener-{lock['version']}-{args.variant}.zip"
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in files:
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = (0o100755 if args.variant == 'mac-arm64' and name.startswith(('bin/', 'lib/')) else 0o100644) << 16
            with (stage / name).open('rb') as source, archive.open(entry, 'w') as target:
                shutil.copyfileobj(source, target)
    app_version = json.loads((ROOT / 'package.json').read_text())['version']
    manifest = {'version': lock['version'], 'variant': args.variant,
                'url': f'https://github.com/Axepuff/finelistener/releases/download/v{app_version}/{archive_path.name}',
                'bytes': archive_path.stat().st_size, 'sha256': digest(archive_path), 'files': files,
                'executable': executable, 'model': 'model/' + lock['model']['name'],
                'modelRevision': lock['model']['revision'], 'runtimeRevision': runtime_entry['revision'],
                'runtimeSha256': runtime_entry['sha256']}
    destination = ROOT / 'build-assets' / args.variant / 'nemotron'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'component.json').write_text(json.dumps(manifest, indent=2))
    (output / f'{args.variant}-nemotron-component.json').write_text(json.dumps(manifest, indent=2))
    shutil.copytree(stage / 'notices', destination / 'notices', dirs_exist_ok=True)
    shutil.copytree(stage / 'share/licenses', destination / 'notices/runtime', dirs_exist_ok=True)
    print(json.dumps({'variant': args.variant, 'compressedBytes': manifest['bytes'],
                      'installedBytes': sum(f['bytes'] for f in files.values()), 'externalComponent': True}))


if __name__ == '__main__':
    main()
