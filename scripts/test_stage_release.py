"""Exercise the release directory consumed by GitHub Releases through its CLI."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'package.json').read_text())['version']


class ReleaseDownloadsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.artifacts = Path(self.temporary.name) / 'artifacts'
        self.output = Path(self.temporary.name) / 'release'
        for variant in ['win-x64-cpu', 'win-x64-gpu', 'mac-arm64']:
            app = self.artifacts / f'finelistener-{variant}' / 'make'
            app.mkdir(parents=True)
            installer = 'exe' if variant.startswith('win-') else 'dmg'
            for extension in [installer, 'zip']:
                (app / f'Finelistener.{extension}').write_bytes(f'{variant}-{extension}'.encode())
            (app / 'RELEASES').write_text('Updater metadata is not a standalone download.')
            (app / 'Finelistener.nupkg').write_bytes(b'Updater package')
            component = self.artifacts / f'nemotron-{variant}'
            component.mkdir()
            archive = component / f'pinned-speakers-{variant}.zip'
            archive.write_bytes(f'component-{variant}'.encode())
            manifest = {'variant': variant,
                        'url': f'https://github.com/Axepuff/finelistener/releases/download/v{VERSION}/{archive.name}',
                        'bytes': archive.stat().st_size,
                        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
            (component / f'{variant}-component.json').write_text(json.dumps(manifest))

    def stage(self):
        return subprocess.run([sys.executable, str(ROOT / 'scripts/stage-release.py'),
                               str(self.artifacts), str(self.output)], capture_output=True, text=True)

    def test_same_named_platform_builds_remain_distinct_and_every_download_is_checksummed(self):
        result = self.stage()
        self.assertEqual(result.returncode, 0, result.stderr)
        for variant in ['win-x64-cpu', 'win-x64-gpu']:
            installer = self.output / f'FineListener-{VERSION}-{variant}-setup.exe'
            self.assertEqual(installer.read_bytes(), f'{variant}-exe'.encode())
        self.assertEqual((self.output / f'FineListener-{VERSION}-mac-arm64.dmg').read_bytes(), b'mac-arm64-dmg')
        entries = [line.split('  ', 1) for line in (self.output / 'SHA256SUMS.txt').read_text().splitlines()]
        self.assertEqual(len(entries), 13)
        self.assertEqual({name for _, name in entries}, {p.name for p in self.output.iterdir()} - {'SHA256SUMS.txt'})
        for expected, name in entries:
            self.assertEqual(hashlib.sha256((self.output / name).read_bytes()).hexdigest(), expected)
        for manifest_file in self.output.glob('*-component.json'):
            manifest = json.loads(manifest_file.read_text())
            self.assertEqual(hashlib.sha256((self.output / manifest['url'].rsplit('/', 1)[1]).read_bytes()).hexdigest(), manifest['sha256'])
        self.assertFalse((self.output / 'RELEASES').exists())
        self.assertEqual(list(self.output.glob('*.nupkg')), [])

    def test_incomplete_or_ambiguous_builds_do_not_create_a_release(self):
        installer = self.artifacts / 'finelistener-win-x64-cpu/make/Finelistener.exe'
        installer.unlink()
        missing = self.stage()
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('Expected exactly one *.exe', missing.stderr)
        self.assertFalse(self.output.exists())
        installer.write_bytes(b'first')
        installer.with_name('duplicate.exe').write_bytes(b'second')
        duplicate = self.stage()
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn('Expected exactly one *.exe', duplicate.stderr)
        self.assertFalse(self.output.exists())

    def test_wrong_release_component_and_corruption_are_rejected(self):
        component = self.artifacts / 'nemotron-mac-arm64/mac-arm64-component.json'
        manifest = json.loads(component.read_text())
        manifest['url'] = manifest['url'].replace(f'/v{VERSION}/', '/v0.0.0/')
        component.write_text(json.dumps(manifest))
        mismatch = self.stage()
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertIn('Component does not belong to this release', mismatch.stderr)
        self.assertFalse(self.output.exists())
        manifest['url'] = manifest['url'].replace('/v0.0.0/', f'/v{VERSION}/')
        component.write_text(json.dumps(manifest))
        (component.parent / 'pinned-speakers-mac-arm64.zip').write_bytes(b'corrupt')
        corrupt = self.stage()
        self.assertNotEqual(corrupt.returncode, 0)
        self.assertIn('Integrity check failed', corrupt.stderr)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
