"""Load the bundled Whisper model with a Windows system-only PATH and check server readiness."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runtime', type=Path)
    parser.add_argument('model', type=Path)
    parser.add_argument('--require-no-nvidia-driver', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise ValueError('Run this Windows runtime check on Windows')
    runtime = args.runtime.resolve()
    model = args.model.resolve()
    ctypes.windll.kernel32.SetErrorMode(0x0001 | 0x0002 | 0x8000)
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='finelistener-whisper-') as temporary:
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA') if key in os.environ}
        env.update(PATH=str(Path(env['SystemRoot']) / 'System32'), TEMP=temporary, TMP=temporary)
        nvidia_driver_present = (Path(env['SystemRoot']) / 'System32/nvcuda.dll').exists()
        if args.require_no_nvidia_driver and nvidia_driver_present:
            raise ValueError('This check requires a machine without an NVIDIA driver')
        log_path = Path(temporary) / 'server.log'
        command = [str(runtime / 'whisper-server.exe'), '--model', str(model),
                   '--host', '127.0.0.1', '--port', str(port), '--no-gpu', '--threads', '2']
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with log_path.open('wb') as log:
            process = subprocess.Popen(command, cwd=temporary, env=env, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    code = process.poll()
                    if code is not None:
                        raise RuntimeError(f'Whisper exited before readiness: 0x{code & 0xffffffff:08X}')
                    try:
                        with opener.open(f'http://127.0.0.1:{port}/health', timeout=1) as response:
                            if json.load(response).get('status') == 'ok':
                                print(json.dumps({'systemPathOnly': True, 'cpuModelLoaded': True,
                                                  'nvidiaDriverPresent': nvidia_driver_present}))
                                return
                    except (urllib.error.URLError, TimeoutError):
                        pass  # The native server has not finished loading its model yet.
                    time.sleep(0.1)
                raise TimeoutError('Whisper did not become ready within 60 seconds')
            except Exception:
                log.flush()
                print(log_path.read_text(encoding='utf-8', errors='replace')[-8000:], file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)


if __name__ == '__main__':
    main()
