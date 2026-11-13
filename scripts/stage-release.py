"""Stage verified CI artifacts as distinct user downloads with SHA-256 checksums."""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlparse
from speaker_assets import checked, digest

ROOT = Path(__file__).resolve().parent.parent


def single_file(directory, pattern):
    files = list(directory.rglob(pattern))
    if len(files) != 1 or not files[0].is_file():
        raise ValueError(f'Expected exactly one {pattern} in {directory}')
    return files[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifacts', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    prefix = f'https://github.com/Axepuff/finelistener/releases/download/v{version}/'
    assets = []
    for variant in ['win-x64-cpu', 'win-x64-gpu', 'mac-arm64']:
        application = args.artifacts / f'finelistener-{variant}'
        installer = 'exe' if variant.startswith('win-') else 'dmg'
        for extension in [installer, 'zip']:
            source = single_file(application, f'*.{extension}')
            suffix = '-setup' if extension == 'exe' else ''
            assets.append((source, f'FineListener-{version}-{variant}{suffix}.{extension}'))

        component = single_file(args.artifacts / f'nemotron-{variant}', '*-component.json')
        manifest = json.loads(component.read_text())
        archive_name = Path(urlparse(manifest['url']).path).name
        if manifest['variant'] != variant or manifest['url'] != prefix + archive_name:
            raise ValueError(f'Component does not belong to this release: {component}')
        archive = component.parent / archive_name
        checked(archive, manifest)
        # Embedded manifests use these exact names for first-use downloads.
        assets.extend([(archive, archive.name), (component, component.name)])

    assets.append((ROOT / 'INSTALL.md', 'INSTALL.md'))
    names = [name for _, name in assets]
    if len(names) != len(set(names)):
        raise ValueError('Release asset names must be unique')
    for source, _ in assets:
        if not 0 < source.stat().st_size < 2 * 1024 ** 3:
            raise ValueError(f'Release asset must be nonempty and smaller than 2 GiB: {source}')

    # A new directory prevents stale or unrelated files from being published on reruns.
    args.output.mkdir(parents=True, exist_ok=False)
    for source, name in assets:
        shutil.copyfile(source, args.output / name)
    checksums = ''.join(f'{digest(args.output / name)}  {name}\n' for name in sorted(names))
    (args.output / 'SHA256SUMS.txt').write_text(checksums, encoding='utf-8', newline='\n')
    print(json.dumps({'version': version, 'assets': sorted(names + ['SHA256SUMS.txt'])}))


if __name__ == '__main__':
    main()
