"""Path and ZIP safety primitives: symlink/traversal guards, safe extraction,
memories_history.json loading, and the optional ZIP I/O metrics counters.
"""

import os
import stat
import json
import time
import threading

# 2GB per-member / total-extraction cap. Mirrors MAX_DOWNLOAD_BYTES in
# process_snapchat_memories.py (CDN download size limit) - kept as a
# separate constant here so this module has no dependency on that one.
MAX_NESTED_ZIP_EXTRACT_BYTES = 2 * 1024 * 1024 * 1024
MAX_NESTED_ZIP_ENTRY_BYTES = MAX_NESTED_ZIP_EXTRACT_BYTES
MAX_ZIP_INDEX_MEMBERS = 250_000
MAX_ZIP_INDEX_DECLARED_BYTES = 5 * 1024 * 1024 * 1024 * 1024
MAX_JSON_BYTES = 100 * 1024 * 1024

ZIP_METRICS_ENABLED = str(os.environ.get("DATEBACK_DEBUG_ZIP_METRICS") or os.environ.get("DATEBACK_DEBUG", "")).lower() in ("1", "true", "yes", "on")

zip_metrics_lock = threading.Lock()
zip_metrics = {
    "lock_wait_sec": 0.0,
    "read_sec": 0.0,
    "bytes_read": 0,
    "members": 0
}


def is_symlink(path_value):
    """True when the exact path entry is a symlink."""
    if not path_value:
        return False
    try:
        return os.path.islink(os.path.abspath(path_value))
    except OSError:
        return False


def canonical_dir(path_value):
    """Create/validate directory and return canonical path, rejecting symlink roots."""
    if not path_value or not isinstance(path_value, str):
        raise ValueError("Directory path is required.")
    if "\0" in path_value or "\n" in path_value:
        raise ValueError("Directory path contains invalid characters.")

    abs_path = os.path.abspath(path_value)

    if os.path.lexists(abs_path) and is_symlink(abs_path):
        raise ValueError(f"Symbolic links are not allowed for directory roots: {abs_path}")

    os.makedirs(abs_path, exist_ok=True)
    try:
        st = os.lstat(abs_path)
    except OSError as e:
        raise ValueError(f"Could not access directory: {abs_path} ({e})")
    if not os.path.isdir(abs_path):
        raise ValueError(f"Path is not a directory: {abs_path}")
    if stat.S_ISLNK(st.st_mode):
        raise ValueError(f"Symbolic links are not allowed for directory roots: {abs_path}")
    return os.path.realpath(abs_path)


def safe_join(root_dir, relative_name):
    """Join untrusted ZIP member names safely under root_dir."""
    if relative_name is None:
        raise ValueError("ZIP member name is missing")

    normalized = os.path.normpath(str(relative_name).replace("\\", "/"))
    if os.path.isabs(normalized):
        raise ValueError(f"Illegal absolute ZIP member path: {relative_name}")

    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError(f"Path traversal in ZIP member: {relative_name}")

    root_real = os.path.realpath(root_dir)
    candidate = os.path.join(root_real, *parts) if parts else root_real
    candidate_real = os.path.realpath(candidate)
    if candidate_real != root_real and not candidate_real.startswith(root_real + os.sep):
        raise ValueError(f"Path escapes extraction root: {relative_name}")
    return candidate


def ensure_no_symlink_ancestor(path_value, root_dir, is_dir_target=None):
    """Refuse to write when any existing path component under root is a symlink.

    is_dir_target: when True, path_value itself is treated as the directory
    to validate even if it does not exist yet (needed when this is called
    *before* creating the directory). When None (default), existence is
    auto-detected via os.path.isdir, preserving prior behavior for callers
    that only need to validate an already-existing path.
    """
    root_real = os.path.realpath(root_dir)
    target_abs = os.path.abspath(path_value)
    if is_dir_target is None:
        is_dir_target = os.path.isdir(target_abs)
    target_dir = target_abs if is_dir_target else os.path.dirname(target_abs)

    try:
        rel_dir = os.path.relpath(target_dir, root_real)
    except ValueError as e:
        raise ValueError(f"Path escapes extraction root: {path_value}") from e

    if rel_dir == os.curdir:
        return

    current = root_real
    for part in rel_dir.split(os.sep):
        if not part or part == os.curdir:
            continue
        if part == os.pardir:
            raise ValueError(f"Path escapes extraction root: {path_value}")
        current = os.path.join(current, part)
        if os.path.lexists(current) and os.path.islink(current):
            raise ValueError(f"Refusing to write through symlinked ZIP path: {path_value}")


def safe_delete(path_value, root_dir):
    """
    Delete only when resolved path remains under root_dir.
    Refuses unsafe deletes and never follows symlink targets outside root.
    """
    if not path_value:
        return True

    abs_path = os.path.abspath(path_value)
    root_real = os.path.realpath(root_dir)
    real_path = os.path.realpath(abs_path)

    if real_path != root_real and not real_path.startswith(root_real + os.sep):
        return False

    if not os.path.lexists(abs_path):
        return True

    try:
        st = os.lstat(abs_path)
        if stat.S_ISDIR(st.st_mode):
            return False
        os.unlink(abs_path)
        return True
    except OSError:
        return False


def zipinfo_is_symlink(member_info):
    """True when a ZipInfo entry represents a symlink."""
    unix_mode = member_info.external_attr >> 16
    return stat.S_ISLNK(unix_mode) or ((unix_mode & 0xF000) == 0xA000)


def select_memories_history_json_member(zf):
    """Find the one canonical Snapchat memories_history.json member in an export ZIP."""
    candidates = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        normalized = os.path.normpath(info.filename.replace("\\", "/"))
        parts = normalized.split("/")
        if len(parts) >= 2 and parts[-2] == "json" and parts[-1] == "memories_history.json":
            if zipinfo_is_symlink(info):
                raise ValueError("memories_history.json cannot be a symbolic link")
            candidates.append(info.filename)
    if not candidates:
        raise FileNotFoundError("Could not find 'memories_history.json' inside the ZIP.")
    if len(candidates) > 1:
        raise ValueError("ZIP contains multiple memories_history.json files.")
    return candidates[0]


def read_memories_history_json(zf, member_name):
    """Read memories_history.json from a ZIP with symlink and size bounds."""
    info = zf.getinfo(member_name)
    if info.is_dir():
        raise ValueError("memories_history.json must be a regular file")
    if zipinfo_is_symlink(info):
        raise ValueError("memories_history.json cannot be a symbolic link")
    if info.file_size < 0 or info.file_size > MAX_JSON_BYTES:
        raise ValueError("memories_history.json is too large")
    with zf.open(info) as jf:
        payload = jf.read(MAX_JSON_BYTES + 1)
    if len(payload) > MAX_JSON_BYTES:
        raise ValueError("memories_history.json is too large")
    return json.loads(payload.decode("utf-8"))


def safe_extract(zf, extract_dir):
    """
    Extract ZIP with Zip Slip protection, symlink blocking, and byte caps.
    Avoids extractall() on untrusted member names.
    """
    total_declared = 0
    for member_info in zf.infolist():
        member = member_info.filename
        if zipinfo_is_symlink(member_info):
            print(f"⚠️  SECURITY: Blocked symlink entry in ZIP: {member}", flush=True)
            continue
        if member_info.file_size < 0 or member_info.file_size > MAX_NESTED_ZIP_ENTRY_BYTES:
            raise ValueError(f"ZIP entry exceeds allowed size: {member}")
        total_declared += member_info.file_size
        if total_declared > MAX_NESTED_ZIP_EXTRACT_BYTES:
            raise ValueError("ZIP extraction exceeds allowed total size")

    total_written = 0
    for member_info in zf.infolist():
        member = member_info.filename
        if zipinfo_is_symlink(member_info):
            continue

        target_path = safe_join(extract_dir, member)
        is_dir = member_info.is_dir() or member.endswith("/")
        if is_dir:
            ensure_no_symlink_ancestor(target_path, extract_dir, is_dir_target=True)
            os.makedirs(target_path, exist_ok=True)
            continue

        parent_dir = os.path.dirname(target_path)
        if parent_dir:
            ensure_no_symlink_ancestor(parent_dir, extract_dir, is_dir_target=True)
            os.makedirs(parent_dir, exist_ok=True)

        written_for_member = 0
        open_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            open_flags |= os.O_NOFOLLOW
        with zf.open(member_info, "r") as src:
            fd = os.open(target_path, open_flags, 0o600)
            try:
                dst = os.fdopen(fd, "wb")
            except Exception:
                os.close(fd)
                raise
            with dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
                    chunk_len = len(chunk)
                    written_for_member += chunk_len
                    total_written += chunk_len
                    if written_for_member > MAX_NESTED_ZIP_ENTRY_BYTES:
                        raise ValueError(f"ZIP entry exceeds allowed extracted size: {member}")
                    if total_written > MAX_NESTED_ZIP_EXTRACT_BYTES:
                        raise ValueError("ZIP extraction exceeds allowed total extracted size")


def reset_zip_metrics():
    if not ZIP_METRICS_ENABLED:
        return
    with zip_metrics_lock:
        zip_metrics["lock_wait_sec"] = 0.0
        zip_metrics["read_sec"] = 0.0
        zip_metrics["bytes_read"] = 0
        zip_metrics["members"] = 0


def record_zip_metrics(wait_sec=0.0, read_sec=0.0, bytes_read=0, members=0):
    if not ZIP_METRICS_ENABLED:
        return
    with zip_metrics_lock:
        zip_metrics["lock_wait_sec"] += max(0.0, float(wait_sec))
        zip_metrics["read_sec"] += max(0.0, float(read_sec))
        zip_metrics["bytes_read"] += max(0, int(bytes_read))
        zip_metrics["members"] += max(0, int(members))


def snapshot_zip_metrics():
    with zip_metrics_lock:
        return dict(zip_metrics)


def is_zip_file(file_path, zip_file=None, zip_lock=None):
    """
    Detect if a file is actually a ZIP by reading magic bytes (PK header).
    Works with both filesystem paths and ZIP archive entries.
    Critical for overlay memories which may be marked as 'Image' but are actually ZIPs.
    """
    ZIP_MAGIC = b'PK\x03\x04'  # Standard ZIP magic bytes

    try:
        if zip_file and not os.path.isabs(file_path):
            # Reading from within a ZIP archive
            wait_sec = 0.0
            read_start = None
            lock_acquired = False
            if zip_lock:
                wait_start = time.perf_counter()
                zip_lock.acquire()
                wait_sec = time.perf_counter() - wait_start
                lock_acquired = True
            read_start = time.perf_counter()
            try:
                with zip_file.open(file_path) as f:
                    header = f.read(4)
            finally:
                read_sec = time.perf_counter() - read_start
                if lock_acquired:
                    zip_lock.release()
                record_zip_metrics(wait_sec=wait_sec, read_sec=read_sec, bytes_read=len(header), members=0)
        else:
            # Reading from filesystem
            open_flags = os.O_RDONLY
            if hasattr(os, "O_NOFOLLOW"):
                open_flags |= os.O_NOFOLLOW
            fd = os.open(file_path, open_flags)
            try:
                f = os.fdopen(fd, 'rb')
            except Exception:
                os.close(fd)
                raise
            with f:
                header = f.read(4)

        is_zip = header == ZIP_MAGIC

        # Log only when a .jpg file is actually a ZIP (potential overlay memory)
        if is_zip and file_path.lower().endswith('.jpg'):
            print(f"   [INFO] Processing overlay memory: {os.path.basename(file_path)}", flush=True)

        return is_zip
    except Exception as e:
        # Log exceptions instead of silently returning False
        print(f"   [WARNING] ZIP check failed for {os.path.basename(file_path)}: {e}", flush=True)
        return False


def validate_zip_index_resource_caps(zip_file_obj, source_label):
    """Validate central-directory metadata without reading every member body."""
    total_declared = 0
    member_count = 0
    for info in zip_file_obj.infolist():
        if info.is_dir():
            continue
        if zipinfo_is_symlink(info):
            raise ValueError(f"Blocked symlink ZIP member in {source_label}: {info.filename}")
        declared_size = int(info.file_size or 0)
        if declared_size < 0 or declared_size > MAX_NESTED_ZIP_ENTRY_BYTES:
            raise ValueError(f"ZIP member exceeds allowed size in {source_label}: {info.filename}")
        total_declared += declared_size
        if total_declared > MAX_ZIP_INDEX_DECLARED_BYTES:
            raise ValueError(f"ZIP declared size exceeds allowed total in {source_label}")
        member_count += 1
        if member_count > MAX_ZIP_INDEX_MEMBERS:
            raise ValueError(f"ZIP contains too many members in {source_label}")
