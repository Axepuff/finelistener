"""Build a private Python component from pinned archives and wheels, never a venv.

Run on the target platform with Python 3.12 and pip. Model acquisition is a
separate maintainer action subject to Community-1's access conditions.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import zipfile
from speaker_assets import acquire, checked, digest

ROOT = Path(__file__).resolve().parent.parent
VERSION = "community-1-pyannote4-torch28-r1"
PART_SIZE = 1_500_000_000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("variant", choices=["win-x64-cpu", "win-x64-gpu", "mac-arm64"])
    parser.add_argument("--model-dir", type=Path, default=ROOT / "build-assets/community-model")
    parser.add_argument("--wheel-dir", type=Path)
    args = parser.parse_args()
    expected = "darwin" if args.variant == "mac-arm64" else "win32"
    if sys.platform != expected or sys.version_info[:2] != (3, 12):
        raise ValueError("Build on the target platform with Python 3.12")
    lock = json.loads((ROOT / "scripts/community-assets.json").read_text())
    wheels = lock["wheels"].get(args.variant)
    if not wheels:
        raise ValueError(f"Release blocked: no validated wheel lock for {args.variant}")
    stage = ROOT / "build-assets/community-runtime" / args.variant
    if stage.exists():
        raise ValueError(f"Stage already exists; inspect before rebuilding: {stage}")
    python_dir = stage / "python"
    python_dir.mkdir(parents=True)
    runtime = acquire(lock["python"][expected], ROOT / "build-assets/community-downloads")
    if expected == "win32":
        with zipfile.ZipFile(runtime) as archive:
            archive.extractall(python_dir)
        (python_dir / "python312._pth").write_text("python312.zip\n.\nLib/site-packages\nimport site\n")
        executable = "python/python.exe"
        site = python_dir / "Lib/site-packages"
    else:
        with tarfile.open(runtime) as archive:
            archive.extractall(stage, filter="data")
        executable = "python/bin/python3.12"
        site = python_dir / "lib/python3.12/site-packages"
    if not args.model_dir.exists():
        # Only release preparation acquires gated weights; the worker is always offline.
        from huggingface_hub import snapshot_download
        snapshot_download("pyannote/speaker-diarization-community-1", revision=lock["model"]["revision"],
                          local_dir=str(args.model_dir), token=os.environ.get("HF_TOKEN"),
                          allow_patterns=list(lock["model"]["files"]))
    wheel_dir = args.wheel_dir or ROOT / "build-assets/community-wheels" / args.variant
    paths = []
    for entry in wheels:
        file = wheel_dir / entry["name"]
        if file.exists():
            checked(file, entry)
        else:
            file = acquire(entry, wheel_dir)
        paths.append(str(file))
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", "--no-compile",
                    "--target", str(site), *paths], check=True)
    for name, entry in lock["model"]["files"].items():
        source = args.model_dir / name
        checked(source, entry)
        target = stage / "model" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    shutil.copyfile(ROOT / "resources/community/worker.py", stage / "worker.py")
    shutil.copytree(ROOT / "resources/community/notices", stage / "notices")
    shutil.copyfile(ROOT / "scripts/community-assets.json", stage / "notices/build-lock.json")
    os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", PYANNOTE_METRICS_ENABLED="0", DO_NOT_TRACK="1")
    # A bounded smoke check fails the build if private imports cannot resolve.
    subprocess.run([str(stage / executable), "-I", "-c",
                    "import torch, soundfile; from pyannote.audio import Pipeline; print(torch.__version__)"],
                   cwd=stage, check=True, timeout=120)
    files = {p.relative_to(stage).as_posix(): {"bytes": p.stat().st_size, "sha256": digest(p)}
             for p in sorted(stage.rglob("*")) if p.is_file() and p.suffix != ".pyc"}
    output = ROOT / "build-assets/release-components"
    output.mkdir(parents=True, exist_ok=True)
    archive_path = output / f"finelistener-{VERSION}-{args.variant}.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in files:
            archive.write(stage / name, name)
    app_version = json.loads((ROOT / "package.json").read_text())["version"]
    release_url = f"https://github.com/Axepuff/finelistener/releases/download/v{app_version}/"
    manifest = {"version": VERSION, "variant": args.variant, "url": release_url + archive_path.name,
                "bytes": archive_path.stat().st_size, "sha256": digest(archive_path), "files": files,
                "python": executable, "modelRevision": lock["model"]["revision"]}
    if manifest["bytes"] > PART_SIZE:
        parts = []
        with archive_path.open("rb") as source:
            remaining = manifest["bytes"]
            while remaining:
                part = output / f"{archive_path.name}.part{len(parts):02}"
                size = min(PART_SIZE, remaining)
                with part.open("wb") as target:
                    left = size
                    while left:
                        block = source.read(min(left, 1024 * 1024))
                        if not block:
                            raise ValueError("Truncated component archive")
                        target.write(block)
                        left -= len(block)
                parts.append({"url": release_url + part.name, "bytes": size, "sha256": digest(part)})
                remaining -= size
        manifest["parts"] = parts
    destination = ROOT / "build-assets" / args.variant / "community"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "component.json").write_text(json.dumps(manifest, indent=2))
    (output / f"{args.variant}-component.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"variant": args.variant, "compressedBytes": manifest["bytes"],
                      "installedBytes": sum(f["bytes"] for f in files.values()),
                      "externalComponent": True, "parts": len(manifest.get("parts", []))}))


if __name__ == "__main__":
    main()
