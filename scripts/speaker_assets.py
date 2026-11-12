"""Hash-checked acquisition shared by speaker component builds."""
import hashlib
import urllib.request

def digest(file):
    result = hashlib.sha256()
    with file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def checked(file, entry):
    if not file.is_file() or file.stat().st_size != entry["bytes"] or digest(file) != entry["sha256"]:
        raise ValueError(f"Integrity check failed: {file.name}")


def acquire(entry, cache):
    target = cache / entry["name"]
    cache.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix(target.suffix + ".partial")
        urllib.request.urlretrieve(entry["url"], temporary)
        checked(temporary, entry)
        temporary.replace(target)
    checked(target, entry)
    return target
