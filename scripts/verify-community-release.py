"""Verify Community and Nemotron release components, including multipart assets, before upload."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def verify(manifest_file, directory, tag):
    manifest = json.loads(manifest_file.read_text())
    expected = 'v' + json.loads((ROOT / 'package.json').read_text())['version']
    if tag and tag != expected:
        raise ValueError('Release tag differs from the application version')
    prefix = 'https://github.com/Axepuff/finelistener/releases/download/' + expected + '/'
    native = manifest['variant'] == 'win-x64-gpu'
    lock = json.loads((ROOT / 'scripts/nemotron-assets.json').read_text()) if native else None
    revision = lock['version'] if native else 'community-1-pyannote4-torch28-r1'
    if manifest['version'] != revision or not manifest['url'].startswith(prefix):
        raise ValueError('Component revision/URL differs from the pinned application')
    if native:
        if (manifest['modelRevision'] != lock['model']['revision']
                or manifest['runtimeRevision'] != lock['runtime']['revision']
                or manifest['runtimeSha256'] != lock['runtime']['sha256']
                or manifest['files'][manifest['model']] != {key: lock['model'][key] for key in ['bytes', 'sha256']}
                or any(manifest['files'].get('notices/' + name) != entry for name, entry in lock['notices'].items())):
            raise ValueError('Nemotron revision, model or notices differ from the build lock')
    if manifest.get('parts'):
        total = 0
        combined = hashlib.sha256()
        for entry in manifest['parts']:
            if not entry['url'].startswith(prefix) or entry['bytes'] >= 2_000_000_000:
                raise ValueError('Invalid multipart release asset')
            part = directory / Path(urlparse(entry['url']).path).name
            if part.stat().st_size != entry['bytes'] or digest(part) != entry['sha256']:
                raise ValueError('Part integrity mismatch')
            with part.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    combined.update(block)
            total += entry['bytes']
        if total != manifest['bytes'] or combined.hexdigest() != manifest['sha256']:
            raise ValueError('Combined component integrity mismatch')
    else:
        archive = directory / Path(urlparse(manifest['url']).path).name
        if archive.stat().st_size != manifest['bytes'] or digest(archive) != manifest['sha256']:
            raise ValueError('Archive integrity mismatch')
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            if len(names) != len(manifest['files']) or set(names) != set(manifest['files']):
                raise ValueError('Archive files differ from manifest')
            for info in package.infolist():
                if info.file_size != manifest['files'][info.filename]['bytes']:
                    raise ValueError('Archive entry size mismatch')
                if native:
                    with package.open(info) as stream:
                        result = hashlib.sha256()
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            result.update(block)
                    if result.hexdigest() != manifest['files'][info.filename]['sha256']:
                        raise ValueError('Archive entry hash mismatch')
    if not manifest['files'] or any(name.startswith('/') or ':' in name or '\\' in name
                                    or '..' in name.split('/') for name in manifest['files']):
        raise ValueError('Unsafe file manifest')
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
