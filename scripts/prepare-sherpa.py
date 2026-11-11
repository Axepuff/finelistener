#!/usr/bin/env python3
"""Stage the pinned sherpa diarization CLI and the two float32 models."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / "scripts/sherpa-assets.json").read_text(encoding="utf-8"))
CACHE = ROOT / "build-assets/sherpa-downloads"
CLI = "sherpa-onnx-offline-speaker-diarization"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset(info):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / info["cache"]
    if target.exists() and target.stat().st_size == info["bytes"] and sha256(target) == info["sha256"]:
        return target
    partial = target.with_suffix(target.suffix + ".partial")
    partial.unlink(missing_ok=True)
    with urllib.request.urlopen(info["url"], timeout=90) as response, partial.open("wb") as stream:
        shutil.copyfileobj(response, stream)
    if partial.stat().st_size != info["bytes"] or sha256(partial) != info["sha256"]:
        partial.unlink(missing_ok=True)
        raise ValueError(f"Asset size or SHA256 mismatch: {info['url']}")
    partial.replace(target)
    return target


def extract(archive, suffix, target):
    with tarfile.open(archive, "r:bz2") as source:
        matches = [member for member in source if member.isfile() and member.name.endswith(suffix)]
        if len(matches) != 1:
            raise ValueError(f"Expected one {suffix} in {archive}, found {len(matches)}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.extractfile(matches[0]) as input_stream, target.open("wb") as output:
            shutil.copyfileobj(input_stream, output)


def extract_zip(archive, suffix, target):
    with zipfile.ZipFile(archive) as source:
        matches = [name for name in source.namelist() if name.endswith(suffix) and not name.endswith("/")]
        if len(matches) != 1:
            raise ValueError(f"Expected one {suffix} in {archive}, found {len(matches)}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.open(matches[0]) as input_stream, target.open("wb") as output:
            shutil.copyfileobj(input_stream, output)


def copy_models(stage):
    models = stage / "models"
    models.mkdir(parents=True, exist_ok=True)
    extract(asset(LOCK["models"]["segmentation"]), "/model.onnx", models / "segmentation.onnx")
    extract(asset(LOCK["models"]["segmentation"]), "/LICENSE", stage / "notices/segmentation.MIT.txt")
    shutil.copyfile(asset(LOCK["models"]["embedding"]), models / "embedding.onnx")
    shutil.copyfile(ROOT / "resources/sherpa-notices/Apache-2.0.txt", stage / "notices/Apache-2.0.txt")
    shutil.copyfile(ROOT / "resources/sherpa-notices/PROVENANCE.md", stage / "notices/PROVENANCE.md")


def copy_cpu(stage, variant):
    archive = asset(LOCK["runtime"]["mac-arm64" if variant == "mac-arm64" else "win-x64-cpu"])
    if variant == "mac-arm64":
        extract(archive, f"/bin/{CLI}", stage / f"cpu/bin/{CLI}")
        for library in ("libonnxruntime.dylib", "libsherpa-onnx-c-api.dylib", "libsherpa-onnx-cxx-api.dylib"):
            extract(archive, f"/lib/{library}", stage / "cpu/lib" / library)
        (stage / f"cpu/bin/{CLI}").chmod(0o755)
    else:
        for name in (f"{CLI}.exe", "onnxruntime.dll", "onnxruntime_providers_shared.dll"):
            extract(archive, f"/bin/{name}", stage / "cpu" / name)


def copy_vc_runtime(component):
    info = LOCK["vc143"]
    program_files = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    vswhere = program_files / "Microsoft Visual Studio/Installer/vswhere.exe"
    if not vswhere.is_file():
        raise FileNotFoundError(f"Visual Studio 2022 Build Tools locator is missing: {vswhere}")
    installation = subprocess.check_output([
        str(vswhere), "-latest", "-version", "[17.0,18.0)", "-products", "*", "-property", "installationPath"
    ], text=True).strip()
    if not installation:
        raise FileNotFoundError("Visual Studio 2022 Build Tools installation is required for VC143 runtime staging")
    source = Path(installation) / "VC/Redist/MSVC" / info["version"] / "x64/Microsoft.VC143.CRT"
    for name, expected in info["files"].items():
        file = source / name
        if not file.is_file() or file.stat().st_size != expected["bytes"] or sha256(file) != expected["sha256"]:
            raise ValueError(f"Pinned VC143 runtime file is missing or differs: {file}")
        shutil.copyfile(file, component / name)
    shutil.copyfile(ROOT / "resources/sherpa-notices/VC143.NOTICE.txt", component / "notices/VC143.NOTICE.txt")


def file_manifest(directory):
    return {str(p.relative_to(directory)).replace(os.sep, "/"): {"bytes": p.stat().st_size, "sha256": sha256(p)}
            for p in sorted(directory.rglob("*")) if p.is_file()}


def make_cuda_component(stage):
    archive = asset(LOCK["runtime"]["win-x64-cuda"])
    component = ROOT / "build-assets/sherpa-cuda-component"
    shutil.rmtree(component, ignore_errors=True)
    component.mkdir(parents=True)
    runtime_files = {f"{CLI}.exe", "onnxruntime.dll", "onnxruntime_providers_cuda.dll", "onnxruntime_providers_shared.dll"}
    with tarfile.open(archive, "r:bz2") as source:
        members = [member for member in source if member.isfile() and "/bin/" in member.name]
        for member in members:
            name = Path(member.name).name
            if name in runtime_files:
                target = component / name
                with source.extractfile(member) as input_stream, target.open("wb") as output:
                    shutil.copyfileobj(input_stream, output)
    if any(not (component / name).exists() for name in runtime_files):
        raise ValueError("CUDA archive is missing required diarization runtime files")
    nvidia = LOCK["nvidia"]
    for archive_key, names in (
        ("cuda_cudart", ("cudart64_12.dll",)),
        ("libcublas", ("cublas64_12.dll", "cublasLt64_12.dll")),
    ):
        source = asset(nvidia[archive_key])
        for name in names:
            extract_zip(source, f"/bin/{name}", component / name)
        extract_zip(source, "/LICENSE", component / "notices" / f"{archive_key}.LICENSE.txt")
    cudnn_archive = asset(nvidia["cudnn"])
    with zipfile.ZipFile(cudnn_archive) as source:
        cudnn_files = [name for name in source.namelist() if "/bin/" in name and Path(name).name.startswith("cudnn") and name.endswith(".dll")]
    if not cudnn_files or "cudnn64_9.dll" not in [Path(name).name for name in cudnn_files]:
        raise ValueError("cuDNN archive is missing required DLLs")
    for name in cudnn_files:
        extract_zip(cudnn_archive, f"/bin/{Path(name).name}", component / Path(name).name)
    extract_zip(cudnn_archive, "/LICENSE", component / "notices/cudnn.LICENSE.txt")
    copy_vc_runtime(component)
    files = file_manifest(component)
    package = ROOT / "build-assets/release-components/finelistener-sherpa-cuda-v1.13.8-win-x64.zip"
    package.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name in files:
            output.write(component / name, name)
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    component_info = {
        "version": LOCK["version"],
        "url": f"https://github.com/Axepuff/finelistener/releases/download/v{version}/{package.name}",
        "bytes": package.stat().st_size,
        "sha256": sha256(package),
        "files": files,
    }
    (stage / "cuda-component.json").write_text(json.dumps(component_info, indent=2) + "\n", encoding="utf-8")
    print(f"CUDA component: {package.stat().st_size} compressed bytes; {sum(x['bytes'] for x in files.values())} installed bytes")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("win-x64-cpu", "win-x64-gpu", "mac-arm64"):
        raise SystemExit("Usage: python scripts/prepare-sherpa.py <win-x64-cpu|win-x64-gpu|mac-arm64>")
    variant = sys.argv[1]
    stage = ROOT / "build-assets" / variant / "sherpa"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    copy_models(stage)
    copy_cpu(stage, variant)
    if variant == "win-x64-gpu":
        make_cuda_component(stage)
    manifest = {"version": LOCK["version"], "variant": variant, "files": file_manifest(stage)}
    (stage / "asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{variant}: {sum(x['bytes'] for x in manifest['files'].values())} installed bytes")


if __name__ == "__main__":
    main()
