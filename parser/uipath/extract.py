"""Safe extraction of untrusted UiPath packages.

Treats every uploaded file as hostile input (Rule 5, SECURITY.md):
- validates every archive entry path against traversal / absolute paths
- caps individual entry size and total extracted size
- strips executable bits on extracted files
- never executes, imports, or evals anything from the archive
- extraction happens in an isolated per-upload temp directory the caller
  is responsible for deleting (see `extraction_dir` context manager)
"""
from __future__ import annotations

import contextlib
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024  # 200 MB
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_ENTRY_COUNT = 20_000
ALLOWED_UPLOAD_SUFFIXES = {".nupkg", ".zip", ".xaml", ".json"}

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.\-]+")


class UnsafeArchiveError(ValueError):
    pass


def sanitize_filename(name: str) -> str:
    base = os.path.basename(name)
    base = _SAFE_NAME_RE.sub("_", base)
    return base or "unnamed"


def _validate_member_path(member_name: str, dest_root: Path) -> Path:
    if member_name.startswith("/") or member_name.startswith("\\"):
        raise UnsafeArchiveError(f"Absolute path in archive entry: {member_name!r}")
    # Reject drive letters (Windows-style absolute paths) e.g. C:\...
    if re.match(r"^[A-Za-z]:", member_name):
        raise UnsafeArchiveError(f"Windows drive-letter path in archive entry: {member_name!r}")

    candidate = (dest_root / member_name).resolve()
    dest_resolved = dest_root.resolve()
    if candidate != dest_resolved and dest_resolved not in candidate.parents:
        raise UnsafeArchiveError(f"Path traversal detected in archive entry: {member_name!r}")
    return candidate


@contextlib.contextmanager
def extraction_dir():
    """Isolated temp directory for one upload's extraction lifecycle."""
    d = tempfile.mkdtemp(prefix="morphline_upload_")
    try:
        yield Path(d)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def safe_extract_zip(archive_path: Path, dest_dir: Path) -> list[Path]:
    """Extract a .zip/.nupkg into dest_dir with strict guards.

    Returns the list of extracted file paths. Raises UnsafeArchiveError on
    any suspicious entry rather than silently skipping it, so callers don't
    accidentally analyze a partially-hostile package as if it were clean.
    """
    extracted: list[Path] = []
    total_bytes = 0

    with zipfile.ZipFile(archive_path) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRY_COUNT:
            raise UnsafeArchiveError(f"Archive has too many entries ({len(infos)})")

        for info in infos:
            if info.is_dir():
                continue
            if info.file_size > MAX_SINGLE_FILE_BYTES:
                raise UnsafeArchiveError(f"Entry too large: {info.filename!r} ({info.file_size} bytes)")
            total_bytes += info.file_size
            if total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise UnsafeArchiveError("Archive exceeds total uncompressed size limit")

            dest_path = _validate_member_path(info.filename, dest_dir)
            dest_path.parent.mkdir(parents=True, exist_ok=True)

            with zf.open(info) as src, open(dest_path, "wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)

            # Never preserve executable bits from an untrusted archive.
            os.chmod(dest_path, 0o644)
            extracted.append(dest_path)

    return extracted


def prepare_upload(original_filename: str, data: bytes, dest_dir: Path) -> tuple[str, Path]:
    """Validate a raw upload and materialize it as a single file in dest_dir.

    Returns (source_kind, path_to_content). For archives, the archive is
    extracted; for a bare .xaml/.json file it is written as-is.
    """
    safe_name = sanitize_filename(original_filename)
    suffix = Path(safe_name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_SUFFIXES:
        raise UnsafeArchiveError(f"Unsupported file type: {suffix!r}")
    if len(data) > MAX_TOTAL_UNCOMPRESSED_BYTES:
        raise UnsafeArchiveError("Upload exceeds maximum allowed size")

    if suffix in (".nupkg", ".zip"):
        archive_path = dest_dir / safe_name
        archive_path.write_bytes(data)
        extracted_root = dest_dir / "content"
        extracted_root.mkdir(parents=True, exist_ok=True)
        safe_extract_zip(archive_path, extracted_root)
        archive_path.unlink(missing_ok=True)
        return ("nupkg" if suffix == ".nupkg" else "zip"), extracted_root

    single_path = dest_dir / safe_name
    single_path.write_bytes(data)
    return ("xaml" if suffix == ".xaml" else "project_json"), single_path
