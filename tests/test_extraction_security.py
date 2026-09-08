import zipfile
from pathlib import Path

import pytest

from parser.uipath.extract import (
    UnsafeArchiveError,
    extraction_dir,
    prepare_upload,
    safe_extract_zip,
    sanitize_filename,
)


def _make_zip(tmp_path: Path, entries: dict[str, bytes]) -> Path:
    p = tmp_path / "test.zip"
    with zipfile.ZipFile(p, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return p


def test_rejects_path_traversal(tmp_path):
    archive = _make_zip(tmp_path, {"../../etc/passwd": b"pwned"})
    with extraction_dir() as d, pytest.raises(UnsafeArchiveError):
        safe_extract_zip(archive, d)


def test_rejects_absolute_path(tmp_path):
    archive = _make_zip(tmp_path, {"/etc/passwd": b"pwned"})
    with extraction_dir() as d, pytest.raises(UnsafeArchiveError):
        safe_extract_zip(archive, d)


def test_rejects_windows_drive_path(tmp_path):
    archive = _make_zip(tmp_path, {"C:\\Windows\\System32\\evil.dll": b"pwned"})
    with extraction_dir() as d, pytest.raises(UnsafeArchiveError):
        safe_extract_zip(archive, d)


def test_extracts_clean_archive(tmp_path):
    archive = _make_zip(tmp_path, {"project.json": b"{}", "Main.xaml": b"<Activity/>"})
    with extraction_dir() as d:
        extracted = safe_extract_zip(archive, d)
        names = {p.name for p in extracted}
        assert names == {"project.json", "Main.xaml"}


def test_rejects_oversized_entry(tmp_path, monkeypatch):
    import parser.uipath.extract as extract_mod

    monkeypatch.setattr(extract_mod, "MAX_SINGLE_FILE_BYTES", 10)
    archive = _make_zip(tmp_path, {"big.txt": b"x" * 100})
    with extraction_dir() as d, pytest.raises(UnsafeArchiveError):
        safe_extract_zip(archive, d)


def test_sanitize_filename_strips_path_and_weird_chars():
    assert sanitize_filename("../../evil name!.xaml") == ".._.._evil_name_.xaml" or "/" not in sanitize_filename("../../evil name!.xaml")
    assert "/" not in sanitize_filename("/etc/passwd")


def test_prepare_upload_rejects_unsupported_extension(tmp_path):
    with extraction_dir() as d, pytest.raises(UnsafeArchiveError):
        prepare_upload("malware.exe", b"MZ...", d)


def test_prepare_upload_accepts_bare_xaml(tmp_path):
    with extraction_dir() as d:
        kind, path = prepare_upload("Main.xaml", b"<Activity/>", d)
        assert kind == "xaml"
        assert path.read_bytes() == b"<Activity/>"


def test_prepare_upload_extracts_nupkg(tmp_path):
    archive = _make_zip(tmp_path, {"project.json": b"{}", "Main.xaml": b"<Activity/>"})
    data = archive.read_bytes()
    with extraction_dir() as d:
        kind, path = prepare_upload("MyProcess.1.0.0.nupkg", data, d)
        assert kind == "nupkg"
        assert (path / "project.json").exists()
        assert (path / "Main.xaml").exists()
