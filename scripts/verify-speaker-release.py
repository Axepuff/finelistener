"""Verify pinned Nemotron release archives before upload."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
import zipfile
from speaker_assets import digest

ROOT = Path(__file__).resolve().parent.parent


def verify(manifest_file, directory, tag):
    manifest = json.loads(manifest_file.read_text())
    expected = 'v' + json.loads((ROOT / 'package.json').read_text())['version']
    if tag and tag != expected:
        raise ValueError('Release tag differs from the application version')
    lock = json.loads((ROOT / 'scripts/nemotron-assets.json').read_text())
    runtime = lock['runtimes'][manifest['variant']]
    name = f"finelistener-{lock['version']}-{manifest['variant']}.zip"
    url = f'https://github.com/Axepuff/finelistener/releases/download/{expected}/{name}'
    executable = 'bin/nemo-speech' + ('.exe' if manifest['variant'].startswith('win-') else '')
    if (manifest['version'] != lock['version'] or manifest['url'] != url
            or manifest['executable'] != executable or executable not in manifest['files']
            or manifest['model'] != 'model/' + lock['model']['name']
            or manifest['modelRevision'] != lock['model']['revision']
            or manifest['runtimeRevision'] != runtime['revision']
            or manifest['runtimeSha256'] != runtime['sha256']
            or manifest['files'][manifest['model']] != {key: lock['model'][key] for key in ['bytes', 'sha256']}
            or any(manifest['files'].get('notices/' + name) != entry for name, entry in lock['notices'].items())):
        raise ValueError('Component differs from the pinned application')
    if not manifest['files'] or any(name.startswith('/') or ':' in name or '\\' in name
                                    or any(part in ('..', '') for part in name.split('/')) for name in manifest['files']):
        raise ValueError('Unsafe file manifest')
    archive = directory / Path(urlparse(manifest['url']).path).name
    if archive.stat().st_size != manifest['bytes'] or digest(archive) != manifest['sha256']:
        raise ValueError('Archive integrity mismatch')
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        if len(names) != len(manifest['files']) or set(names) != set(manifest['files']):
            raise ValueError('Archive files differ from manifest')
        for info in package.infolist():
            mode = info.external_attr >> 16
            if mode & 0o170000 != 0o100000 or info.file_size != manifest['files'][info.filename]['bytes']:
                raise ValueError('Archive entry type/size mismatch')
            if info.filename == executable and manifest['variant'] == 'mac-arm64' and not mode & 0o111:
                raise ValueError('The macOS CLI must be executable')
            with package.open(info) as stream:
                result = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    result.update(block)
            if result.hexdigest() != manifest['files'][info.filename]['sha256']:
                raise ValueError('Archive entry hash mismatch')
    print(json.dumps({'variant': manifest['variant'], 'verifiedBytes': manifest['bytes']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path, nargs='?')
    parser.add_argument('--all', type=Path)
    parser.add_argument('--release-tag')
    args = parser.parse_args()
    if args.all:
        manifests = list(args.all.rglob('*-component.json'))
        if len(manifests) != 3 or {json.loads(f.read_text())['variant'] for f in manifests} != {'win-x64-cpu', 'win-x64-gpu', 'mac-arm64'}:
            raise ValueError('All three release variants are required')
        for file in manifests:
            verify(file, file.parent, args.release_tag)
    else:
        verify(args.manifest, ROOT / 'build-assets/release-components', args.release_tag)


if __name__ == '__main__':
    main()
