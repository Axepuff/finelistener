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
                   PATH=str(runtime / 'bin') + os.pathsep + (str(Path(env['SystemRoot']) / 'System32') if sys.platform == 'win32' else '/usr/bin:/bin'))
        binary = str(runtime / manifest['executable'])
        doctor = subprocess.Popen([binary, '--verbose', '--json', 'doctor'], cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        try:
            stdout, stderr = doctor.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            if sys.platform == 'darwin':
                sample = work / 'doctor-sample.txt'
                subprocess.run(['/usr/bin/sample', str(doctor.pid), '1', '1', '-file', str(sample)], timeout=10, check=False)
                if sample.exists():
                    print('[DEBUG-native-ci] ' + sample.read_text(), flush=True)
            doctor.kill()
            stdout, stderr = doctor.communicate()
            print('[DEBUG-native-ci] ' + stderr, flush=True)
            raise
        if doctor.returncode not in (0, 1):
            raise RuntimeError(stderr)
        status = json.loads(stdout)
        if status['version'] != '0.3.0' or not any(device['type'] == 'cpu' for device in status['devices']):
            raise ValueError('Pinned CPU runtime is unavailable')
        devices = ['cpu']
        if status['driver_runtime_compatible'] and status['accelerator_available']:
            devices.append('metal' if args.variant == 'mac-arm64' else 'vulkan:0')
        audio = work / 'аудио.wav'
        with wave.open(str(audio), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(1000 * math.sin(index * 2 * math.pi * 440 / 16000))) for index in range(48000)))
        for device in devices:
            output = work / 'result.json'
            command = [binary, 'diarize', str(audio), '--model', str(runtime / manifest['model']),
                            '--device', device, '--preset', 'v3-offline', '--concurrency', '1', '--format', 'json', '--output', str(output)],
            result = subprocess.run(command[0], cwd=work, env=env, capture_output=True, timeout=60)
            if result.returncode:
                print(result.stderr.decode('utf-8', errors='replace'), flush=True)
                if sys.platform == 'darwin':
                    subprocess.run(['/usr/bin/lldb', '--batch', '-o', 'run', '-o', 'thread backtrace all', '--', *command[0]],
                                   cwd=work, env=env, timeout=120, check=False)
                result.check_returncode()
            result = json.loads(output.read_text(encoding='utf-8'))
            if not isinstance(result.get('segments'), list) or any(not (0 <= segment['start'] < segment['end'] <= 3.01) for segment in result['segments']):
                raise ValueError('Invalid diarization result')
            output.unlink()
            print(json.dumps({'variant': args.variant, 'device': device, 'smokePassed': True}))
        if len(devices) == 1 and args.variant != 'win-x64-cpu':
            print('GPU smoke skipped: this host has no available accelerator.')


if __name__ == '__main__':
    main()
