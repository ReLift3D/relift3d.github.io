"""Resolve media kept locally for rebuilding, without changing website URLs.

Only offline tools use this module. Browser references must resolve directly
inside the active website; assets under tmp/unused are not runtime fallbacks.
"""
from pathlib import Path


ARCHIVE = Path("tmp/unused")


def logical_relative(path: Path, repo: Path) -> str:
    """Return the original repository path for either an active or archived file."""
    archive = repo / ARCHIVE
    root = archive if path.is_relative_to(archive) else repo
    return path.relative_to(root).as_posix()


def resolve_asset(repo: Path, logical_path: str | Path) -> Path:
    """Keep existing archived destinations archived, including forced rebuilds."""
    logical = Path(logical_path)
    if logical.is_absolute() or ".." in logical.parts or logical.is_relative_to(ARCHIVE):
        raise ValueError(f"Expected a canonical repository-relative asset path: {logical_path}")
    active, archived = repo / logical, repo / ARCHIVE / logical
    if active.is_file() and archived.is_file():
        raise ValueError(f"Asset exists both in the website and archive: {logical_path}")
    return archived if archived.is_file() else active


def find_assets(repo: Path, directory: str, pattern: str, *, recursive: bool = False) -> dict[str, Path]:
    """Inventory both locations with canonical keys; reject ambiguous duplicates."""
    files = {}
    for root in (repo / directory, repo / ARCHIVE / directory):
        candidates = root.rglob(pattern) if recursive else root.glob(pattern)
        for path in candidates:
            if not path.is_file():
                continue
            key = logical_relative(path, repo)
            if key in files:
                raise ValueError(f"Asset exists both in the website and archive: {key}")
            files[key] = path
    return files
