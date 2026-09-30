#!/usr/bin/env python3
"""Verify the CUDA release asset against the manifest embedded in the GPU app."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(component, manifest_path, release_tag=None):
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assets = json.loads((ROOT / "scripts/sherpa-assets.json").read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_tag = "v" + package["version"]
    expected_name = f"finelistener-sherpa-cuda-{assets['version']}-win-x64.zip"
    expected_url = f"https://github.com/Axepuff/finelistener/releases/download/{expected_tag}/{expected_name}"
    if release_tag is not None and release_tag != expected_tag:
        raise ValueError(f"Release tag {release_tag} does not match package version {expected_tag}")
    if component.name != expected_name or manifest.get("version") != assets["version"] or manifest.get("url") != expected_url:
        raise ValueError("CUDA component name, version, or release URL does not match the pinned build")
    if not component.is_file():
        raise FileNotFoundError(f"CUDA component is missing: {component}")
    expected_bytes = manifest.get("bytes")
    expected_hash = manifest.get("sha256")
    if not isinstance(expected_bytes, int) or expected_bytes <= 0 or not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
        raise ValueError("CUDA component manifest has invalid size or SHA-256")
    if expected_bytes >= 2 * 1024**3:
        raise ValueError("CUDA component exceeds GitHub's per-asset release size limit")
    if component.stat().st_size != expected_bytes or sha256(component) != expected_hash:
        raise ValueError("CUDA component size or SHA-256 differs from the GPU app manifest")
    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("CUDA component manifest has no files")
    with zipfile.ZipFile(component) as archive:
        entries = archive.infolist()
        if len(entries) != len(files) or {entry.filename for entry in entries} != set(files):
            raise ValueError("CUDA component ZIP entries differ from the GPU app manifest")
        for entry in entries:
            if entry.is_dir() or entry.file_size != files[entry.filename]["bytes"]:
                raise ValueError(f"CUDA component ZIP entry differs from the GPU app manifest: {entry.filename}")
    print(f"Verified CUDA release asset: {component.name}, {expected_bytes} bytes, SHA-256 {expected_hash}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--release-tag")
    args = parser.parse_args()
    try:
        verify(args.component, args.manifest, args.release_tag)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(f"CUDA release asset verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
