"""Check the relocated release runtime with three seconds of synthetic audio; not a benchmark."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import wave

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('variant', choices=['win-x64-cpu', 'win-x64-gpu', 'mac-arm64'])
    parser.add_argument('--cpu-only', action='store_true', help='Explicitly skip GPU qualification on hosts without a usable GPU')
    args = parser.parse_args()
    if (args.variant == 'mac-arm64') != (sys.platform == 'darwin'):
        raise ValueError('Run the smoke check on the target operating system')
    manifest = json.loads((ROOT / f'build-assets/{args.variant}/nemotron/component.json').read_text())
    archive = ROOT / 'build-assets/release-components' / manifest['url'].rsplit('/', 1)[1]
    with tempfile.TemporaryDirectory(prefix='finelistener-Немо-') as temporary:
        work = Path(temporary)
        runtime = work / 'runtime with spaces'
        runtime.mkdir()
        # Use the same native ZIP extractor as the app, including Unix executable permissions.
        tar = str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/tar.exe') if sys.platform == 'win32' else '/usr/bin/tar'
        shutil.copyfile(archive, work / 'component.zip')
        subprocess.run([tar, '-xf', 'component.zip', '-C', runtime.name], cwd=work, check=True, timeout=60)
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'HOME') if key in os.environ}
        env.update(TEMP=temporary, TMP=temporary, OMP_NUM_THREADS='2', OMP_THREAD_LIMIT='2',
                   OPENBLAS_NUM_THREADS='2', MKL_NUM_THREADS='2', GGML_VK_DISABLE_GRAPH_OPTIMIZE='1',
                   PATH=(os.pathsep.join([str(runtime / 'bin'), str(Path(env['SystemRoot']) / 'System32'),
                                         env['SystemRoot'], str(runtime / 'vulkan-loader')])
                         if sys.platform == 'win32' else '/usr/bin:/bin'))
        if sys.platform == 'win32' and args.variant == 'win-x64-gpu':
            print(json.dumps({'variant': args.variant, 'systemVulkanLoaderAvailable':
                              (Path(env['SystemRoot']) / 'System32/vulkan-1.dll').is_file()}), flush=True)
        binary = str(runtime / manifest['executable'])
        # Metal compiles its embedded shaders on the first launch, including during doctor.
        doctor = subprocess.run([binary, '--json', 'doctor'], cwd=work, env=env,
                                capture_output=True, text=True, encoding='utf-8', timeout=180)
        if doctor.returncode not in (0, 1):
            raise RuntimeError(f'Nemotron doctor exited with {doctor.returncode} (0x{doctor.returncode & 0xffffffff:08X}):\n'
                               f'{doctor.stderr}\n{doctor.stdout}')
        status = json.loads(doctor.stdout)
        if status['version'] != '0.3.0' or not any(device['type'] == 'cpu' for device in status['devices']):
            raise ValueError('Pinned CPU runtime is unavailable')
        devices = ['cpu']
        if not args.cpu_only and status['driver_runtime_compatible'] and status['accelerator_available']:
            devices.append('metal' if args.variant == 'mac-arm64' else 'vulkan:0')
        audio = work / 'аудио.wav'
        with wave.open(str(audio), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(1000 * math.sin(index * 2 * math.pi * 440 / 16000))) for index in range(48000)))
        for device in devices:
            output = work / 'result.json'
            command = [binary, 'diarize', str(audio), '--model', str(runtime / manifest['model']),
                       '--device', device, '--preset', 'v3-offline', '--concurrency', '1', '--format', 'json', '--output', str(output)]
            result = subprocess.run(command, cwd=work, env=env, capture_output=True, timeout=60)
            if result.returncode:
                print(result.stderr.decode('utf-8', errors='replace'), flush=True)
                result.check_returncode()
            result = json.loads(output.read_text(encoding='utf-8'))
            if not isinstance(result.get('segments'), list) or any(not (0 <= segment['start'] < segment['end'] <= 3.01) for segment in result['segments']):
                raise ValueError('Invalid diarization result')
            output.unlink()
            print(json.dumps({'variant': args.variant, 'device': device, 'smokePassed': True}))
        if len(devices) == 1 and args.variant != 'win-x64-cpu':
            print('GPU smoke skipped: ' + ('explicit --cpu-only check.' if args.cpu_only else 'this host has no available accelerator.'))


if __name__ == '__main__':
    main()
