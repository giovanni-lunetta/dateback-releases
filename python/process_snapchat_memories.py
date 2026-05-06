import json
import os
import sys
import shutil
import zipfile
import subprocess
import requests
from requests.adapters import HTTPAdapter
import secrets  # For secure random temp file names
from datetime import datetime, timezone, timedelta
from PIL import Image
import mimetypes
import time
import threading
import re
import errno
import stat
import concurrent.futures
import signal
import queue
import hashlib
import tempfile
from urllib.parse import urlparse, parse_qs
from collections import deque
from batch_resume_logic import compute_last_completed_batch, resolve_resume_batch_state, scan_existing_batch_root, scan_existing_batch_roots

# Global Abort Flag
ABORT_PROCESSING = threading.Event()

# Graceful Pause Flag - stops new work but lets in-flight complete
PAUSE_REQUESTED = threading.Event()
runtime_disk_full_lock = threading.Lock()
runtime_disk_full_context = None

# Disk Space Thresholds (in GB)
MIN_FREE_GB = 2.0      # Pause processing when free space drops below this
RESUME_FREE_GB = 3.0   # Resume processing when free space exceeds this
POLL_INTERVAL_SEC = 10 # Seconds between disk space checks when paused
SAFETY_BUFFER_GB = 10.0  # Minimum free-space buffer for auto-upload preflight

# Expired Link Detection - abort after N consecutive 403/410 errors
EXPIRED_LINK_THRESHOLD = 5  # Number of consecutive failures before abort
expired_link_counter = 0    # Global counter for consecutive expired link errors
expired_link_lock = threading.Lock()  # Thread-safe counter access

# Download URL Security - prevent SSRF and disk exhaustion
ALLOWED_HOST_SUFFIXES = ("sc-cdn.net", "snapchat.com", "snap-dev.net")  # Snapchat CDNs only
REDIRECT_ALLOWED_HOST_SUFFIXES = ALLOWED_HOST_SUFFIXES + ("cloudfront.net",)
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2GB per file limit
MAX_NESTED_ZIP_EXTRACT_BYTES = MAX_DOWNLOAD_BYTES
MAX_NESTED_ZIP_ENTRY_BYTES = MAX_DOWNLOAD_BYTES
MAX_JSON_BYTES = 100 * 1024 * 1024

# Configuration
JSON_PATH = 'mydata~1766711891202/json/memories_history.json'
DOWNLOADS_DIR = 'Memories'
OUTPUT_DIR = 'Processed_Memories'
TEMP_DIR = 'temp_processing'
CORRUPTED_DIR = 'Corrupted_Memories'
REPORT_FILE = 'detailed_report.json'
RAW_DL_NAME = 'Raw_Downloads' # Default
FFMPEG_PATH = os.environ.get('FFMPEG_PATH', 'ffmpeg')  # Use bundled ffmpeg if available
PROCESSING_ROOT = '.'
AUTO_UPLOAD_ENABLED = False
AUTO_DESTINATION_DIR = None
AUTO_CACHE_GB = 5.0
AUTO_CACHE_LOW_GB = 3.0
AUTO_UPLOAD_MODE = 'copy'
AUTO_STAGING_DIR = None
AUTO_MAX_UPLOAD_RETRIES = 20
UPLOAD_LEDGER_FILE = '.upload_ledger.jsonl'
RESUME_SIGNAL_FILENAME = '.dateback_resume_signal'
STAGED_ID_FULL_HASH_MAX_BYTES = 50 * 1024 * 1024
STAGED_ID_PARTIAL_BYTES = 1024 * 1024
ZIP_SMALL_FILE_THRESHOLD = 20 * 1024 * 1024
ZIP_METRICS_ENABLED = str(os.environ.get("DATEBACK_DEBUG_ZIP_METRICS") or os.environ.get("DATEBACK_DEBUG", "")).lower() in ("1", "true", "yes", "on")
VERIFY_PERF_DEBUG_ENABLED = str(os.environ.get("DATEBACK_DEBUG_VERIFY_PERF") or os.environ.get("DATEBACK_DEBUG", "")).lower() in ("1", "true", "yes", "on")
RETRY_UPLOAD_DEBUG_ENABLED = str(os.environ.get("DATEBACK_DEBUG_RETRY_UPLOAD") or os.environ.get("DATEBACK_DEBUG", "")).lower() in ("1", "true", "yes", "on")
STAGED_MEDIA_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.mp4', '.mov', '.m4v'}
STAGED_TEMP_MARKERS = ('.tmp', '.partial', '.part', '.download', '.crdownload')
STAGED_TEMP_SUFFIXES = STAGED_TEMP_MARKERS

# CURRENT_BATCH_DIR: The active batch folder where files should be written
# This is set dynamically during batch processing to avoid orphaned files
CURRENT_BATCH_DIR = None

filename_lock = threading.Lock()
reserved_output_paths = set()
_session_local = threading.local()
zip_metrics_lock = threading.Lock()
zip_metrics = {
    "lock_wait_sec": 0.0,
    "read_sec": 0.0,
    "bytes_read": 0,
    "members": 0
}


class ExpiredDownloadLinkError(Exception):
    """Raised when Snapchat media download links have expired."""
    pass


class RuntimeDiskFullError(RuntimeError):
    """Raised when processing stops because local disk space was exhausted."""

    def __init__(self, message, details=None):
        super().__init__(message)
        self.details = details or {}


def verify_perf_log(message):
    if VERIFY_PERF_DEBUG_ENABLED:
        print(f"[VERIFY_PERF] {message}", flush=True)


def reset_runtime_disk_full_state():
    global runtime_disk_full_context
    with runtime_disk_full_lock:
        runtime_disk_full_context = None


def get_runtime_disk_full_context():
    with runtime_disk_full_lock:
        if not runtime_disk_full_context:
            return None
        return dict(runtime_disk_full_context)


def is_disk_full_error(error):
    if isinstance(error, OSError) and getattr(error, "errno", None) == errno.ENOSPC:
        return True
    message = str(error or "")
    return "No space left on device" in message or "DISK_FULL" in message or "errno 28" in message


def classify_runtime_disk_full_scope(path_value=None, explicit_scope=None):
    if explicit_scope:
        return explicit_scope
    if isinstance(path_value, str) and path_value:
        try:
            if AUTO_STAGING_DIR and is_path_inside(path_value, AUTO_STAGING_DIR):
                return "staging"
            if AUTO_DESTINATION_DIR and is_path_inside(path_value, AUTO_DESTINATION_DIR):
                return "destination"
            if OUTPUT_DIR and is_path_inside(path_value, OUTPUT_DIR):
                return "output"
            if TEMP_DIR and is_path_inside(path_value, TEMP_DIR):
                return "temporary"
        except Exception:
            pass
    return "processing"


def default_runtime_disk_full_message(scope):
    if scope == "staging":
        return "DateBack stopped because the local staging drive ran out of space."
    if scope == "destination":
        return "DateBack stopped because the selected cloud destination ran out of space."
    return "DateBack stopped because the working drive ran out of space."


def emit_runtime_disk_full(progress_callback=None, *, path_value=None, scope=None, message=None, error=None):
    global runtime_disk_full_context
    resolved_scope = classify_runtime_disk_full_scope(path_value=path_value, explicit_scope=scope)
    payload = {
        "type": "disk_full",
        "scope": resolved_scope,
        "path": path_value,
        "message": message or default_runtime_disk_full_message(resolved_scope)
    }
    if error:
        payload["error"] = str(error)

    should_emit = False
    with runtime_disk_full_lock:
        if runtime_disk_full_context is None:
            runtime_disk_full_context = dict(payload)
            should_emit = True

    ABORT_PROCESSING.set()

    if should_emit and progress_callback:
        try:
            progress_callback(dict(payload))
        except Exception:
            pass

    return get_runtime_disk_full_context() or payload

def get_requests_session():
    session = getattr(_session_local, "session", None)
    if session is None:
        session = requests.Session()
        adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        _session_local.session = session
    return session

# Signal handler for graceful shutdown
def cleanup_and_exit(signum, frame):
    """
    Handle shutdown signals (SIGTERM, SIGINT) gracefully.
    Sets PAUSE_REQUESTED to let in-flight work complete before cleanup.
    """
    # Set PAUSE_REQUESTED - main loop will detect this and print specific status message
    # This is DIFFERENT from ABORT_PROCESSING which tries to cancel immediately
    PAUSE_REQUESTED.set()

    # DO NOT call sys.exit here - let the main loop handle cleanup after futures complete
    # The main loop will:
    # 1. Stop submitting new work
    # 2. Wait for current futures to complete
    # 3. Save manifest with accurate count
    # 4. Clean up temp directory
    # 5. Exit cleanly

# Register signal handlers
signal.signal(signal.SIGTERM, cleanup_and_exit)
signal.signal(signal.SIGINT, cleanup_and_exit)

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
            with open(file_path, 'rb') as f:
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

def hostname_matches_suffix(hostname, suffix):
    if not hostname or not suffix:
        return False
    normalized_host = hostname.rstrip(".").lower()
    normalized_suffix = suffix.rstrip(".").lower()
    return normalized_host == normalized_suffix or normalized_host.endswith("." + normalized_suffix)


def is_allowed_download_url(url, allowed_suffixes=None):
    """
    Security: Validate download URL to prevent SSRF and malicious downloads.
    Only allows HTTPS downloads from verified Snapchat CDNs.
    
    Returns: True if URL is safe to download, False otherwise
    """
    from urllib.parse import urlparse
    
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
        
        # Must be HTTPS only
        if parsed.scheme != "https":
            return False
        
        suffixes = ALLOWED_HOST_SUFFIXES if allowed_suffixes is None else allowed_suffixes
        # Must match allowed Snapchat CDN suffixes
        return any(hostname_matches_suffix(hostname, suffix) for suffix in suffixes)
    except Exception:
        return False


def extract_sid_from_download_url(url):
    """Extract Snapchat SID from media URL query params."""
    try:
        parsed = urlparse(url)
        sid_values = parse_qs(parsed.query).get("sid")
        if sid_values:
            return sid_values[0].upper()
    except Exception:
        pass
    return None


def validate_download_redirect_chain(response):
    """Ensure all redirect hops remain on allowed HTTPS hosts."""
    chain = [r.url for r in getattr(response, "history", [])] + [response.url]
    for url in chain:
        if not is_allowed_download_url(url, REDIRECT_ALLOWED_HOST_SUFFIXES):
            raise ValueError(f"Blocked redirect target: {url}")

def short_display_path(path_value):
    """Shorten absolute paths for UI-facing events/log lines."""
    if not isinstance(path_value, str):
        return path_value
    normalized = os.path.normpath(path_value)
    if not os.path.isabs(normalized):
        return normalized
    parts = [p for p in normalized.split(os.sep) if p]
    if len(parts) <= 2:
        return normalized
    return f"{os.sep}...{os.sep}{parts[-2]}{os.sep}{parts[-1]}"


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
            os.makedirs(target_path, exist_ok=True)
            continue

        parent_dir = os.path.dirname(target_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        written_for_member = 0
        with zf.open(member_info, "r") as src, open(target_path, "wb") as dst:
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


def stream_zip_member_to_temp(zip_file, member_name, zip_lock=None, mem_id=None, suffix_hint=None):
    """
    Copy a ZIP member to temp_processing under a short lock window.
    Returns absolute temp path and bytes written.
    """
    # If this member lives in a companion ZIP, open that ZIP directly (no shared lock needed).
    companion_path = _companion_zip_registry.get(member_name)
    if companion_path:
        # Temporarily remove the registry entry to prevent infinite recursion when the companion ZIP is opened.
        # The entry will be restored after the recursive call completes.
        _companion_zip_registry.pop(member_name, None)
        try:
            with zipfile.ZipFile(companion_path, 'r') as companion_zf:
                return stream_zip_member_to_temp(companion_zf, member_name, zip_lock=None, mem_id=mem_id, suffix_hint=suffix_hint)
        finally:
            # Restore the registry entry in case we need it again
            _companion_zip_registry[member_name] = companion_path

    temp_root = canonicalize_dir_path(TEMP_DIR)
    suffix = suffix_hint or os.path.splitext(member_name)[1] or ".bin"
    prefix = f"zipmem_{mem_id}_" if mem_id else "zipmem_"
    fd, temp_path = tempfile.mkstemp(prefix=prefix, suffix=suffix, dir=temp_root)

    wait_sec = 0.0
    read_sec = 0.0
    total = 0
    lock_acquired = False

    try:
        with os.fdopen(fd, 'wb') as dst:
            if zip_lock:
                wait_start = time.perf_counter()
                zip_lock.acquire()
                wait_sec = time.perf_counter() - wait_start
                lock_acquired = True

            read_start = time.perf_counter()
            try:
                member_info = zip_file.getinfo(member_name)
                if zipinfo_is_symlink(member_info):
                    raise ValueError(f"Blocked symlink ZIP member: {member_name}")
                declared_size = int(member_info.file_size or 0)
                if declared_size < 0 or declared_size > MAX_NESTED_ZIP_ENTRY_BYTES:
                    raise ValueError(f"ZIP member exceeds allowed size: {member_name}")

                if declared_size <= ZIP_SMALL_FILE_THRESHOLD:
                    with zip_file.open(member_name) as src:
                        data = src.read()
                    total = len(data)
                    if total > MAX_NESTED_ZIP_ENTRY_BYTES:
                        raise ValueError(f"ZIP member exceeds allowed extracted size: {member_name}")
                    dst.write(data)
                else:
                    with zip_file.open(member_name) as src:
                        while True:
                            chunk = src.read(1024 * 1024)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > MAX_NESTED_ZIP_ENTRY_BYTES:
                                raise ValueError(f"ZIP member exceeds allowed extracted size: {member_name}")
                            dst.write(chunk)
            finally:
                read_sec = time.perf_counter() - read_start
                if lock_acquired:
                    zip_lock.release()
                    lock_acquired = False
    except Exception:
        safe_delete(temp_path, temp_root)
        raise

    record_zip_metrics(wait_sec=wait_sec, read_sec=read_sec, bytes_read=total, members=1)
    return temp_path, total


def get_dir_size_bytes(dir_path):
    """Recursively calculate directory size in bytes."""
    total = 0
    if not dir_path or not os.path.exists(dir_path):
        return 0
    for root, _, files in os.walk(dir_path):
        for name in files:
            if name.startswith('.'):
                continue
            file_path = os.path.join(root, name)
            try:
                total += os.path.getsize(file_path)
            except OSError:
                pass
    return total


def list_files_recursive(dir_path):
    """Return absolute paths for all non-hidden files in a directory tree."""
    files = []
    if not dir_path or not os.path.exists(dir_path):
        return files
    for root, _, names in os.walk(dir_path):
        for name in names:
            if name.startswith('.'):
                continue
            path = os.path.join(root, name)
            if os.path.isfile(path):
                files.append(os.path.abspath(path))
    return files


def is_staged_media_file(path_value):
    """True when path looks like a staged media output (not hidden/temp/metadata)."""
    if not path_value:
        return False
    base_name = os.path.basename(path_value)
    if not base_name or base_name.startswith('.'):
        return False
    lower_name = base_name.lower()
    if any(marker in lower_name for marker in STAGED_TEMP_MARKERS):
        return False
    ext = os.path.splitext(lower_name)[1]
    return ext in STAGED_MEDIA_EXTENSIONS


def list_staged_media_files(dir_path):
    """Return absolute paths for staged media outputs under expected Batch_* structure."""
    files = []
    if not dir_path or not os.path.exists(dir_path):
        return files

    try:
        batch_dirs = [
            os.path.join(dir_path, name)
            for name in os.listdir(dir_path)
            if name.startswith('Batch_') and os.path.isdir(os.path.join(dir_path, name))
        ]
    except OSError:
        return files

    for batch_dir in batch_dirs:
        for root, dirs, names in os.walk(batch_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for name in names:
                if name.startswith('.'):
                    continue
                path = os.path.join(root, name)
                if not os.path.isfile(path):
                    continue
                if is_staged_media_file(path):
                    files.append(os.path.abspath(path))
    return files


def canonicalize_dir_path(dir_path):
    """Backward-compatible alias for canonical directory validation."""
    return canonical_dir(dir_path)


def is_path_inside(child_path, parent_path):
    child = os.path.realpath(child_path)
    parent = os.path.realpath(parent_path)
    return child == parent or child.startswith(parent + os.sep)


def preflight_writable_dir(dir_path):
    """Verify directory write/delete capability with a temp file probe."""
    probe = os.path.join(dir_path, f".dateback_write_test_{secrets.token_hex(4)}")
    try:
        with open(probe, 'w', encoding='utf-8') as f:
            f.write("ok")
        if not safe_delete(probe, dir_path):
            raise ValueError("Failed to delete write-probe file safely.")
    except Exception as e:
        raise ValueError(f"Directory is not writable: {dir_path} ({e})")


def compute_staged_id(file_path):
    """Stable staged file id for ledger idempotency."""
    size = os.path.getsize(file_path)
    hasher = hashlib.sha256()

    with open(file_path, 'rb') as f:
        if size <= STAGED_ID_FULL_HASH_MAX_BYTES:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                hasher.update(chunk)
        else:
            head = f.read(STAGED_ID_PARTIAL_BYTES)
            hasher.update(head)
            hasher.update(str(size).encode('utf-8'))

    return hasher.hexdigest()


def emit_processing_event(progress_callback, event_type, **fields):
    """Emit typed JSON events through the existing progress channel."""
    if not progress_callback:
        return
    try:
        payload = {"type": event_type}
        for key, value in fields.items():
            if isinstance(value, str):
                key_lower = key.lower()
                if (key_lower.endswith("_path") or key_lower in {"dest_dir", "destination_dir", "staging_dir", "path"}) and os.path.isabs(value):
                    payload[key] = short_display_path(value)
                    continue
            payload[key] = value
        progress_callback(payload)
    except Exception:
        pass


class DestinationAdapter:
    """Abstract destination adapter for automatic upload."""

    def prepare(self):
        raise NotImplementedError

    def put(self, local_path):
        raise NotImplementedError

    def verify(self, local_path, dest_path):
        raise NotImplementedError


class FolderDestinationAdapter(DestinationAdapter):
    """Folder-based destination adapter (Drive/iCloud/Dropbox/etc)."""

    def __init__(self, destination_dir, upload_mode='copy', staging_dir=None):
        self.destination_dir = os.path.abspath(destination_dir)
        self.upload_mode = upload_mode
        self.staging_dir = canonical_dir(staging_dir) if staging_dir else None
        self._expected_sizes = {}

    def prepare(self):
        os.makedirs(self.destination_dir, exist_ok=True)

    def _resolve_destination_parent(self, local_path):
        if self.staging_dir and local_path and is_path_inside(local_path, self.staging_dir):
            canonical_local_path = os.path.realpath(local_path)
            relative_path = os.path.relpath(canonical_local_path, self.staging_dir)
            relative_parent = os.path.dirname(relative_path)
            if relative_parent and relative_parent != '.':
                return os.path.join(self.destination_dir, relative_parent)
        return self.destination_dir

    def _unique_dest_path(self, dest_parent, source_name):
        base, ext = os.path.splitext(source_name)
        candidate = os.path.join(dest_parent, source_name)
        counter = 1
        while os.path.exists(candidate):
            candidate = os.path.join(dest_parent, f"{base}_{counter}{ext}")
            counter += 1
        return candidate

    def put(self, local_path):
        source_name = os.path.basename(local_path)
        src_size = os.path.getsize(local_path)
        dest_parent = self._resolve_destination_parent(local_path)
        os.makedirs(dest_parent, exist_ok=True)
        dest_path = self._unique_dest_path(dest_parent, source_name)
        temp_dest = f"{dest_path}.tmp.{secrets.token_hex(4)}"

        # Keep source file intact until caller verifies destination.
        # This preserves crash safety for both copy and move modes.
        shutil.copy2(local_path, temp_dest)
        os.replace(temp_dest, dest_path)

        self._expected_sizes[dest_path] = src_size
        return dest_path

    def verify(self, local_path, dest_path):
        if not os.path.exists(dest_path):
            return False
        try:
            dest_size = os.path.getsize(dest_path)
            if os.path.exists(local_path):
                local_size = os.path.getsize(local_path)
            else:
                local_size = self._expected_sizes.get(dest_path)
            return local_size is not None and local_size == dest_size
        except OSError:
            return False


class UploadLedger:
    """Append-only upload ledger for crash-safe upload resume."""

    def __init__(self, ledger_path):
        self.ledger_path = ledger_path
        self._lock = threading.Lock()
        self._done_by_staged_path = {}
        self._done_by_staged_id = {}
        os.makedirs(os.path.dirname(self.ledger_path), exist_ok=True)
        if not os.path.exists(self.ledger_path):
            open(self.ledger_path, 'a').close()
        self._load_existing()

    def _load_existing(self):
        try:
            with open(self.ledger_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    self._index_record(record)
        except OSError:
            pass

    def _index_record(self, record):
        if record.get("status") != "DONE":
            return
        staged_path = record.get("staged_path")
        staged_id = record.get("staged_id")
        if staged_path:
            self._done_by_staged_path[os.path.abspath(staged_path)] = record
        if staged_id:
            self._done_by_staged_id.setdefault(staged_id, []).append(record)

    def append(self, staged_path, dest_path, status, size_bytes=0, error=None, staged_id=None):
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "staged_path": os.path.abspath(staged_path) if staged_path else None,
            "dest_path": dest_path,
            "status": status,
            "size_bytes": int(size_bytes or 0)
        }
        if staged_id:
            record["staged_id"] = staged_id
        if error:
            record["error"] = str(error)

        with self._lock:
            with open(self.ledger_path, 'a', encoding='utf-8') as f:
                f.write(json.dumps(record) + "\n")
            self._index_record(record)

    def get_done_record_for_staged_path(self, staged_path):
        return self._done_by_staged_path.get(os.path.abspath(staged_path))

    def get_done_destinations_by_staged_path(self):
        with self._lock:
            return {
                staged_path: record.get("dest_path")
                for staged_path, record in self._done_by_staged_path.items()
                if record.get("dest_path")
            }

    def get_valid_dest_for_staged_id(self, staged_id, size_bytes, staged_path=None):
        if not staged_id:
            return None
        staged_base = os.path.basename(staged_path) if staged_path else None
        candidates = self._done_by_staged_id.get(staged_id, [])
        for record in reversed(candidates):
            if staged_base:
                prior_staged = record.get("staged_path")
                prior_base = os.path.basename(prior_staged) if prior_staged else None
                if prior_base and prior_base != staged_base:
                    continue
            dest_path = record.get("dest_path")
            if not dest_path:
                continue
            try:
                if os.path.exists(dest_path) and os.path.getsize(dest_path) == int(size_bytes):
                    return dest_path
            except OSError:
                continue
        return None


class AutoUploadManager:
    """Single-threaded uploader with retries, verification, and event emission."""

    def __init__(self, staging_dir, adapter, ledger, progress_callback, cache_gb, cache_low_gb, max_upload_retries=20):
        self.staging_dir = canonical_dir(staging_dir)
        self.adapter = adapter
        self.ledger = ledger
        self.progress_callback = progress_callback
        self.cache_bytes = int(cache_gb * 1024**3)
        self.cache_low_bytes = int(cache_low_gb * 1024**3)
        self.max_upload_retries = max(1, int(max_upload_retries))
        self.uploaded_count = 0
        self.error_count = 0
        self.upload_attempts = 0
        self.confirmed_count = 0
        self.copied_count = 0

        self._queue = queue.Queue()
        self._pending = set()
        self._tracked_files = set()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._fatal_error = None
        self._last_progress_emit = 0.0
        self._staged_count = 0
        self._staging_bytes = 0
        self._last_error_emit_attempt = {}

    def prepare(self):
        os.makedirs(self.staging_dir, exist_ok=True)
        self.adapter.prepare()
        # Initialize counters from one staging scan at startup.
        files = [path for path in list_files_recursive(self.staging_dir) if is_staged_media_file(path)]
        with self._lock:
            self._tracked_files = set(files)
            self._staged_count = len(files)
            self._staging_bytes = 0
            for p in files:
                try:
                    self._staging_bytes += os.path.getsize(p)
                except OSError:
                    pass

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="auto-uploader", daemon=True)
        self._thread.start()

    def stop(self, wait=True):
        self._stop_event.set()
        self._queue.put(None)
        if wait and self._thread:
            self._thread.join()

    def pending_count(self):
        with self._lock:
            return len(self._pending)

    def staging_bytes(self):
        with self._lock:
            return self._staging_bytes

    def staged_count(self):
        with self._lock:
            return self._staged_count

    def enqueue(self, staged_path, discovered=False):
        if not staged_path:
            return
        staged_path = os.path.abspath(staged_path)
        if not os.path.exists(staged_path):
            return
        size_bytes = 0
        try:
            size_bytes = os.path.getsize(staged_path)
        except OSError:
            pass
        with self._lock:
            if staged_path in self._pending:
                return
            if staged_path not in self._tracked_files:
                self._tracked_files.add(staged_path)
                self._staged_count += 1
                self._staging_bytes += size_bytes
            self._pending.add(staged_path)
        self._queue.put(staged_path)
        # For newly produced files, emit periodic progress only.
        if not discovered:
            self._emit_progress(last_file=os.path.basename(staged_path))

    def _untrack_file(self, staged_path, known_size=None):
        with self._lock:
            if staged_path in self._tracked_files:
                self._tracked_files.remove(staged_path)
                self._staged_count = max(0, self._staged_count - 1)
                size_to_subtract = 0
                if isinstance(known_size, int) and known_size >= 0:
                    size_to_subtract = known_size
                else:
                    try:
                        size_to_subtract = os.path.getsize(staged_path)
                    except OSError:
                        size_to_subtract = 0
                self._staging_bytes = max(0, self._staging_bytes - size_to_subtract)

    def _remove_pending(self, staged_path):
        with self._lock:
            self._pending.discard(staged_path)

    def recover_pending(self):
        recovered = 0
        for staged_path in list_files_recursive(self.staging_dir):
            if not is_staged_media_file(staged_path):
                continue
            file_size = 0
            try:
                file_size = os.path.getsize(staged_path)
            except OSError:
                pass
            done_record = self.ledger.get_done_record_for_staged_path(staged_path)
            if done_record:
                dest_path = done_record.get("dest_path")
                try:
                    if dest_path and os.path.exists(dest_path) and os.path.getsize(dest_path) == file_size:
                        deleted = self._safe_delete_staged_file(staged_path, known_size=file_size)
                        if deleted:
                            self._untrack_file(staged_path, known_size=file_size)
                        continue
                except OSError:
                    pass
            self.enqueue(staged_path, discovered=True)
            recovered += 1
        return recovered

    def _safe_delete_staged_file(self, staged_path, known_size=None):
        if safe_delete(staged_path, self.staging_dir):
            return True
        self.error_count += 1
        self.emit(
            "upload_error",
            last_file=os.path.basename(staged_path),
            error="Refused unsafe staged-file delete outside staging root",
            attempt=0
        )
        self._untrack_file(staged_path, known_size=known_size)
        self._remove_pending(staged_path)
        return False

    def emit(self, event_type, last_file=None, force=False, **extra):
        if event_type == "upload_progress":
            self._emit_progress(force=force, last_file=last_file, **extra)
            return
        with self._lock:
            staged_count = self._staged_count
            staging_bytes = self._staging_bytes
        payload = {
            "staged_count": staged_count,
            "staging_bytes": staging_bytes,
            "uploaded_count": self.uploaded_count,
            "error_count": self.error_count,
            "dest_dir": self.adapter.destination_dir,
            "last_file": last_file
        }
        payload.update(extra)
        emit_processing_event(self.progress_callback, event_type, **payload)

    def _emit_progress(self, force=False, last_file=None, **extra):
        now = time.time()
        if not force and (now - self._last_progress_emit) < 0.25:
            return
        self._last_progress_emit = now
        with self._lock:
            staged_count = self._staged_count
            staging_bytes = self._staging_bytes
        payload = {
            "staged_count": staged_count,
            "staging_bytes": staging_bytes,
            "uploaded_count": self.uploaded_count,
            "error_count": self.error_count,
            "dest_dir": self.adapter.destination_dir,
            "last_file": last_file
        }
        payload.update(extra)
        emit_processing_event(self.progress_callback, "upload_progress", **payload)

    def wait_for_drain(self):
        while True:
            if self.has_fatal():
                break
            if self.pending_count() == 0 and self._queue.empty():
                break
            time.sleep(0.5)

    def has_fatal(self):
        return self._fatal_error is not None

    def fatal_message(self):
        return self._fatal_error

    def mark_remaining_failed(self, reason):
        for staged_path in list_files_recursive(self.staging_dir):
            size_bytes = 0
            staged_id = None
            try:
                size_bytes = os.path.getsize(staged_path)
                staged_id = compute_staged_id(staged_path)
            except OSError:
                pass
            self.ledger.append(
                staged_path,
                None,
                "FAILED",
                size_bytes=size_bytes,
                error=reason,
                staged_id=staged_id
            )

    def _set_fatal(self, message, last_error=None, last_file=None, emit_event=True):
        if self._fatal_error:
            return
        self._fatal_error = message
        if emit_event:
            self.emit(
                "upload_fatal",
                force=True,
                last_file=last_file,
                message=message,
                last_error=last_error
            )
        self._stop_event.set()
        self._queue.put(None)

    def _run(self):
        while not self._stop_event.is_set():
            try:
                staged_path = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            if staged_path is None:
                continue

            if not os.path.exists(staged_path):
                self._remove_pending(staged_path)
                continue

            if not is_path_inside(staged_path, self.staging_dir):
                self._safe_delete_staged_file(staged_path)
                continue

            size_bytes = 0
            try:
                size_bytes = os.path.getsize(staged_path)
            except OSError:
                pass
            staged_id = None
            try:
                staged_id = compute_staged_id(staged_path)
            except Exception as e:
                self.error_count += 1
                self.emit("upload_error", last_file=os.path.basename(staged_path), error=str(e), attempt=0)
                self._remove_pending(staged_path)
                continue

            existing_dest = self.ledger.get_valid_dest_for_staged_id(staged_id, size_bytes, staged_path=staged_path)
            if existing_dest:
                self.ledger.append(staged_path, existing_dest, "DONE", size_bytes=size_bytes, staged_id=staged_id)
                self.confirmed_count += 1
                deleted = self._safe_delete_staged_file(staged_path, known_size=size_bytes)
                if deleted:
                    self._untrack_file(staged_path, known_size=size_bytes)
                    self.uploaded_count += 1
                    self._emit_progress(last_file=os.path.basename(staged_path))
                    self._remove_pending(staged_path)
                continue

            attempt = 0
            uploaded = False
            while not self._stop_event.is_set():
                attempt += 1
                dest_path = None
                try:
                    self.upload_attempts += 1
                    dest_path = self.adapter.put(staged_path)
                    if not self.adapter.verify(staged_path, dest_path):
                        raise RuntimeError("Verification failed after upload")

                    self.ledger.append(
                        staged_path,
                        dest_path,
                        "DONE",
                        size_bytes=size_bytes,
                        staged_id=staged_id
                    )
                    self.confirmed_count += 1
                    self.copied_count += 1
                    deleted = True
                    if os.path.exists(staged_path):
                        deleted = self._safe_delete_staged_file(staged_path, known_size=size_bytes)

                    if deleted:
                        self.uploaded_count += 1
                        self._untrack_file(staged_path, known_size=size_bytes)
                        self._emit_progress(last_file=os.path.basename(staged_path))
                        uploaded = True
                    break
                except Exception as e:
                    if is_disk_full_error(e):
                        disk_full_details = emit_runtime_disk_full(
                            self.progress_callback,
                            path_value=self.adapter.destination_dir,
                            scope="destination",
                            message="DateBack stopped because the destination drive ran out of space during cloud delivery.",
                            error=e
                        )
                        self._set_fatal(
                            disk_full_details.get("message", "DateBack stopped because the destination drive ran out of space during cloud delivery."),
                            last_error=str(e),
                            last_file=os.path.basename(staged_path),
                            emit_event=False
                        )
                    self.error_count += 1
                    self.ledger.append(
                        staged_path,
                        dest_path,
                        "ERROR",
                        size_bytes=size_bytes,
                        error=str(e),
                        staged_id=staged_id
                    )
                    if is_disk_full_error(e):
                        self.ledger.append(
                            staged_path,
                            dest_path,
                            "FAILED",
                            size_bytes=size_bytes,
                            error=str(e),
                            staged_id=staged_id
                        )
                        break
                    retry_markers = {1, 3, 5, 10, self.max_upload_retries}
                    last_emitted = self._last_error_emit_attempt.get(staged_path, 0)
                    if attempt in retry_markers and attempt > last_emitted:
                        self._last_error_emit_attempt[staged_path] = attempt
                        self.emit(
                            "upload_error",
                            last_file=os.path.basename(staged_path),
                            error=str(e),
                            attempt=attempt
                        )
                    if attempt >= self.max_upload_retries:
                        self.ledger.append(
                            staged_path,
                            dest_path,
                            "FAILED",
                            size_bytes=size_bytes,
                            error=f"Exceeded retry limit ({self.max_upload_retries}): {e}",
                            staged_id=staged_id
                        )
                        self._set_fatal(
                            f"Destination unavailable; giving up after {self.max_upload_retries} retries.",
                            last_error=str(e),
                            last_file=os.path.basename(staged_path)
                        )
                        break
                    sleep_sec = min(60, 2 ** (attempt - 1))
                    time.sleep(sleep_sec)

            self._remove_pending(staged_path)

            # If stopping, keep file in staging for restart recovery.
            if not uploaded and self._stop_event.is_set():
                continue


def reserve_unique_output_path(target_dir, base_name, ext):
    """Reserve a unique output path without creating placeholder files."""
    counter = 0
    with filename_lock:
        while True:
            suffix = "" if counter == 0 else f"_{counter}"
            candidate = os.path.join(target_dir, f"{base_name}{suffix}{ext}")
            if candidate not in reserved_output_paths and not os.path.exists(candidate):
                reserved_output_paths.add(candidate)
                return candidate
            counter += 1


def release_reserved_output_path(path):
    if not path:
        return
    with filename_lock:
        reserved_output_paths.discard(path)


def atomic_copy_file(src_path, dst_path):
    """Copy to temporary file in destination directory, then atomic rename."""
    temp_path = f"{dst_path}.tmp.{secrets.token_hex(4)}"
    try:
        shutil.copy2(src_path, temp_path)
        os.replace(temp_path, dst_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def atomic_write_stream_to_file(write_func, dst_path):
    """Write bytes to temp path through callback and atomically rename."""
    temp_path = f"{dst_path}.tmp.{secrets.token_hex(4)}"
    try:
        write_func(temp_path)
        os.replace(temp_path, dst_path)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def get_with_validated_redirects(session, url, timeout=60, stream=True, max_redirects=5):
    """Fetch a URL with redirects disabled, validating each target before following."""
    current_url = url
    redirect_statuses = (301, 302, 303, 307, 308)
    for _ in range(max_redirects + 1):
        if not is_allowed_download_url(current_url, REDIRECT_ALLOWED_HOST_SUFFIXES):
            raise ValueError(f"Blocked redirect target: {current_url}")
        response = session.get(
            current_url,
            timeout=timeout,
            stream=stream,
            allow_redirects=False,
        )
        if response.status_code not in redirect_statuses:
            return response
        location = response.headers.get("Location")
        if not location:
            close_response = getattr(response, "close", None)
            if close_response:
                close_response()
            raise ValueError("Redirect response missing Location header")
        next_url = requests.compat.urljoin(current_url, location)
        if not is_allowed_download_url(next_url, REDIRECT_ALLOWED_HOST_SUFFIXES):
            close_response = getattr(response, "close", None)
            if close_response:
                close_response()
            raise ValueError(f"Blocked redirect target: {next_url}")
        close_response = getattr(response, "close", None)
        if close_response:
            close_response()
        current_url = next_url
    raise ValueError("Too many redirects while downloading media")


def stream_download_to_path(download_url, temp_path, timeout=60):
    """Stream a Snapchat media download to disk with redirect and size validation."""
    session = get_requests_session()
    with get_with_validated_redirects(session, download_url, timeout=timeout, stream=True) as response:
        if response.status_code in (403, 410):
            raise ExpiredDownloadLinkError(f"Download link expired (HTTP {response.status_code})")

        response.raise_for_status()

        downloaded_bytes = 0
        content_type = (response.headers.get('Content-Type') or '').lower()
        with open(temp_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                downloaded_bytes += len(chunk)
                if downloaded_bytes > MAX_DOWNLOAD_BYTES:
                    raise ValueError(f"Download exceeded max size limit: {MAX_DOWNLOAD_BYTES / (1024**3):.2f}GB")
                f.write(chunk)

        if downloaded_bytes <= 0:
            raise ValueError("Downloaded file is empty")
        if 'text/html' in content_type:
            raise ValueError(f"Unexpected content type for media download: {content_type}")

        return downloaded_bytes


def atomic_write_text(path_value, content):
    """Atomically write text content to a file in the same directory."""
    temp_path = f"{path_value}.tmp.{secrets.token_hex(4)}"
    try:
        with open(temp_path, 'w', encoding='utf-8') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, path_value)
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def get_batch_progress_file():
    """Get the path to the batch progress tracking file.
    Stored in PARENT directory so it persists even if user deletes Processed_Memories folder after cloud upload.
    """
    return os.path.join(os.path.dirname(OUTPUT_DIR), ".batch_progress.json")

def get_legacy_batch_progress_file():
    """Legacy batch progress filename for backward compatibility."""
    return os.path.join(os.path.dirname(OUTPUT_DIR), ".batch_progress")

def load_batch_manifest():
    """Load manifest data from the current or legacy progress file."""
    for path in (get_batch_progress_file(), get_legacy_batch_progress_file()):
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    return json.load(f)
            except Exception:
                return None
    return None


def reload_manifest_processed_count(current_value=None):
    """Refresh processed_count from the canonical manifest if it exists."""
    manifest = load_batch_manifest()
    if manifest:
        processed_count = manifest.get("processed_count")
        if isinstance(processed_count, int) and processed_count >= 0:
            return processed_count
    return current_value


def resolve_final_auto_upload_success_count(manifest_processed_count, total_files_organized):
    """Prefer persisted manifest count for final auto-upload totals."""
    if isinstance(manifest_processed_count, int) and manifest_processed_count >= 0:
        return manifest_processed_count
    return total_files_organized


def resolve_files_in_batch_for_accounting(batch_success_count):
    """Count only files created in the current run when updating batch totals."""
    if isinstance(batch_success_count, int) and batch_success_count >= 0:
        return batch_success_count
    return 0


def resolve_retry_display_name(entry, fallback_index):
    """Best-effort display label for retry logs when report file names are missing."""
    if isinstance(entry, dict):
        for key in ('file', 'output_file', 'original_file'):
            value = entry.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        date_value = entry.get('date')
        if isinstance(date_value, str) and date_value.strip():
            return date_value.strip()

        download_url = entry.get('download_url')
        if isinstance(download_url, str) and download_url.strip():
            base_name = os.path.basename(download_url.split('?', 1)[0].rstrip('/'))
            if base_name:
                return base_name

    return f"memory_{fallback_index + 1}"


def parse_snapchat_utc_timestamp(date_str):
    dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
    return dt.replace(tzinfo=timezone.utc).timestamp()


def apply_retry_timestamp(path_value, date_str):
    ts_epoch = parse_snapchat_utc_timestamp(date_str)
    os.utime(path_value, (ts_epoch, ts_epoch))
    return ts_epoch


def retry_entry_has_overlay_source_metadata(entry):
    """True when a report entry carries enough source metadata for overlay reconstruction."""
    return any(entry.get(key) for key in (
        "zip_member",
        "source_zip_member",
        "main_member",
        "overlay_member",
        "overlay_metadata",
    ))


def retry_entry_may_require_overlay_metadata(entry):
    """Detect entries likely produced by overlay ZIP processing without inventing metadata."""
    text_parts = [
        entry.get("file"),
        entry.get("reason"),
        entry.get("retry_reason"),
        entry.get("media_type"),
    ]
    text = " ".join(str(part).lower() for part in text_parts if part)
    return "overlay" in text or ".zip" in text or "bad zip file" in text or "no main file in zip" in text


def resolve_total_accounted_for_verification(logical_processed_before_run, current_results_count):
    """Combine skipped logical progress with this run's report entries."""
    prior_count = logical_processed_before_run if isinstance(logical_processed_before_run, int) and logical_processed_before_run >= 0 else 0
    current_count = current_results_count if isinstance(current_results_count, int) and current_results_count >= 0 else 0
    return prior_count + current_count


def resolve_auto_upload_retry_batch_dir(staging_dir, destination_dir, upload_ledger, batch_size=500):
    """Choose the next Cloud retry batch using both staging and delivered batches."""
    delivered_pairs = upload_ledger.get_done_destinations_by_staged_path() if upload_ledger else None
    batch_scan = scan_existing_batch_roots(
        staging_dir,
        destination_dir,
        batch_size,
        completed_staged_to_dest=delivered_pairs,
    )
    last_incomplete_batch = batch_scan["last_incomplete_batch"]
    files_in_incomplete_batch = batch_scan["files_in_incomplete_batch"]

    if last_incomplete_batch and files_in_incomplete_batch < batch_size:
        output_dir = os.path.join(staging_dir, last_incomplete_batch)
    else:
        next_batch_num = batch_scan["next_available_batch"] + 1
        output_dir = os.path.join(staging_dir, f"Batch_{next_batch_num:02d}")

    os.makedirs(output_dir, exist_ok=True)
    return output_dir

def save_batch_progress(
    batch_num,
    total_batches,
    total_files=None,
    processed_indices=None,
    zip_fingerprint=None,
    output_dir=None,
    icloud_mode=None,
    actual_file_count=None,
    batch_completed=True,
    raise_on_error=False,
    progress_callback=None,
):
    """Save batch progress to disk without treating partial batches as completed."""
    try:
        overall_start = time.perf_counter()
        progress_file = get_batch_progress_file()
        last_completed_batch = compute_last_completed_batch(batch_num, batch_completed=batch_completed)
        data = {
            "last_completed_batch": last_completed_batch,
            "total_batches": total_batches,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if not batch_completed:
            data["active_partial_batch"] = batch_num
        if total_files is not None:
            data["total_files"] = total_files
        if processed_indices is not None:
            # Callers maintain a set in-memory; avoid rebuilding it here.
            if isinstance(processed_indices, set):
                processed_list = sorted(processed_indices)
            else:
                processed_list = sorted(set(processed_indices))
            data["processed_indices"] = processed_list
            # Use actual_file_count if provided (includes duplicates), otherwise use processed_indices length
            data["processed_count"] = actual_file_count if actual_file_count is not None else len(processed_list)
            data["last_index"] = processed_list[-1] if processed_list else -1
        if zip_fingerprint:
            data["zip_fingerprint"] = zip_fingerprint
        if output_dir:
            data["output_dir"] = output_dir
        if icloud_mode is not None:
            data["icloud_mode"] = bool(icloud_mode)
        serialize_start = time.perf_counter()
        payload = json.dumps(data)
        serialize_elapsed = time.perf_counter() - serialize_start
        write_start = time.perf_counter()
        atomic_write_text(progress_file, payload)
        write_elapsed = time.perf_counter() - write_start
        total_elapsed = time.perf_counter() - overall_start
        verify_perf_log(
            f"manifest_write prepare={serialize_elapsed:.4f}s write={write_elapsed:.4f}s total={total_elapsed:.4f}s indices={len(data.get('processed_indices', []))}"
        )
    except Exception as e:
        print(f"Warning: Could not save batch progress: {e}", flush=True)
        if raise_on_error:
            emit_processing_event(
                progress_callback,
                "processing_fatal",
                message="Could not save resume manifest.",
                last_error=str(e),
                path=get_batch_progress_file(),
            )
            raise

def load_batch_progress():
    """Load the last batch progress. Returns the batch number to start from (0-indexed)."""
    try:
        data = load_batch_manifest()
        if data:
            last_completed = data.get("last_completed_batch", -1)
            if isinstance(last_completed, int) and last_completed >= 0:
                print(f"Resuming: Last completed batch was {last_completed + 1}. Starting from batch {last_completed + 2}.", flush=True)
            else:
                active_partial_batch = data.get("active_partial_batch")
                if isinstance(active_partial_batch, int) and active_partial_batch >= 0:
                    print(f"Resuming: Found incomplete Batch_{active_partial_batch + 1:02d}. Returning to that batch.", flush=True)
                else:
                    print("Resuming: No completed batches recorded yet. Starting from batch 1.", flush=True)
            return max(0, last_completed + 1)  # Start from next completed boundary
    except Exception as e:
        print(f"Warning: Could not load batch progress: {e}", flush=True)
    return 0  # Start from beginning

def clear_batch_progress():
    """Clear the batch progress file when processing completes successfully."""
    try:
        for path in (get_batch_progress_file(), get_legacy_batch_progress_file()):
            if os.path.exists(path):
                os.remove(path)
    except Exception as e:
        print(f"Warning: Could not clear batch progress: {e}", flush=True)

def compute_zip_fingerprint(zip_path):
    """Compute a simple ZIP fingerprint: filename + size + mtime."""
    if not zip_path:
        return None
    try:
        stat = os.stat(zip_path)
        return f"{os.path.basename(zip_path)}|{stat.st_size}|{int(stat.st_mtime)}"
    except OSError:
        return None

def set_config(json_path, downloads_dir, output_dir=None, raw_dl_name=None, output_root=None):
    global JSON_PATH, DOWNLOADS_DIR, OUTPUT_DIR, TEMP_DIR, CORRUPTED_DIR, REPORT_FILE, RAW_DL_NAME, PROCESSING_ROOT
    JSON_PATH = json_path
    DOWNLOADS_DIR = downloads_dir

    if output_dir:
        # Validate output path - prevent path traversal
        abs_output = canonical_dir(output_dir)
        if '..' in output_dir:
            raise ValueError("Output path cannot contain '..'")
        # Guard against deleting or writing to sensitive roots
        home = os.path.expanduser('~')
        sensitive = {
            os.path.abspath('/'),
            os.path.abspath(home),
            os.path.abspath(os.path.join(home, 'Documents')),
            os.path.abspath(os.path.join(home, 'Downloads')),
            os.path.abspath(os.path.join(home, 'Desktop')),
            os.path.abspath(os.path.join(home, 'Pictures')),
            os.path.abspath(os.path.join(home, 'Library')),
        }
        if abs_output in sensitive:
            raise ValueError("Output path cannot be a sensitive root directory")

        # Block external drive roots (e.g., /Volumes/USB)
        # Require subfolders to avoid permission/write issues
        if abs_output.startswith('/Volumes/'):
            # Count slashes: /Volumes/USB = 2 slashes (root), /Volumes/USB/folder = 3+ slashes (subfolder)
            if abs_output.count('/') <= 2:
                drive_name = os.path.basename(abs_output)
                raise ValueError(f"Cannot use external drive root. Please create a subfolder (e.g., /Volumes/{drive_name}/DateBack_Output)")

        OUTPUT_DIR = abs_output

    if raw_dl_name:
        RAW_DL_NAME = raw_dl_name

    # Determine the root directory for temp/corrupted/report
    # If output_root is provided, use it (for process_from_zip)
    # Otherwise use OUTPUT_DIR (for legacy direct calls)
    base_dir = output_root if output_root else OUTPUT_DIR
    PROCESSING_ROOT = canonical_dir(base_dir)

    # Update derived paths - place temp/corrupted/report in the base directory (user-selected folder)
    # But processed files go in OUTPUT_DIR (which might be Processed_Memories_YYYY-MM-DD subfolder)
    TEMP_DIR = os.path.join(PROCESSING_ROOT, 'temp_processing')
    CORRUPTED_DIR = os.path.join(PROCESSING_ROOT, 'Corrupted_Memories')
    REPORT_FILE = os.path.join(PROCESSING_ROOT, 'detailed_report.json')
    
    # Ensure directories exist
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Clean up temp directory from previous crashes
    if os.path.exists(TEMP_DIR):
        print(f"Cleaning up temp directory from previous run: {TEMP_DIR}", flush=True)
        try:
            shutil.rmtree(TEMP_DIR)
            print("✓ Temp directory cleaned up", flush=True)
        except Exception as e:
            print(f"Warning: Could not clean up temp directory: {e}", flush=True)
    
    # Recreate clean temp directory
    os.makedirs(TEMP_DIR, exist_ok=True)
    os.makedirs(CORRUPTED_DIR, exist_ok=True)

def get_remote_file_size(url, retries=5):
    """
    Fetches the Content-Length with exponential backoff.
    SECURITY: Validates URL before making network request to prevent SSRF.
    """
    # SECURITY: Validate URL BEFORE any network request
    if not is_allowed_download_url(url):
        print(f"Blocked HEAD request to disallowed URL: {url}", flush=True)
        return None
    
    wait = 1
    for i in range(retries):
        try:
            session = get_requests_session()
            # SECURITY: Disable redirects to prevent redirect-based SSRF
            response = session.head(url, allow_redirects=False, timeout=15)
            if response.status_code == 200:
                size = response.headers.get('Content-Length')
                if size is None:
                    print("Warning: Content-Length missing; proceeding without size match.", flush=True)
                    return None
                return int(size)
            elif response.status_code == 404:
                return None # Not found, don't retry
        except Exception as e:
            if i == retries - 1:
                print(f"Warning: HEAD request failed after {retries} attempts: {e}", flush=True)
                return None
            time.sleep(wait)
            wait *= 2
    return None

def check_space_and_wait(path, min_gb=None, resume_gb=None):
    """
    Checks free space. If < min_gb, waits until free space > resume_gb.
    Implements Hysteresis to prevent stuttering.
    """
    # Use global constants if not specified
    if min_gb is None:
        min_gb = MIN_FREE_GB
    if resume_gb is None:
        resume_gb = RESUME_FREE_GB
        
    while True:
        try:
            total, used, free = shutil.disk_usage(path)
            free_gb = free / (1024**3)
            
            if free_gb >= min_gb:
                return
            
            # --- Low Space Detected ---
            print(f"\n⚠️  LOW DISK SPACE WARNING ⚠️", flush=True)
            print(f"   Current Free Space: {free_gb:.2f} GB (Threshold: {min_gb} GB)", flush=True)
            print(f"   PAUSING processing to prevent disk fill-up.", flush=True)
            print(f"   ------------------------------------------------", flush=True)
            print(f"   ACTION REQUIRED: Please free up space to continue.", flush=True)
            print(f"   👉 Google Drive: Right-click folder > 'Free Up Space' / 'Online Only'", flush=True)
            print(f"   👉 iCloud: macOS should optimize automatically. Check System Settings.", flush=True)
            print(f"   ------------------------------------------------", flush=True)
            print(f"   Target to Resume: > {resume_gb} GB free space.", flush=True)
            print(f"   DateBack is waiting and checking space every {POLL_INTERVAL_SEC} seconds...", flush=True)
            
            # Sub-loop to wait for Resume Threshold
            while True:
                time.sleep(POLL_INTERVAL_SEC)
                try:
                    _, _, free_poll = shutil.disk_usage(path)
                    poll_gb = free_poll / (1024**3)
                    
                    if poll_gb >= resume_gb:
                         print(f"✅ Space Detected ({poll_gb:.2f} GB). Resuming processing!", flush=True)
                         return
                    else:
                         # Simple heartbeat
                         print(f"   ... Waiting ({poll_gb:.2f} GB / {resume_gb} GB needed) ...", flush=True)
                except:
                    pass
        except OSError:
             # Path might not exist yet or permission error
             return
        except Exception as e:
             print(f"Error checking disk space: {e}", flush=True)
             return # Don't block if check fails

def check_output_directory_available():
    """
    Check if output directory is still accessible.
    Detects when external drives are ejected during processing.
    """
    if not os.path.exists(OUTPUT_DIR):
        raise RuntimeError(f"Output directory no longer available: {OUTPUT_DIR}. Was the drive ejected?")
    
    # Also check parent directory (where temp_processing lives)
    parent_dir = os.path.dirname(OUTPUT_DIR)
    if not os.path.exists(parent_dir):
        raise RuntimeError(f"Parent directory no longer available: {parent_dir}. Was the drive ejected?")

# Global size index
file_size_index = {}
# ZIP basename index (only populated for ZIP workflows)
zip_name_index = {}
# ZIP SID index (only populated for ZIP workflows)
zip_sid_index = {}
# ZIP timestamp indexes for exports whose JSON rows have blank download URLs
zip_datetime_media_index = {}
zip_date_media_index = {}
zip_claimed_members = set()
# Maps ZIP member path → companion ZIP file path (for multi-part Snapchat exports)
_companion_zip_registry = {}
zip_match_lock = threading.Lock()
# Global processed index: filename -> size
processed_index = {}

def build_file_index(search_dir):
    print("Building local file index...", flush=True)
    global file_size_index
    file_size_index = {}
    for root, _, files in os.walk(search_dir):
        # Recursive walk through directory 
        
        for f in files:
            if f.endswith('.py') or f.endswith('.json') or f == '.DS_Store' or f.startswith('.'):
                continue
            path = os.path.join(root, f)
            try:
                size = os.path.getsize(path)
                if size not in file_size_index:
                    file_size_index[size] = []
                file_size_index[size].append(f)
            except OSError:
                pass
    print(f"Index built. Found {sum(len(v) for v in file_size_index.values())} files matching size criteria.", flush=True)

def scan_existing_output_files(output_dir):
    """
    Single recursive scan used by Verify mode and processed index loading.
    Returns:
      - existing_files_nonzero: set of non-hidden filenames with size > 0
      - processed_index_map: filename -> size (includes 0-byte files for compatibility)
    """
    scan_start = time.perf_counter()
    existing_files_nonzero = set()
    processed_index_map = {}
    scanned_files = 0

    for root, dirs, files in os.walk(output_dir):
        # Match prior verify behavior: skip hidden directory trees entirely.
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.startswith('.'):
                continue
            p = os.path.join(root, f)
            try:
                size = os.path.getsize(p)
            except (OSError, IOError):
                continue
            processed_index_map[f] = size
            if size > 0:
                existing_files_nonzero.add(f)
            scanned_files += 1

    scan_elapsed = time.perf_counter() - scan_start
    verify_perf_log(
        f"verify_scan files={scanned_files} unique_names={len(processed_index_map)} nonzero={len(existing_files_nonzero)} elapsed={scan_elapsed:.4f}s"
    )
    return existing_files_nonzero, processed_index_map


def build_processed_index(output_dir, pre_scanned_index=None):
    print("Building processed file index (recursion enabled)...", flush=True)
    global processed_index
    if pre_scanned_index is None:
        _, pre_scanned_index = scan_existing_output_files(output_dir)
    processed_index = dict(pre_scanned_index)
    print(f"Processed Index built. Found {len(processed_index)} existing files.", flush=True)


def build_verify_expected_filenames(memories):
    """
    Precompute expected filename stems for Verify mode to avoid repeated date parsing.
    Returns list aligned with memories; each entry is (timestamp_name, ext) or None.
    """
    expected = [None] * len(memories)
    for i, memory in enumerate(memories):
        date_str = memory.get('Date')
        if not date_str:
            continue
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
            timestamp_name = dt.strftime('%Y-%m-%d_%H-%M-%S')
        except ValueError:
            continue
        media_type = memory.get('Media Type', 'Image')
        ext = ".mp4" if media_type == "Video" else ".jpg"
        expected[i] = (timestamp_name, ext)
    return expected

def normalize_media_kind(media_type):
    return "Video" if str(media_type or "").lower() == "video" else "Image"


def media_kind_from_zip_extension(filename):
    ext = os.path.splitext(filename)[1].lower()
    return "Video" if ext in (".mp4", ".mov", ".m4v") else "Image"


def zip_info_datetime_key(info):
    try:
        dt = datetime(*info.date_time[:6])
    except Exception:
        return None
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def memory_datetime_match_keys(date_str):
    try:
        dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
    except (TypeError, ValueError):
        return []

    keys = [dt.strftime('%Y-%m-%d %H:%M:%S')]
    # ZIP timestamps have two-second precision, so odd JSON seconds are stored
    # as the previous even second in Snapchat's local archive files.
    if dt.second % 2 == 1:
        keys.append((dt - timedelta(seconds=1)).strftime('%Y-%m-%d %H:%M:%S'))
    return keys


def claim_zip_member_for_blank_download_url(date_str, media_type):
    media_kind = normalize_media_kind(media_type)
    exact_keys = memory_datetime_match_keys(date_str)

    with zip_match_lock:
        for key in exact_keys:
            for member_name in zip_datetime_media_index.get((key, media_kind), []):
                if member_name not in zip_claimed_members:
                    zip_claimed_members.add(member_name)
                    return member_name

        date_key = str(date_str or "")[:10]
        date_candidates = [
            member_name
            for member_name in zip_date_media_index.get((date_key, media_kind), [])
            if member_name not in zip_claimed_members
        ]
        if len(date_candidates) == 1:
            member_name = date_candidates[0]
            zip_claimed_members.add(member_name)
            return member_name

    return None

def build_file_index_from_zip(zip_file_obj, clear=True, source_zip_path=None):
    global file_size_index, zip_name_index, zip_sid_index, zip_datetime_media_index, zip_date_media_index, zip_claimed_members, _companion_zip_registry
    if clear:
        print("Building file index directly from ZIP...", flush=True)
        file_size_index = {}
        zip_name_index = {}
        zip_sid_index = {}
        zip_datetime_media_index = {}
        zip_date_media_index = {}
        zip_claimed_members = set()
        _companion_zip_registry = {}
    
    count = 0
    for info in zip_file_obj.infolist():
        if info.is_dir(): continue
        if zipinfo_is_symlink(info):
            continue
        
        # Filter unrelated files?
        if info.filename.endswith('/') or '__MACOSX' in info.filename:
             continue
        base_name = os.path.basename(info.filename)
        if base_name.endswith('.py') or base_name.endswith('.json') or base_name == '.DS_Store' or base_name.startswith('.'):
            continue
             
        size = info.file_size
        if size not in file_size_index:
            file_size_index[size] = []
        
        # We store the FULL ZIP PATH so we can open it later
        file_size_index[size].append(info.filename)
        base_name = os.path.basename(info.filename)
        if base_name:
            zip_name_index.setdefault(base_name, []).append(info.filename)
            sid_match = re.search(r'_([A-F0-9-]{36})-main\.', base_name, re.IGNORECASE)
            if sid_match:
                sid = sid_match.group(1).upper()
                zip_sid_index.setdefault(sid, []).append(info.filename)
            local_memory_match = re.match(
                r'^(\d{4}-\d{2}-\d{2})_[A-F0-9-]{36}-main\.[^.]+$',
                base_name,
                re.IGNORECASE
            )
            if local_memory_match:
                media_kind = media_kind_from_zip_extension(base_name)
                date_key = local_memory_match.group(1)
                zip_date_media_index.setdefault((date_key, media_kind), []).append(info.filename)
                datetime_key = zip_info_datetime_key(info)
                if datetime_key:
                    zip_datetime_media_index.setdefault((datetime_key, media_kind), []).append(info.filename)
        if source_zip_path:
            _companion_zip_registry[info.filename] = source_zip_path
        count += 1

    for index in (zip_name_index, zip_sid_index, zip_datetime_media_index, zip_date_media_index):
        for names in index.values():
            names.sort()

    if clear:
        print(f"ZIP Index built. Found {count} files.", flush=True)
    else:
        print(f"  Added {count} files from {os.path.basename(source_zip_path or '?')}.", flush=True)

def _build_companion_zip_indexes(primary_zip_path):
    """Index companion ZIPs from a multi-part Snapchat export (e.g. mydata~...-2.zip, -3.zip ...)."""
    primary_dir = os.path.dirname(primary_zip_path)
    primary_base = os.path.basename(primary_zip_path)
    stem = primary_base[:-4] if primary_base.lower().endswith('.zip') else primary_base

    companions = []
    try:
        for fname in sorted(os.listdir(primary_dir)):
            if not fname.lower().endswith('.zip'):
                continue
            if not re.match(re.escape(stem) + r'-\d+\.zip$', fname, re.IGNORECASE):
                continue
            candidate = os.path.realpath(os.path.join(primary_dir, fname))
            lstat = os.lstat(os.path.join(primary_dir, fname))
            if not stat.S_ISREG(lstat.st_mode):
                continue
            companions.append(candidate)
    except OSError:
        return

    if not companions:
        return

    print(json.dumps({
        "type": "companion_found",
        "companion_count": len(companions),
        "companions": [os.path.basename(c) for c in companions]
    }), flush=True)
    total_added = 0
    for companion_path in companions:
        try:
            with zipfile.ZipFile(companion_path, 'r') as companion_zf:
                before = sum(len(v) for v in zip_name_index.values())
                build_file_index_from_zip(companion_zf, clear=False, source_zip_path=companion_path)
                after = sum(len(v) for v in zip_name_index.values())
                total_added += after - before
        except Exception as e:
            print(f"  Warning: Could not index {os.path.basename(companion_path)}: {e}", flush=True)

    print(f"Combined index ready. {total_added} additional files from {len(companions)} companion ZIP(s).", flush=True)


def process_zip(zip_path, output_path, ts_epoch=None):
    zip_name = os.path.basename(zip_path)
    extract_dir = os.path.join(TEMP_DIR, zip_name + "_extract")
    os.makedirs(extract_dir, exist_ok=True)
    reserved_output = None

    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            safe_extract(zf, extract_dir)  # Use safe extraction with path validation

        files = os.listdir(extract_dir)
        main_file = None
        overlay_file = None
        
        for f in files:
            if 'main' in f.lower():
                main_file = os.path.join(extract_dir, f)
            elif 'overlay' in f.lower():
                overlay_file = os.path.join(extract_dir, f)

        if not main_file:
            return {"status": "Error", "reason": "No main file in zip", "file": zip_name}

        # Determine true extension and final filename
        mime = mimetypes.guess_type(main_file)[0]
        base_path_no_ext = os.path.splitext(output_path)[0]
        target_dir = os.path.dirname(base_path_no_ext)
        base_name = os.path.basename(base_path_no_ext)
        final_output = None

        if (mime and mime.startswith('video')) or main_file.endswith('.mp4'):
            ext = ".mp4"
            final_output = reserve_unique_output_path(target_dir, base_name, ext)
            reserved_output = final_output

            result_msg = ""
            if overlay_file:
                temp_output = f"{final_output}.tmp.{secrets.token_hex(4)}"
                try:
                    cmd = [
                        FFMPEG_PATH, '-y',
                        '-i', main_file,
                        '-i', overlay_file,
                        '-filter_complex', "[0:v][1:v]overlay=0:0",
                        '-c:a', 'copy',
                        temp_output  # Write to temp first
                    ]
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                    os.replace(temp_output, final_output)
                    result_msg = "Success (Video Merge)"
                except (subprocess.CalledProcessError, FileNotFoundError):
                    if os.path.exists(temp_output):
                        try:
                            os.remove(temp_output)
                        except OSError:
                            pass

                    # Fallback still uses atomic write
                    atomic_copy_file(main_file, final_output)
                    result_msg = "Success (Video Extract - No Overlay)"
            else:
                atomic_copy_file(main_file, final_output)
                result_msg = "Success (Video Extract)"

            if ts_epoch:
                try:
                    os.utime(final_output, (ts_epoch, ts_epoch))
                except (OSError, IOError):
                    pass

            try:
                if os.path.getsize(final_output) <= 0:
                    return {"status": "Error", "reason": "Processed file is empty", "file": os.path.basename(final_output)}
            except OSError as e:
                return {"status": "Error", "reason": f"Could not stat processed file: {e}", "file": os.path.basename(final_output)}

            return {
                "status": "Success",
                "reason": result_msg,
                "file": os.path.basename(final_output),
                "output_path": final_output
            }

        else:
            ext = ".jpg"
            final_output = reserve_unique_output_path(target_dir, base_name, ext)
            reserved_output = final_output

            result_msg = ""
            if overlay_file:
                temp_output = f"{final_output}.tmp.{secrets.token_hex(4)}"
                try:
                    with Image.open(main_file) as main_img:
                        with Image.open(overlay_file) as overlay_img:
                            main_img = main_img.convert("RGBA")
                            overlay_img = overlay_img.convert("RGBA")
                            if main_img.size != overlay_img.size:
                                overlay_img = overlay_img.resize(main_img.size, Image.Resampling.LANCZOS)
                            combined = Image.alpha_composite(main_img, overlay_img)
                            combined = combined.convert("RGB")
                            combined.save(temp_output, "JPEG")
                            combined.close()
                            del combined

                    os.replace(temp_output, final_output)
                    result_msg = "Success (Image Merge)"
                except Exception as e:
                    if os.path.exists(temp_output):
                        try:
                            os.remove(temp_output)
                        except OSError:
                            pass
                    return {"status": "Error", "reason": f"Merge failed: {str(e)}", "file": zip_name}
            else:
                atomic_copy_file(main_file, final_output)
                result_msg = "Success (Image Extract)"

            if ts_epoch:
                try:
                    os.utime(final_output, (ts_epoch, ts_epoch))
                except (OSError, IOError):
                    pass

            try:
                if os.path.getsize(final_output) <= 0:
                    return {"status": "Error", "reason": "Processed file is empty", "file": os.path.basename(final_output)}
            except OSError as e:
                return {"status": "Error", "reason": f"Could not stat processed file: {e}", "file": os.path.basename(final_output)}

            return {
                "status": "Success",
                "reason": result_msg,
                "file": os.path.basename(final_output),
                "output_path": final_output
            }

    except zipfile.BadZipFile:
        return {"status": "Error", "reason": "Bad Zip File", "file": zip_name}
    except Exception as e:
        return {"status": "Error", "reason": str(e), "file": zip_name}
    finally:
        release_reserved_output_path(reserved_output)
        shutil.rmtree(extract_dir, ignore_errors=True)

def save_error_report(mem_id, date_str, url, reason):
    """Saves a text file report for a corrupted/failed memory."""
    try:
        # Ensure CORRUPTED_DIR exists (it's global)
        if not os.path.exists(CORRUPTED_DIR):
            os.makedirs(CORRUPTED_DIR, exist_ok=True)
            
        filename = f"ERROR_{mem_id}.txt"
        path = os.path.join(CORRUPTED_DIR, filename)
        
        with open(path, "w") as f:
            f.write(f"Memory ID: {mem_id}\n")
            f.write(f"Date: {date_str}\n")
            f.write(f"Reason: {reason}\n")
            f.write(f"URL: {url}\n")
            f.write("\nNote: You can try opening the URL in a browser to check if it's still accessible.\n")
            
    except Exception as e:
        print(f"Failed to save error report: {e}")

def fast_pass_check(memories, output_dir, progress_callback=None, existing_files=None, expected_filenames=None):
    """
    Fast Pass Pre-Check: Quickly verify if all expected files already exist.
    Returns (all_exist, existing_count, total_count, existing_indices) tuple.
    
    If all files exist, the caller can skip ZIP extraction entirely.
    existing_indices is a set of memory indices that already have files.
    """
    if not memories or not os.path.exists(output_dir):
        return False, 0, len(memories) if memories else 0, set()
    
    total = len(memories)
    existing = 0
    existing_indices = set()  # Track which memories already have files
    
    print(f"Fast Pass: Checking {total} memories against existing files...", flush=True)
    
    if existing_files is None:
        existing_files, _ = scan_existing_output_files(output_dir)

    if expected_filenames is None:
        expected_filenames = build_verify_expected_filenames(memories)

    match_start = time.perf_counter()
    
    for i in range(total):
        expected = expected_filenames[i] if i < len(expected_filenames) else None
        if not expected:
            continue
        timestamp_name, ext = expected
        expected_filename = f"{timestamp_name}{ext}"
        
        # Check if file exists (or any numbered variant like _1, _2, etc.)
        if expected_filename in existing_files:
            existing += 1
            existing_indices.add(i)
        else:
            # Check for numbered variants (same timestamp = multiple files)
            # This handles cases like 2023-10-01_14-30-00_1.jpg
            for suffix in range(1, 10):  # Check up to _9 variants
                variant_name = f"{timestamp_name}_{suffix}{ext}"
                if variant_name in existing_files:
                    existing += 1
                    existing_indices.add(i)
                    break
        
        # Progress update every 500 files
        # DISABLED: Don't send progress during verification as it confuses the UI
        # if progress_callback and i % 500 == 0:
        #     try:
        #         progress_callback((i, total))
        #     except:
        #         pass
    
    all_exist = existing >= total
    match_elapsed = time.perf_counter() - match_start
    verify_perf_log(
        f"verify_match memories={total} existing={existing} elapsed={match_elapsed:.4f}s"
    )
    print(f"Fast Pass: Found {existing} of {total} files.", flush=True)
    
    return all_exist, existing, total, existing_indices


def process_memory(memory, index, progress_callback=None, zip_file=None, zip_lock=None):
    global expired_link_counter  # Declare global at function top for expired link tracking
    
    date_str = memory.get('Date')
    download_url = memory.get('Media Download Url')
    media_type = memory.get('Media Type', 'Image')
    
    # ... (existing setup) ...
    # Unique ID for tracking (using index since JSON list is ordered)
    mem_id = f"MEM_{index}"
    
    # Check for global abort
    if ABORT_PROCESSING.is_set():
        disk_full_details = get_runtime_disk_full_context()
        if disk_full_details:
            reason = "DISK_FULL: Processing aborted because the drive filled up."
        else:
            reason = "Processing aborted."
        return {"id": mem_id, "status": "Error", "reason": reason, "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    if not date_str:
        return {"id": mem_id, "status": "Skipped", "reason": "Missing Metadata", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    ts_epoch = None
    try:
        dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
        timestamp_name = dt.strftime('%Y-%m-%d_%H-%M-%S')
        # Ensure we treat as UTC for epoch calculation
        ts_epoch = dt.replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        return {"id": mem_id, "status": "Skipped", "reason": f"Invalid Date: {date_str}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    matches = None
    if zip_file:
        # ZIP workflow: skip HEAD and prefer direct SID match against archive entries.
        remote_size = None
        if download_url:
            sid = extract_sid_from_download_url(download_url)
            if sid:
                matches = zip_sid_index.get(sid)
            url_name = os.path.basename(download_url.split('?', 1)[0])
            if not matches and url_name:
                matches = zip_name_index.get(url_name)
        else:
            claimed_member = claim_zip_member_for_blank_download_url(date_str, media_type)
            if claimed_member:
                matches = [claimed_member]
    else:
        if not download_url:
            return {"id": mem_id, "status": "Skipped", "reason": "Missing Metadata", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        remote_size = get_remote_file_size(download_url)
        if remote_size:
            matches = file_size_index.get(remote_size)
        if remote_size is None and not matches:
            return {"id": mem_id, "status": "Skipped", "reason": "Network Error/Not Found", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
    local_path = None
    
    if matches:
        local_filename = matches[0]
        if zip_file:
            local_path = local_filename
        else:
            local_path = os.path.join(DOWNLOADS_DIR, local_filename)
    else:
        # File not found locally - Attempt Download
        if zip_file and not download_url:
            return {"id": mem_id, "status": "Missing", "reason": "No local ZIP media file and no download URL", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        
        # SECURITY: Validate download URL before attempting download
        if not is_allowed_download_url(download_url):
            return {"id": mem_id, "status": "Error", "reason": "Blocked: Invalid download URL (not from Snapchat CDN)", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        
        try:
             # Create a folder for downloaded items if not exists
             # CHANGED: Use TEMP_DIR to avoid saving raw files permanently
             raw_dl_dir = TEMP_DIR
             os.makedirs(raw_dl_dir, exist_ok=True)
             
             mtype = memory.get('Media Type', 'Image')
             dl_ext = '.mp4' if mtype == 'Video' else '.jpg'
             
             dl_filename = f"{mem_id}_{secrets.token_hex(4)}{dl_ext}"  # Random suffix for security
             dl_path = os.path.join(raw_dl_dir, dl_filename)
             
             if not os.path.exists(dl_path) or (remote_size is not None and os.path.getsize(dl_path) != remote_size):
                 session = get_requests_session()
                 with get_with_validated_redirects(session, download_url, timeout=30, stream=True) as r:
                     if r.status_code == 403 or r.status_code == 410:
                         with expired_link_lock:
                             expired_link_counter += 1
                             if expired_link_counter == EXPIRED_LINK_THRESHOLD:
                                 print(f"\\n❌ LINKS_EXPIRED: {expired_link_counter} consecutive download links have expired.", flush=True)
                                 print("   Your Snapchat export links are no longer valid (typically expire after 7 days).", flush=True)
                                 print("   Please request a new data export from Snapchat.", flush=True)
                             if expired_link_counter >= EXPIRED_LINK_THRESHOLD:
                                 ABORT_PROCESSING.set()
                         reason = "EXPIRED_LINK: Download links have expired."
                         save_error_report(mem_id, date_str, download_url, reason)
                         return {"id": mem_id, "status": "Error", "reason": reason, "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
                         
                     # Link worked - reset counter
                     with expired_link_lock:
                         expired_link_counter = 0
                         
                     r.raise_for_status()
                     
                     # SECURITY: Track download size to prevent disk exhaustion
                     downloaded_bytes = 0
                     content_type = (r.headers.get('Content-Type') or '').lower()
                     with open(dl_path, 'wb') as f:
                         for chunk in r.iter_content(chunk_size=8192):
                             if chunk:  # filter out keep-alive new chunks
                                 downloaded_bytes += len(chunk)
                                 if downloaded_bytes > MAX_DOWNLOAD_BYTES:
                                     # Abort - file exceeds size limit
                                     raise ValueError(f"Download exceeded max size limit: {MAX_DOWNLOAD_BYTES / (1024**3):.2f}GB")
                                 f.write(chunk)

                     # Guard against silently saving redirects/errors as empty files.
                     if downloaded_bytes <= 0:
                         raise ValueError("Downloaded file is empty")
                     if 'text/html' in content_type:
                         raise ValueError(f"Unexpected content type for media download: {content_type}")
             
             local_path = dl_path
             local_filename = dl_filename
             
        except requests.exceptions.HTTPError as e:
            msg = str(e)
            if '403' in msg or 'Forbidden' in msg:
                with expired_link_lock:
                    expired_link_counter += 1
                    if expired_link_counter == EXPIRED_LINK_THRESHOLD:
                        print(f"\\n❌ LINKS_EXPIRED: {expired_link_counter} consecutive download links have expired.", flush=True)
                        print("   Your Snapchat export links are no longer valid (typically expire after 7 days).", flush=True)
                        print("   Please request a new data export from Snapchat.", flush=True)
                    if expired_link_counter >= EXPIRED_LINK_THRESHOLD:
                        ABORT_PROCESSING.set()
                msg = "EXPIRED_LINK: Download links have expired."
            save_error_report(mem_id, date_str, download_url, msg)
            return {"id": mem_id, "status": "Error", "reason": msg, "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        except OSError as e:
            if e.errno == errno.ENOSPC:
                emit_runtime_disk_full(
                    progress_callback,
                    path_value=dl_path,
                    message="DateBack stopped because the working drive ran out of space while downloading a memory.",
                    error=e
                )
                return {"id": mem_id, "status": "Error", "reason": "DISK_FULL: No space left on device", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
            save_error_report(mem_id, date_str, download_url, str(e))
            return {"id": mem_id, "status": "Error", "reason": f"System Error: {str(e)}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        except Exception as e:
            save_error_report(mem_id, date_str, download_url, str(e))
            return {"id": mem_id, "status": "Error", "reason": f"Download Failed: {str(e)}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    # Now we have a local_path (either found or downloaded)
    # Proceed with existing logic...
    
    base_name = timestamp_name
    counter = 1
    ext = ".jpg"
    
    # helper to get extension from filename
    if local_filename and '.' in local_filename:
        _, ext = os.path.splitext(local_filename)

    if not local_path:
         return {"id": mem_id, "status": "Error", "reason": "Logic Error: No Local Path", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    # ZIP mode optimization:
    # Copy ZIP member bytes to temp_processing under lock, then release lock for all heavy work.
    if zip_file and not os.path.isabs(local_path):
        member_name = local_path
        suffix_hint = os.path.splitext(local_filename)[1] if local_filename and '.' in local_filename else '.bin'
        try:
            local_path, _ = stream_zip_member_to_temp(
                zip_file=zip_file,
                member_name=member_name,
                zip_lock=zip_lock,
                mem_id=mem_id,
                suffix_hint=suffix_hint
            )
            local_filename = os.path.basename(local_filename or member_name)
        except KeyError:
            return {"id": mem_id, "status": "Error", "reason": f"ZIP entry not found: {member_name}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        except Exception as e:
            return {"id": mem_id, "status": "Error", "reason": f"ZIP stream failed: {e}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    # Detect if this is actually a ZIP file by reading magic bytes
    # CRITICAL: Downloaded overlay ZIPs may have .jpg extension based on Media Type
    is_actual_zip = is_zip_file(local_path) or local_filename.lower().endswith('.zip')

    if not is_actual_zip:
        # DUPLICATE CHECK FOR NON-ZIP
        # We know local_path exists and has a size
        local_size = os.path.getsize(local_path)
        
        with filename_lock:
            # GLOBAL INDEX CHECK (Handles Batches)
            chk_name = f"{base_name}{ext}"
            if chk_name in processed_index:
                # Check size if available
                if processed_index[chk_name] == local_size:
                    # Cleanup if temp download
                    if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                        try: os.remove(local_path) 
                        except (OSError, IOError): pass
                    return {"id": mem_id, "status": "Duplicate", "reason": "Already exists (in batch)", "file": chk_name}
            
            # Fallback: Check current batch folder (for race conditions)
            target_dir = CURRENT_BATCH_DIR if CURRENT_BATCH_DIR else OUTPUT_DIR
            cand = os.path.join(target_dir, chk_name)
            if os.path.exists(cand) and os.path.getsize(cand) == local_size:
                # Cleanup if temp download
                if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                    try: os.remove(local_path)
                    except (OSError, IOError): pass
                return {"id": mem_id, "status": "Duplicate", "reason": "Already exists", "file": os.path.basename(cand)}
            
            # Check numbered in Global Index
            c = 1
            found_dup = False
            while True:
                chk_name_n = f"{base_name}_{c}{ext}"
                if chk_name_n in processed_index:
                    if processed_index[chk_name_n] == local_size:
                        found_dup = True
                        break
                else:
                    break
                c += 1
                
            if found_dup:
                # Cleanup if temp download
                if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                    try: os.remove(local_path) 
                    except (OSError, IOError): pass
                return {"id": mem_id, "status": "Duplicate", "reason": "Already exists (in batch)", "file": chk_name_n}

    # Thread-safe filename generation
    # Use CURRENT_BATCH_DIR if set (batch mode), otherwise fall back to OUTPUT_DIR (legacy)
    target_dir = CURRENT_BATCH_DIR if CURRENT_BATCH_DIR else OUTPUT_DIR
    output_path = None
    reserved_output = None

    try:
        if is_actual_zip:
            # Use a base path only; process_zip will reserve final extension-specific filename.
            output_path = os.path.join(target_dir, f"{base_name}{ext}")

            res = process_zip(local_path, output_path, ts_epoch)
            res['id'] = mem_id
            if res['status'] == 'Error':
                try:
                    shutil.copy2(local_path, os.path.join(CORRUPTED_DIR, local_filename))
                except Exception:
                    pass

            if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                try:
                    os.remove(local_path)
                except (OSError, IOError):
                    pass

            return res

        # Non-overlay file path: reserve then atomic write
        output_path = reserve_unique_output_path(target_dir, base_name, ext)
        reserved_output = output_path

        atomic_copy_file(local_path, output_path)

        if ts_epoch:
            try:
                os.utime(output_path, (ts_epoch, ts_epoch))
            except (OSError, IOError):
                pass

        try:
            if os.path.getsize(output_path) <= 0:
                raise ValueError("Processed file is empty")
        except OSError as e:
            raise ValueError(f"Could not stat processed file: {e}")

        if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except (OSError, IOError):
                pass

        return {
            "id": mem_id,
            "status": "Success",
            "reason": "Processed (Streamed)" if zip_file else "Processed (Local)",
            "file": os.path.basename(output_path),
            "output_path": output_path
        }
    except Exception as e:
        if is_disk_full_error(e):
            emit_runtime_disk_full(
                progress_callback,
                path_value=output_path or local_path,
                error=e
            )
        try:
            if local_path and os.path.exists(local_path):
                target_corrupt = os.path.join(CORRUPTED_DIR, local_filename)
                if os.path.exists(target_corrupt):
                    base, ext_name = os.path.splitext(local_filename)
                    target_corrupt = os.path.join(CORRUPTED_DIR, f"{base}_{int(time.time())}{ext_name}")
                shutil.copy2(local_path, target_corrupt)
                print(f"Saved corrupted file to: {target_corrupt}")
        except Exception as copy_err:
            print(f"Failed to copy to corrupted: {copy_err}")

        if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except (OSError, IOError):
                pass

        return {
            "id": mem_id,
            "status": "Error",
            "reason": str(e),
            "file": local_filename,
            "date": date_str,
            "download_url": download_url,
            "media_type": media_type
        }
    finally:
        release_reserved_output_path(reserved_output)

def main(limit=None, clear_output=True, progress_callback=None, zip_file=None, json_data=None, pause_batches=False,
         trust_manifest=False, zip_fingerprint=None, auto_upload=False, destination_dir=None, cache_gb=5.0,
         cache_low_gb=3.0, upload_mode='copy', staging_dir=None, max_upload_retries=20):
    # Declare global variable at the top of the function
    global ORIGINAL_TOTAL_MEMORIES, AUTO_UPLOAD_ENABLED, AUTO_DESTINATION_DIR, AUTO_CACHE_GB
    global AUTO_CACHE_LOW_GB, AUTO_UPLOAD_MODE, AUTO_STAGING_DIR, AUTO_MAX_UPLOAD_RETRIES

    AUTO_UPLOAD_ENABLED = bool(auto_upload)
    AUTO_DESTINATION_DIR = destination_dir
    AUTO_CACHE_GB = float(cache_gb)
    AUTO_CACHE_LOW_GB = float(cache_low_gb)
    AUTO_UPLOAD_MODE = upload_mode
    AUTO_STAGING_DIR = staging_dir if staging_dir else os.path.join(PROCESSING_ROOT, '.staging')
    AUTO_MAX_UPLOAD_RETRIES = int(max_upload_retries)

    def fail_auto_upload_validation(message):
        emit_processing_event(
            progress_callback,
            "upload_fatal",
            message=message,
            last_error=message,
            dest_dir=AUTO_DESTINATION_DIR
        )
        raise ValueError(message)

    if AUTO_UPLOAD_ENABLED:
        if not AUTO_DESTINATION_DIR:
            fail_auto_upload_validation("Auto upload requires a destination directory.")
        if AUTO_UPLOAD_MODE not in ('copy', 'move'):
            fail_auto_upload_validation("upload_mode must be 'copy' or 'move'.")
        if AUTO_CACHE_GB <= 0:
            fail_auto_upload_validation("cache_gb must be > 0.")
        if AUTO_CACHE_LOW_GB < 0 or AUTO_CACHE_LOW_GB > AUTO_CACHE_GB:
            fail_auto_upload_validation("cache_low_gb must be between 0 and cache_gb.")
        if AUTO_MAX_UPLOAD_RETRIES <= 0:
            fail_auto_upload_validation("max_upload_retries must be > 0.")

        # Canonicalize all paths so safety checks are robust across symlinks.
        processing_root_real = canonicalize_dir_path(PROCESSING_ROOT)
        AUTO_STAGING_DIR = canonicalize_dir_path(AUTO_STAGING_DIR)
        AUTO_DESTINATION_DIR = canonicalize_dir_path(AUTO_DESTINATION_DIR)

        if AUTO_DESTINATION_DIR == AUTO_STAGING_DIR:
            fail_auto_upload_validation("destination_dir and staging_dir must be different.")
        if is_path_inside(AUTO_DESTINATION_DIR, AUTO_STAGING_DIR):
            fail_auto_upload_validation("destination_dir cannot be inside staging_dir.")
        if is_path_inside(AUTO_STAGING_DIR, AUTO_DESTINATION_DIR):
            fail_auto_upload_validation("staging_dir cannot be inside destination_dir.")

        # Prevent recursive destination writes into the processor working tree.
        if is_path_inside(AUTO_DESTINATION_DIR, processing_root_real):
            fail_auto_upload_validation("destination_dir cannot be inside the processing output root.")
        if is_path_inside(processing_root_real, AUTO_DESTINATION_DIR):
            fail_auto_upload_validation("destination_dir cannot be a parent of the processing output root.")

        try:
            preflight_writable_dir(AUTO_STAGING_DIR)
            preflight_writable_dir(AUTO_DESTINATION_DIR)
        except ValueError as e:
            fail_auto_upload_validation(str(e))

        try:
            _, _, staging_free_bytes = shutil.disk_usage(AUTO_STAGING_DIR)
        except OSError as e:
            fail_auto_upload_validation(f"Could not check free space for staging directory: {AUTO_STAGING_DIR} ({e})")

        free_gb = staging_free_bytes / (1024**3)
        safety_buffer_gb = max(SAFETY_BUFFER_GB, round(0.10 * free_gb, 1))
        required_gb = AUTO_CACHE_GB + safety_buffer_gb
        required_bytes = required_gb * (1024**3)

        if staging_free_bytes < required_bytes:
            fail_auto_upload_validation(
                f"Insufficient free disk space on staging volume. Free: {free_gb:.1f} GB, "
                f"required: {required_gb:.1f} GB (cache {AUTO_CACHE_GB:.1f} GB + buffer {safety_buffer_gb:.1f} GB)."
            )

    # ..\n    # ..\n    # Skip loading JSON if provided
    if json_data:
        data = json_data
        print("Using provided JSON data.", flush=True)
    else:
        print("Loading JSON...", flush=True)
        with open(JSON_PATH, 'r') as f:
            data = json.load(f)
            
    if isinstance(data, dict):
        memories = data.get('Saved Media', [])
    else:
        memories = []
        
    print(f"Loaded {len(memories)} memories.", flush=True)
    
    if limit:
        print(f"--- PARTIAL RUN: Limiting to first {limit} memories ---", flush=True)
        memories = memories[:limit]
    
    processed_indices_set = set()
    previously_processed = 0
    memories_with_index = list(enumerate(memories))
    manifest = load_batch_manifest()
    manifest_processed_count = None

    if manifest:
        manifest_processed_count = manifest.get("processed_count")
        manifest_zip = manifest.get("zip_fingerprint")
        if manifest_zip and zip_fingerprint and manifest_zip != zip_fingerprint and (trust_manifest or auto_upload):
            raise ValueError("ZIP export does not match previous run. Please choose Verify Files or Start Fresh.")

    if trust_manifest or auto_upload:
        mode_label = "Resume mode: Skip Files Already Processed" if trust_manifest else "Auto Upload mode: Using manifest resume state"
        print(mode_label, flush=True)

        if not manifest:
            if trust_manifest:
                print("Warning: Manifest missing or corrupted; falling back to Verify Files.", flush=True)
                trust_manifest = False
            else:
                print("Auto Upload mode: no manifest found, starting from beginning.", flush=True)
        else:
            processed_list = manifest.get("processed_indices")
            if processed_list is None:
                last_index = manifest.get("last_index")
                if isinstance(last_index, int) and last_index >= 0:
                    processed_list = list(range(last_index + 1))

            if processed_list:
                for i in processed_list:
                    try:
                        processed_indices_set.add(int(i))
                    except (ValueError, TypeError):
                        pass

                ORIGINAL_TOTAL_MEMORIES = len(memories)
                memories_with_index = [(i, m) for i, m in memories_with_index if i not in processed_indices_set]
                print(f"Skipping {len(processed_indices_set)} previously processed memories.", flush=True)
            elif trust_manifest:
                print("Warning: Manifest missing processed indices; falling back to Verify Files.", flush=True)
                trust_manifest = False
    else:
        print("Resume mode: Verify Files", flush=True)

    used_trust_manifest = bool(trust_manifest)

    # === FAST PASS PRE-CHECK ===
    # If not clearing output, check if all files already exist on disk
    existing_indices = set()  # Track which memories already exist
    verify_scan_processed_index = None
    if not trust_manifest and not auto_upload and not clear_output and os.path.exists(OUTPUT_DIR):
        print("Verifying existing files...", flush=True)
        
        # Send status update to UI
        if progress_callback:
            try:
                progress_callback((-1, len(memories)))  # -1 signals "verifying" phase
            except:
                pass

        verify_existing_files, verify_scan_processed_index = scan_existing_output_files(OUTPUT_DIR)
        expected_verify_filenames = build_verify_expected_filenames(memories)
        all_exist, existing_count, total_count, existing_indices = fast_pass_check(
            memories,
            OUTPUT_DIR,
            progress_callback,
            existing_files=verify_existing_files,
            expected_filenames=expected_verify_filenames
        )
        
        if all_exist and existing_count > 0:
            print(f"✅ Fast Pass: All {existing_count} files verified on disk. Skipping extraction.", flush=True)
            
            # Return immediately with "Up to Date" stats
            stats = {
                "success": 0,  # No NEW files processed
                "duplicates": existing_count,  # All were already there
                "missing": 0,
                "skipped": 0,
                "errors": 0,
                "images": 0,
                "videos": 0,
                "total_size": 0
            }
            
            # Output a completion message for the UI
            print(json.dumps({"type": "complete", "stats": stats}))
            
            return stats
        else:
            print(f"Fast Pass: Found {existing_count} of {total_count}. Proceeding with standard extraction for missing files.", flush=True)
            # Filter memories to only process missing ones
            if existing_indices:
                original_count = len(memories)
                processed_indices_set.update(existing_indices)
                memories_with_index = [(i, m) for i, m in memories_with_index if i not in existing_indices]
                print(f"Fast Pass Optimization: Skipping {original_count - len(memories_with_index)} existing files. Processing {len(memories_with_index)} new/missing files.", flush=True)
                # CRITICAL: Save original count for progress denominator
                ORIGINAL_TOTAL_MEMORIES = original_count

    logical_processed_before_run = len(processed_indices_set)
    
    # Build File Index
    if zip_file:
        build_file_index_from_zip(zip_file)
        if hasattr(zip_file, 'filename') and zip_file.filename:
            _build_companion_zip_indexes(zip_file.filename)
    else:
        build_file_index(DOWNLOADS_DIR)
        
    # Output Directory Setup
    print("Clearing output directory configuration...")
    
    if clear_output:
        # Safety guard: prevent deleting sensitive root directories
        home = os.path.expanduser('~')
        sensitive = {
            os.path.abspath('/'),
            os.path.abspath(home),
            os.path.abspath(os.path.join(home, 'Documents')),
            os.path.abspath(os.path.join(home, 'Downloads')),
            os.path.abspath(os.path.join(home, 'Desktop')),
            os.path.abspath(os.path.join(home, 'Pictures')),
            os.path.abspath(os.path.join(home, 'Library')),
        }
        if os.path.abspath(OUTPUT_DIR) in sensitive:
            raise ValueError("Refusing to clear a sensitive root directory. Please choose a subfolder.")
        
        # Block external drive roots (same check as set_config)
        abs_output = os.path.abspath(OUTPUT_DIR)
        if abs_output.startswith('/Volumes/'):
            if abs_output.count('/') <= 2:
                drive_name = os.path.basename(abs_output)
                raise ValueError(f"Cannot use external drive root. Please create a subfolder (e.g., /Volumes/{drive_name}/DateBack_Output)")
        
        if os.path.exists(OUTPUT_DIR):
            shutil.rmtree(OUTPUT_DIR)
        os.makedirs(OUTPUT_DIR)
        
        # Clear and recreate corrupted directory
        if os.path.exists(CORRUPTED_DIR):
            shutil.rmtree(CORRUPTED_DIR)
        os.makedirs(CORRUPTED_DIR)
    else:
        # Just ensure they exist
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs(CORRUPTED_DIR, exist_ok=True)
    
    # Build processed index if we are NOT clearing output (meaning we are resuming/adding)
    if not clear_output and not auto_upload:
        build_processed_index(OUTPUT_DIR, pre_scanned_index=verify_scan_processed_index)
    else:
        global processed_index
        processed_index = {}  # Reset

    print("Starting processing...")
    results = []

    upload_manager = None
    if AUTO_UPLOAD_ENABLED:
        os.makedirs(AUTO_STAGING_DIR, exist_ok=True)
        ledger = UploadLedger(os.path.join(PROCESSING_ROOT, UPLOAD_LEDGER_FILE))
        adapter = FolderDestinationAdapter(AUTO_DESTINATION_DIR, AUTO_UPLOAD_MODE, staging_dir=AUTO_STAGING_DIR)
        upload_manager = AutoUploadManager(
            staging_dir=AUTO_STAGING_DIR,
            adapter=adapter,
            ledger=ledger,
            progress_callback=progress_callback,
            cache_gb=AUTO_CACHE_GB,
            cache_low_gb=AUTO_CACHE_LOW_GB,
            max_upload_retries=AUTO_MAX_UPLOAD_RETRIES
        )
        upload_manager.prepare()
        upload_manager.start()
        recovered = upload_manager.recover_pending()
        if recovered > 0:
            upload_manager.emit("upload_progress", force=True, last_file=None, recovered_staged=recovered)

    auto_cache_pause_active = False

    def enforce_auto_cache_backpressure():
        nonlocal auto_cache_pause_active
        if not upload_manager:
            return
        while not ABORT_PROCESSING.is_set() and not PAUSE_REQUESTED.is_set():
            if upload_manager.has_fatal():
                ABORT_PROCESSING.set()
                break
            staging_bytes = upload_manager.staging_bytes()
            if staging_bytes >= upload_manager.cache_bytes:
                if not auto_cache_pause_active:
                    upload_manager.emit(
                        "auto_pause",
                        last_file=None,
                        reason="cache_full",
                        staging_gb=round(staging_bytes / (1024**3), 3),
                        cache_gb=AUTO_CACHE_GB
                    )
                    auto_cache_pause_active = True
                time.sleep(1)
                continue

            if auto_cache_pause_active and staging_bytes <= upload_manager.cache_low_bytes:
                upload_manager.emit(
                    "auto_resume",
                    last_file=None,
                    staging_gb=round(staging_bytes / (1024**3), 3),
                    cache_low_gb=AUTO_CACHE_LOW_GB
                )
                auto_cache_pause_active = False
                break

            if not auto_cache_pause_active:
                break
            time.sleep(1)
    
    zip_lock = threading.Lock() if zip_file else None
    
    # Use ThreadPoolExecutor for everything (Concurrency restored!)
    workers = 10 if zip_file else 20
    
    
    # === BATCHED PROCESSING ===
    # Process memories in chunks of 500 for better memory management and pause support
    batch_size = 500
    total = len(memories_with_index)
    
    # Use original total for progress denominator (not filtered count)
    # This ensures progress shows X/3903 instead of X/1406 on resume
    progress_denominator = ORIGINAL_TOTAL_MEMORIES if 'ORIGINAL_TOTAL_MEMORIES' in globals() else total
    manifest_total_files = ORIGINAL_TOTAL_MEMORIES if 'ORIGINAL_TOTAL_MEMORIES' in globals() else len(memories)

    # Check for persisted progress FIRST
    persisted_start_batch = -1
    if not clear_output:
        persisted_start_batch = load_batch_progress()

    
    # === DETECT INCOMPLETE BATCHES ===
    # When resuming, check if there's an incomplete batch that needs to be continued
    batch_scan_root = AUTO_STAGING_DIR if auto_upload else OUTPUT_DIR
    existing_batch_files = 0
    orphaned_root_files = 0  # Files in root scan dir (not in batch folders)
    last_incomplete_batch = None
    files_in_incomplete_batch = 0
    batch_folders = []
    next_available_batch = 0

    if os.path.exists(batch_scan_root):
        if auto_upload:
            staging_scan = scan_existing_batch_root(batch_scan_root, batch_size)
            delivered_pairs = ledger.get_done_destinations_by_staged_path() if ledger else None
            batch_scan = scan_existing_batch_roots(
                AUTO_STAGING_DIR,
                AUTO_DESTINATION_DIR,
                batch_size,
                completed_staged_to_dest=delivered_pairs,
            )
            orphaned_root_files = staging_scan["orphaned_root_files"]
        else:
            batch_scan = scan_existing_batch_root(batch_scan_root, batch_size)
            orphaned_root_files = batch_scan["orphaned_root_files"]
        existing_batch_files = batch_scan["existing_batch_files"]
        last_incomplete_batch = batch_scan["last_incomplete_batch"]
        files_in_incomplete_batch = batch_scan["files_in_incomplete_batch"]
        batch_folders = batch_scan["batch_folders"]
        next_available_batch = batch_scan["next_available_batch"]

        if orphaned_root_files > 0:
            root_label = "staging root" if auto_upload else "output root"
            print(f"Found {orphaned_root_files} orphaned files in {root_label} (will be organized into batch)")

        if last_incomplete_batch and files_in_incomplete_batch > 0:
            print(f"Found incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will continue filling it.")

        if batch_folders:
            print(f"Found {existing_batch_files} existing files in {len(batch_folders)} batch folder(s).")
    
    # Total existing files = files in batches + orphaned root files
    total_existing_files = existing_batch_files + orphaned_root_files
    if auto_upload:
        if isinstance(manifest_processed_count, int) and manifest_processed_count >= 0:
            total_existing_files = manifest_processed_count
        elif processed_indices_set:
            total_existing_files = len(processed_indices_set)
    print(f"Total existing processed files: {total_existing_files}")

    # Update previously_processed count for ALL modes (trust and verify)
    # This ensures UI displays actual file count (including duplicates) instead of manifest entry count
    if total_existing_files > 0:
        previously_processed = total_existing_files
        print(f"Previously processed count set to {previously_processed} (actual files on disk)")
    
    
    # Adjust batch counting based on existing files / persisted progress
    # The 'total' now only contains NEW files to process (Fast Pass filtered out existing ones)
    batch_resume_state = resolve_resume_batch_state(
        auto_upload=auto_upload,
        persisted_start_batch=persisted_start_batch,
        total_existing_files=total_existing_files,
        last_incomplete_batch=last_incomplete_batch,
        files_in_incomplete_batch=files_in_incomplete_batch,
        batch_size=batch_size,
        next_available_batch=next_available_batch,
    )
    files_to_complete_batch = batch_resume_state["files_to_complete_batch"]
    start_batch = batch_resume_state["start_batch"]

    if auto_upload and batch_resume_state["resume_incomplete_batch"] and last_incomplete_batch and files_in_incomplete_batch > 0:
        print(f"Auto Upload mode resume state: using processed indices and continuing {last_incomplete_batch}.", flush=True)
        print(f"Detected incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will add {files_to_complete_batch} files to complete it.", flush=True)
    elif auto_upload and next_available_batch > 0:
        print(f"Auto Upload mode resume state: using processed indices and continuing at Batch_{start_batch + 1:02d}.", flush=True)
    elif auto_upload:
        print("Auto Upload mode resume state: using processed indices from the beginning.", flush=True)
    elif batch_resume_state["resume_incomplete_batch"] and last_incomplete_batch and files_in_incomplete_batch > 0:
        if persisted_start_batch > 0:
            print(f"Resuming from persisted state: Starting at Batch_{start_batch + 1:02d}", flush=True)
            print(f"Detected incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will add {files_to_complete_batch} files to complete it.", flush=True)
        else:
            print(f"No persisted state found. Detected incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will add {files_to_complete_batch} files to complete it.", flush=True)
    elif persisted_start_batch > 0:
        print(f"Resuming from persisted state: Starting at Batch_{start_batch + 1:02d}", flush=True)
        print("Current batch is complete or we're starting a new batch.", flush=True)
    elif total_existing_files > 0:
        print(f"No persisted state found. All existing batches valid. Starting at Batch_{start_batch + 1:02d}", flush=True)
    
    # Recalculate number of batches needed for remaining files
    # If we have files_to_complete_batch, the first "batch" of new processing is smaller
    if files_to_complete_batch > 0 and total > 0:
        remaining_after_first = max(0, total - files_to_complete_batch)
        num_batches = start_batch + 1 + max(0, (remaining_after_first + batch_size - 1) // batch_size)
    else:
        num_batches = start_batch + max(1, (total + batch_size - 1) // batch_size)
    
    print(f"Processing {total} new memories. Total batches: {num_batches}, starting at batch {start_batch + 1}.")
    
    # Track processed count for correct indexing into memories list
    memories_processed_so_far = 0
    
    # Track actual files organized (not memory entries)
    # Start with existing files already in the output directory
    total_files_organized = total_existing_files

    def emit_zip_batch_metrics(batch_name, completed_files, batch_started_at):
        if not (ZIP_METRICS_ENABLED and zip_file):
            return
        elapsed = max(0.0001, time.perf_counter() - batch_started_at)
        throughput = completed_files / elapsed
        metrics = snapshot_zip_metrics()
        mb_read = metrics["bytes_read"] / (1024 * 1024)
        print(
            f"[ZIP_METRICS] {batch_name}: throughput={throughput:.2f} files/s, "
            f"lock_wait={metrics['lock_wait_sec']:.3f}s, zip_read={metrics['read_sec']:.3f}s, "
            f"zip_bytes={mb_read:.1f}MB, members={metrics['members']}",
            flush=True
        )
    
    for batch_num in range(start_batch, num_batches):
        if ABORT_PROCESSING.is_set():
            break
            
        # UI UX: Reset progress text to 'Processed: X / Total' immediately when processing starts
        # This replaces 'Verifying...' text and ensures 0% bar start
        if batch_num == start_batch and progress_callback:
             try:
                 progress_callback((total_files_organized, progress_denominator))
             except: pass

        
        # Calculate how many files to process in this batch
        if batch_num == start_batch and files_to_complete_batch > 0:
            # First batch when resuming with incomplete batch: only add enough to complete it
            files_this_batch = min(files_to_complete_batch, total)
        else:
            # Normal batch size, but adjust for remaining files
            files_this_batch = min(batch_size, total - memories_processed_so_far)
        
        if files_this_batch <= 0:
            break  # No more files to process
        
        # Get the slice of memories to process
        start_idx = memories_processed_so_far
        end_idx = memories_processed_so_far + files_this_batch
        batch_memories = memories_with_index[start_idx:end_idx]
        memories_processed_so_far = end_idx
        
        batch_name = f"Batch_{batch_num + 1:02d}"
        batch_dir = os.path.join(AUTO_STAGING_DIR, batch_name) if auto_upload else os.path.join(OUTPUT_DIR, batch_name)
        os.makedirs(batch_dir, exist_ok=True)

        # Set CURRENT_BATCH_DIR so all files are written directly to this batch folder
        global CURRENT_BATCH_DIR
        CURRENT_BATCH_DIR = batch_dir

        print(f"\n--- Processing {batch_name} ({len(batch_memories)} files) ---", flush=True)
        batch_started_at = time.perf_counter()
        if ZIP_METRICS_ENABLED and zip_file:
            reset_zip_metrics()

        if auto_upload:
            enforce_auto_cache_backpressure()
        
        # Check space once per batch to reduce per-file overhead
        check_space_and_wait(os.path.dirname(OUTPUT_DIR))
        
        # Check output directory is still available (detect ejected drives)
        try:
            check_output_directory_available()
        except RuntimeError as e:
            print(f"❌ {e}", flush=True)
            raise
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            # Incremental submission keeps cache overshoot bounded by in-flight workers.
            work_items = deque(enumerate(batch_memories))
            future_to_mem = {}
            batch_count = 0
            batch_success_count = 0
            pause_detected = False
            processed_orig_indices = []  # Track which indices actually completed

            def submit_next_work():
                if ABORT_PROCESSING.is_set() or PAUSE_REQUESTED.is_set() or not work_items:
                    return False
                if auto_upload and upload_manager:
                    enforce_auto_cache_backpressure()
                    if upload_manager.has_fatal():
                        ABORT_PROCESSING.set()
                        return False
                local_idx, (orig_idx, mem) = work_items.popleft()
                future = executor.submit(process_memory, mem, start_idx + local_idx, progress_callback, zip_file, zip_lock)
                future_to_mem[future] = orig_idx
                return True

            while len(future_to_mem) < workers and work_items and not PAUSE_REQUESTED.is_set() and not ABORT_PROCESSING.is_set():
                if not submit_next_work():
                    break

            while future_to_mem:
                if ABORT_PROCESSING.is_set():
                    executor.shutdown(wait=False, cancel_futures=True)
                    break
                done, _ = concurrent.futures.wait(
                    list(future_to_mem.keys()),
                    return_when=concurrent.futures.FIRST_COMPLETED
                )

                for future in done:
                    orig_idx = future_to_mem.pop(future)
                    res = future.result()
                    results.append(res)
                    batch_count += 1

                    # Track which original index completed successfully
                    if res.get('status') != 'Error':
                        processed_orig_indices.append(orig_idx)
                    if res.get('status') == 'Success':
                        batch_success_count += 1
                        if auto_upload and upload_manager:
                            output_file_path = res.get('output_path')
                            if output_file_path:
                                upload_manager.enqueue(output_file_path)

                    if batch_count % 100 == 0:
                        print(f"  {batch_name}: {batch_count}/{len(batch_memories)}...")

                        # Check if output directory still exists (mid-batch ejection detection)
                        try:
                            check_output_directory_available()
                        except RuntimeError as e:
                            print(f"❌ {e}", flush=True)
                            executor.shutdown(wait=False, cancel_futures=True)
                            raise

                if PAUSE_REQUESTED.is_set() and not pause_detected:
                    pause_detected = True
                    in_flight_count = len(future_to_mem)
                    print(f"\n⚠️  Pause requested. Waiting for {in_flight_count} in-flight files to complete...", flush=True)

                if auto_upload and upload_manager and upload_manager.has_fatal():
                    ABORT_PROCESSING.set()
                    executor.shutdown(wait=False, cancel_futures=True)
                    break

                while (
                    not pause_detected
                    and not ABORT_PROCESSING.is_set()
                    and len(future_to_mem) < workers
                    and work_items
                ):
                    if not submit_next_work():
                        break
            
            # If pause was requested, handle graceful cleanup after all in-flight completed
            if pause_detected or PAUSE_REQUESTED.is_set():
                print(f"   All in-flight files completed. {batch_count} files processed in this partial batch.", flush=True)
                
                # Update manifest with ONLY the indices that actually completed
                processed_indices_set.update(processed_orig_indices)
                
                # Count only files added during this run. Resumed incomplete batches may
                # already contain files that are included in total_files_organized.
                files_in_batch = resolve_files_in_batch_for_accounting(batch_success_count)
                total_files_organized += files_in_batch
                emit_zip_batch_metrics(batch_name, files_in_batch, batch_started_at)
                
                # Save manifest with accurate count
                save_batch_progress(
                    batch_num,
                    num_batches,
                    total_files=manifest_total_files,
                    processed_indices=processed_indices_set,
                    zip_fingerprint=zip_fingerprint,
                    output_dir=OUTPUT_DIR,
                    icloud_mode=pause_batches,
                    actual_file_count=total_files_organized,
                    batch_completed=False,
                    raise_on_error=bool(trust_manifest or auto_upload),
                    progress_callback=progress_callback,
                )
                print(f"   ✓ Manifest saved: {total_files_organized} files processed.", flush=True)
                
                # Clean temp directory
                if os.path.exists(TEMP_DIR):
                    try:
                        shutil.rmtree(TEMP_DIR)
                        print(f"   ✓ Cleaned up temp directory.", flush=True)
                    except Exception as e:
                        print(f"   Warning: Could not clean temp directory: {e}", flush=True)
                
                # Send final progress update
                if progress_callback:
                    try:
                        progress_callback((total_files_organized, progress_denominator))
                    except (OSError, IOError): 
                        pass
                
                print("Exiting gracefully after pause.", flush=True)
                if upload_manager:
                    upload_manager.stop(wait=False)
                sys.exit(0)
        
        # Mark indices conservatively if batch was interrupted.
        if batch_memories and not ABORT_PROCESSING.is_set():
            processed_indices_set.update(processed_orig_indices)
        elif ABORT_PROCESSING.is_set():
            processed_indices_set.update(processed_orig_indices)

        # Count only files added during this run. Resumed incomplete batches may
        # already contain files from previous runs that were counted at startup.
        files_in_batch = resolve_files_in_batch_for_accounting(batch_success_count)

        print(f"  {batch_name} complete: {files_in_batch} files processed.", flush=True)
        emit_zip_batch_metrics(batch_name, files_in_batch, batch_started_at)

        # Update cumulative file count
        total_files_organized += files_in_batch
        
        # Send progress update with ACTUAL FILE COUNT (not memory entries)
        if progress_callback:
            try:
                # Use total_files_organized (actual files) for numerator
                # Use progress_denominator (original total memories) for denominator
                progress_callback((total_files_organized, progress_denominator))
            except (OSError, IOError): 
                pass
        
        # Save progress after completing this batch
        save_batch_progress(
            batch_num,
            num_batches,
            total_files=manifest_total_files,
            processed_indices=processed_indices_set,
            zip_fingerprint=zip_fingerprint,
            output_dir=OUTPUT_DIR,
            icloud_mode=pause_batches,
            actual_file_count=total_files_organized,  # Pass actual file count (includes duplicates)
            raise_on_error=bool(trust_manifest or auto_upload),
            progress_callback=progress_callback,
        )

        if ABORT_PROCESSING.is_set():
            break
        
        # === PAUSE FOR CLOUD SYNC ===
        # If pause_batches is True and this is NOT the last batch, pause and wait for resume
        if pause_batches and batch_num < num_batches - 1 and not ABORT_PROCESSING.is_set():
            # Create a signal file path for resume trigger - use PARENT dir (matches main.js)
            resume_signal_file = os.path.join(os.path.dirname(OUTPUT_DIR), RESUME_SIGNAL_FILENAME)
            
            # Remove any stale signal file first
            if os.path.exists(resume_signal_file):
                try:
                    os.remove(resume_signal_file)
                except:
                    pass
            
            pause_msg = json.dumps({
                "type": "batch_pause",
                "batch": batch_num + 1,
                "totalBatches": num_batches,
                "signalFile": resume_signal_file  # Tell Electron where to create the signal
            })
            print(pause_msg, flush=True)
            sys.stdout.flush()  # Force flush to ensure Electron receives it
            
            # Print to stdout so it appears in the app log window
            print(f"DEBUG: Paused. Waiting for resume signal file at: {resume_signal_file}")
            sys.stdout.flush()
            
            # Poll for the resume signal file
            while not ABORT_PROCESSING.is_set() and not PAUSE_REQUESTED.is_set():
                if os.path.exists(resume_signal_file):
                    print("DEBUG: Resume signal file detected! Continuing...", flush=True)
                    sys.stdout.flush()
                    # Remove the signal file
                    try:
                        os.remove(resume_signal_file)
                    except Exception as e:
                        print(f"Warning: Could not remove signal file: {e}", flush=True)
                    print(f"Received RESUME. Continuing to next batch...", flush=True)
                    sys.stdout.flush()
                    break
                # Check every 500ms
                time.sleep(0.5)

            # If pause was requested while waiting, exit gracefully
            if PAUSE_REQUESTED.is_set():
                print(f"\n⚠️  Pause requested during cloud sync. Exiting...", flush=True)
                sys.exit(0)
    
    print(f"\nAll batches processed.")

    cloud_delivery_summary = None
    if upload_manager:
        print("Waiting for uploader queue to drain...", flush=True)
        upload_manager.wait_for_drain()
        enforce_auto_cache_backpressure()
        upload_manager.stop(wait=True)
        if upload_manager.has_fatal():
            fatal_message = upload_manager.fatal_message() or "Auto upload fatal error"
            upload_manager.mark_remaining_failed(fatal_message)
            disk_full_details = get_runtime_disk_full_context()
            if disk_full_details:
                raise RuntimeDiskFullError(disk_full_details.get("message", fatal_message), details=disk_full_details)
            raise RuntimeError(fatal_message)

        remaining_staged_paths = list_staged_media_files(AUTO_STAGING_DIR)
        remaining_staging_bytes = 0
        for staged_path in remaining_staged_paths:
            try:
                remaining_staging_bytes += os.path.getsize(staged_path)
            except OSError:
                pass
        cloud_delivery_summary = {
            "upload_confirmed_in_destination": int(upload_manager.confirmed_count),
            "upload_copied_this_run": int(upload_manager.copied_count),
            "upload_error_events": int(upload_manager.error_count),
            "upload_attempts": int(upload_manager.upload_attempts),
            "upload_remaining_in_staging": int(len(remaining_staged_paths)),
            "upload_remaining_staging_bytes": int(remaining_staging_bytes),
            "destination_dir": AUTO_DESTINATION_DIR,
            "staging_dir": AUTO_STAGING_DIR
        }

    # Keep manifest after completion - allows user to choose Skip/Verify/Start Fresh on next run
    # This prevents duplicate processing and gives users control
    # clear_batch_progress()

    # Cleanup 0-byte placeholders (skip if aborted)
    if not ABORT_PROCESSING.is_set():
        print("Cleaning up 0-byte placeholder files...")
        cleaned = 0
        for root, _, files in os.walk(OUTPUT_DIR):
            if ABORT_PROCESSING.is_set():
                print("Cleanup aborted by user.")
                break
            for f in files:
                if ABORT_PROCESSING.is_set():
                    break
                p = os.path.join(root, f)
                try:
                    if os.path.getsize(p) == 0:
                        os.remove(p)
                        cleaned += 1
                except (OSError, IOError):
                    pass
        if not ABORT_PROCESSING.is_set():
            print(f"Removed {cleaned} placeholder files.")

    # Cleanup Temp Directory (skip if aborted - signal handler will clean it)
    if not ABORT_PROCESSING.is_set() and os.path.exists(TEMP_DIR):
        print(f"Cleaning up temp directory: {TEMP_DIR}")
        try:
            shutil.rmtree(TEMP_DIR)
        except Exception as e:
            print(f"Warning: Could not remove temp dir: {e}")
    
    # Generate Stats - Count ALL files across ALL batches (not just current run)
    # This gives the user the complete picture after multiple resume sessions
    manifest_processed_count = reload_manifest_processed_count(manifest_processed_count)
    success_count = 0
    missing_count = 0
    skipped_count = 0
    duplicate_count = 0
    error_count = 0
    images_count = 0
    videos_count = 0
    total_size = 0
    
    # Count stats from current run's results
    current_run_success = 0
    current_run_duplicates = 0
    current_run_images = 0
    current_run_videos = 0
    for res in results:
        s = res['status']
        if s == 'Success': 
            current_run_success += 1
            file_name = res.get('file') or ''
            if file_name.lower().endswith('.mp4'):
                current_run_videos += 1
            elif file_name:
                current_run_images += 1
        elif s == 'Duplicate': 
            current_run_duplicates += 1
            duplicate_count += 1
        elif s == 'Missing': missing_count += 1
        elif s == 'Skipped': skipped_count += 1
        elif s == 'Error': error_count += 1
    
    # Count TOTAL files for summary.
    if auto_upload:
        success_count = resolve_final_auto_upload_success_count(manifest_processed_count, total_files_organized)
        images_count = current_run_images
        videos_count = current_run_videos
    else:
        for root, _, files in os.walk(OUTPUT_DIR):
            for f in files:
                if f.startswith('.'):
                    continue  # Skip hidden files
                filepath = os.path.join(root, f)
                try:
                    filesize = os.path.getsize(filepath)
                    if filesize > 0:  # Only count non-placeholder files
                        success_count += 1
                        total_size += filesize
                        if f.lower().endswith('.mp4'):
                            videos_count += 1
                        else:
                            images_count += 1
                except (OSError, IOError):
                    pass
    
    print(f"Total files in all batches: {success_count} ({images_count} images, {videos_count} videos)")

    # Count actual files on disk for verification
    actual_files_on_disk = 0
    if auto_upload:
        actual_files_on_disk = success_count
    else:
        try:
            for root, _, files in os.walk(OUTPUT_DIR):
                for f in files:
                    if f.startswith('.'):
                        continue  # Skip hidden files
                    filepath = os.path.join(root, f)
                    try:
                        if os.path.getsize(filepath) > 0:
                            actual_files_on_disk += 1
                    except OSError:
                        pass
        except Exception:
            actual_files_on_disk = -1  # Signal that count failed

    stats = {
        "success": success_count,  # Total files on disk (unique)
        "duplicates": duplicate_count,  # Duplicates from current run
        "missing": missing_count,
        "skipped": skipped_count,
        "errors": error_count,
        "images": images_count,
        "videos": videos_count,
        "total_size": total_size,
        "current_run_new": current_run_success,  # Success entries in report (may include timestamp duplicates)
        "current_run_skipped": current_run_duplicates,  # Duplicates detected this run
        "current_run_images": current_run_images,
        "current_run_videos": current_run_videos,
        "used_trust_manifest": used_trust_manifest,
        "previously_processed": previously_processed,
        "manifest_total_files": manifest_total_files,
        "manifest_processed_count": manifest_processed_count,  # From manifest (source of truth)
        "actual_files_on_disk": actual_files_on_disk,  # Verification count (should match success)
        "report_success_count": current_run_success,  # Number of success entries in report
        "auto_upload": bool(AUTO_UPLOAD_ENABLED)
    }
    if cloud_delivery_summary:
        stats.update(cloud_delivery_summary)

    with open(REPORT_FILE, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"Done! Detailed report saved to {REPORT_FILE}", flush=True)
    print(f"Stats: Success={success_count}, Duplicates={duplicate_count}, Missing={missing_count}, Skipped={skipped_count}, Errors={error_count}", flush=True)

    # Print verification summary to reassure users
    print(f"\n✅ Verification Summary:", flush=True)
    if actual_files_on_disk > 0:
        print(f"   Files on disk: {actual_files_on_disk}", flush=True)

    # Count entries in detailed report for comparison
    report_success_entries = sum(1 for r in results if r.get('status') == 'Success')
    total_accounted = resolve_total_accounted_for_verification(logical_processed_before_run, len(results))
    unrecoverable_count = missing_count + skipped_count

    print(f"   Total memories from export: {manifest_total_files}", flush=True)
    print(f"   Total reviewed: {total_accounted} (Success={success_count}, Duplicates={duplicate_count}, Missing={missing_count}, Skipped={skipped_count}, Errors={error_count})", flush=True)

    # Check for timestamp collisions (same filename from different memories)
    if report_success_entries > success_count:
        collisions = report_success_entries - success_count
        print(f"   Note: {collisions} memories share identical timestamps (created at exact same second)", flush=True)
        print(f"         The later file overwrote the earlier one. Both are in the report.", flush=True)

    if total_accounted == manifest_total_files:
        if unrecoverable_count > 0:
            noun = "memory" if unrecoverable_count == 1 else "memories"
            print(f"   ⚠️  {unrecoverable_count} {noun} could not be recovered from this export.", flush=True)
            print(f"      DateBack reviewed all {manifest_total_files} metadata rows, but only saved {success_count} files.", flush=True)
            if missing_count > 0:
                print(f"      Missing={missing_count}: no usable local media file or download URL.", flush=True)
            if skipped_count > 0:
                print(f"      Skipped={skipped_count}: incomplete or invalid metadata prevented processing.", flush=True)
        elif error_count > 0:
            noun = "memory" if error_count == 1 else "memories"
            print(f"   ⚠️  All {manifest_total_files} metadata rows were reviewed, but {error_count} {noun} ended with errors.", flush=True)
        else:
            print(f"   ✅ All {manifest_total_files} memories recovered!", flush=True)
    else:
        diff = manifest_total_files - total_accounted
        if diff > 0:
            print(f"   ⚠️  {diff} memories missing from verification summary accounting", flush=True)
        else:
            print(f"   ⚠️  Report has {-diff} more entries than expected", flush=True)

    disk_full_details = get_runtime_disk_full_context()
    if disk_full_details:
        raise RuntimeDiskFullError(
            disk_full_details.get("message", "DateBack stopped because the drive ran out of space."),
            details=disk_full_details
        )

    return stats

def process_from_zip(zip_path, output_root=None, limit=None, progress_callback=None, pause_batches=False,
                     trust_manifest=False, auto_upload=False, destination_dir=None, cache_gb=5.0,
                     cache_low_gb=3.0, upload_mode='copy', staging_dir=None, max_upload_retries=20):
    """
    Orchestrates the One-Click workflow:
    1. Open Zip (Stream mode)
    2. Find JSON in Zip
    3. Run processing with Zip context
    """
    if not zip_path or not isinstance(zip_path, str):
        raise ValueError("ZIP path is required.")
    zip_candidate = os.path.abspath(zip_path)
    if not os.path.exists(zip_candidate):
        raise FileNotFoundError(f"ZIP path does not exist: {zip_candidate}")
    zip_lstat = os.lstat(zip_candidate)
    if stat.S_ISLNK(zip_lstat.st_mode):
        raise ValueError("ZIP path cannot be a symbolic link.")
    if not stat.S_ISREG(zip_lstat.st_mode):
        raise ValueError("ZIP path must be a regular file.")
    zip_path = os.path.realpath(zip_candidate)

    if not output_root:
        output_root = os.path.dirname(os.path.abspath(zip_path))

    reset_runtime_disk_full_state()
        
    try:
        if progress_callback: progress_callback(0.05) # Fake small progress
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # 2. Find JSON
            json_path_in_zip = select_memories_history_json_member(zf)
            print(f"Found JSON in ZIP at: {json_path_in_zip}", flush=True)
            json_content = read_memories_history_json(zf, json_path_in_zip)
            
            # Temporary fix: set_config expects a PATH for json, but we have content.
            # We will handle this by passing the content or a dummy path?
            # set_config sets global JSON_PATH. main() reads it.
            # We need to refactor main() to accept json_data directly.
            
            # 3. Configure
            
            # Generate Timestamp from ZIP Filename if possible
            base_zip = os.path.basename(zip_path)
            match = re.search(r'mydata~(\d+)', base_zip)
            
            if match:
                 epoch_ms = int(match.group(1))
                 try:
                     ts_date = datetime.fromtimestamp(epoch_ms / 1000).strftime("%Y-%m-%d")
                     folder_suffix = ts_date
                 except:
                     folder_suffix = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            else:
                 folder_suffix = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            
            processed_dir_name = f"Processed_Memories_{folder_suffix}"
            raw_dl_name = f"Raw_Downloads_{folder_suffix}"
            processed_dir = os.path.join(output_root, processed_dir_name)

            # set_config: processed_dir is where files go, output_root is where temp/corrupted/report go
            set_config("IN_MEMORY", "ZIP_STREAM", processed_dir, raw_dl_name=raw_dl_name, output_root=output_root)
            
            zip_fingerprint = compute_zip_fingerprint(zip_path)
            # Call main with zip context and pre-loaded data
            resolved_staging_dir = (
                os.path.abspath(staging_dir)
                if staging_dir
                else os.path.join(os.path.abspath(output_root), '.staging')
            )
            result = main(
                limit=limit,
                clear_output=False,
                progress_callback=progress_callback,
                zip_file=zf,
                json_data=json_content,
                pause_batches=pause_batches,
                trust_manifest=trust_manifest,
                zip_fingerprint=zip_fingerprint,
                auto_upload=auto_upload,
                destination_dir=destination_dir,
                cache_gb=cache_gb,
                cache_low_gb=cache_low_gb,
                upload_mode=upload_mode,
                staging_dir=resolved_staging_dir,
                max_upload_retries=max_upload_retries
            )
            
            result['processed_dir'] = processed_dir
            return result

    except Exception as e:
        print(f"Critical workflow error: {e}")
        raise e

def retry_failed_entries(
    failed_entries,
    output_root,
    progress_callback=None,
    auto_upload=False,
    destination_dir=None,
    cache_gb=5.0,
    cache_low_gb=3.0,
    upload_mode='copy',
    staging_dir=None,
    max_upload_retries=20
):
    """
    Retry processing only the failed entries from a previous run.
    In auto-upload mode, retried files go through staging -> upload -> delete.
    """
    reset_runtime_disk_full_state()
    results = []
    stats = {'success': 0, 'errors': 0, 'duplicates': 0, 'images': 0, 'videos': 0, 'auto_upload': bool(auto_upload)}

    auto_upload_enabled = bool(auto_upload)
    upload_manager = None
    upload_ledger = None
    retry_enqueued = 0
    resolved_staging_dir = None
    resolved_destination_dir = None

    processing_root = canonicalize_dir_path(output_root)
    output_base_dir = None
    if auto_upload_enabled:
        if not destination_dir:
            raise ValueError("Auto upload retry requires destination_dir.")
        if upload_mode not in ('copy', 'move'):
            raise ValueError("upload_mode must be 'copy' or 'move'.")

        cache_gb = float(cache_gb)
        cache_low_gb = float(cache_low_gb)
        max_upload_retries = int(max_upload_retries)
        if cache_gb <= 0:
            raise ValueError("cache_gb must be > 0.")
        if cache_low_gb < 0 or cache_low_gb > cache_gb:
            raise ValueError("cache_low_gb must be between 0 and cache_gb.")
        if max_upload_retries <= 0:
            raise ValueError("max_upload_retries must be > 0.")

        resolved_staging_dir = canonicalize_dir_path(staging_dir if staging_dir else os.path.join(processing_root, '.staging'))
        resolved_destination_dir = canonicalize_dir_path(destination_dir)

        if resolved_destination_dir == resolved_staging_dir:
            raise ValueError("destination_dir and staging_dir must be different.")
        if is_path_inside(resolved_destination_dir, resolved_staging_dir):
            raise ValueError("destination_dir cannot be inside staging_dir.")
        if is_path_inside(resolved_staging_dir, resolved_destination_dir):
            raise ValueError("staging_dir cannot be inside destination_dir.")
        if is_path_inside(resolved_destination_dir, processing_root):
            raise ValueError("destination_dir cannot be inside the processing output root.")
        if is_path_inside(processing_root, resolved_destination_dir):
            raise ValueError("destination_dir cannot be a parent of the processing output root.")

        preflight_writable_dir(resolved_staging_dir)
        preflight_writable_dir(resolved_destination_dir)

        upload_ledger = UploadLedger(os.path.join(processing_root, UPLOAD_LEDGER_FILE))
        adapter = FolderDestinationAdapter(resolved_destination_dir, upload_mode, staging_dir=resolved_staging_dir)
        upload_manager = AutoUploadManager(
            staging_dir=resolved_staging_dir,
            adapter=adapter,
            ledger=upload_ledger,
            progress_callback=progress_callback,
            cache_gb=cache_gb,
            cache_low_gb=cache_low_gb,
            max_upload_retries=max_upload_retries
        )
        upload_manager.prepare()
        upload_manager.start()
        recovered = upload_manager.recover_pending()
        if recovered > 0:
            upload_manager.emit("upload_progress", force=True, last_file=None, recovered_staged=recovered)

        output_base_dir = resolved_staging_dir
        if RETRY_UPLOAD_DEBUG_ENABLED:
            print(
                f"[RETRY_UPLOAD_DEBUG] auto_upload=1 staging={resolved_staging_dir} destination={resolved_destination_dir} "
                f"cache_gb={cache_gb} cache_low_gb={cache_low_gb} max_retries={max_upload_retries} recovered_staged={recovered}",
                flush=True
            )
    else:
        processed_dirs = [d for d in os.listdir(processing_root) if d.startswith('Processed_Memories')]
        if processed_dirs:
            output_base_dir = os.path.join(processing_root, sorted(processed_dirs)[-1])
        else:
            output_base_dir = os.path.join(processing_root, f"Processed_Memories_{datetime.now().strftime('%Y-%m-%d')}")
        os.makedirs(output_base_dir, exist_ok=True)

    total = len(failed_entries)
    print(f"Retrying {total} failed entries...", flush=True)

    try:
        for idx, entry in enumerate(failed_entries):
            if ABORT_PROCESSING.is_set():
                break

            if progress_callback:
                progress_callback((idx + 1, total))

            try:
                download_url = entry.get('download_url')
                date_str = entry.get('date')
                media_type = entry.get('media_type', 'Image')
                original_file = resolve_retry_display_name(entry, idx)

                if not download_url:
                    print(f"  ⚠️ No download URL for {original_file} - Cannot retry", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'No download URL in report'})
                    continue

                if not date_str:
                    print(f"  ⚠️ No date for {original_file} - Using current time", flush=True)
                    date_str = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')

                print(f"  [{idx + 1}/{total}] Retrying {original_file}...", flush=True)

                can_restore_retry_timestamp = False
                try:
                    dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
                    timestamp_name = dt.strftime('%Y-%m-%d_%H-%M-%S')
                    can_restore_retry_timestamp = True
                except ValueError:
                    timestamp_name = date_str.replace(':', '-').replace(' ', '_')

                if not is_allowed_download_url(download_url):
                    print(f"  ❌ Blocked: Invalid download URL (not from Snapchat CDN)", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'Blocked: Invalid download URL'})
                    continue

                if media_type == 'Video':
                    ext = '.mp4'
                    stats['videos'] += 1
                else:
                    ext = '.jpg'
                    stats['images'] += 1

                if auto_upload_enabled:
                    output_dir = resolve_auto_upload_retry_batch_dir(
                        resolved_staging_dir,
                        resolved_destination_dir,
                        upload_ledger,
                        batch_size=500,
                    )
                else:
                    batch_folders = sorted([
                        d for d in os.listdir(output_base_dir)
                        if d.startswith('Batch_') and os.path.isdir(os.path.join(output_base_dir, d))
                    ])

                    if batch_folders:
                        last_batch = batch_folders[-1]
                        last_batch_dir = os.path.join(output_base_dir, last_batch)
                        files_in_last_batch = len([
                            f for f in os.listdir(last_batch_dir)
                            if os.path.isfile(os.path.join(last_batch_dir, f))
                        ])
                        if files_in_last_batch >= 500:
                            batch_num = int(last_batch.split('_')[1])
                            new_batch_name = f"Batch_{batch_num + 1:02d}"
                            output_dir = os.path.join(output_base_dir, new_batch_name)
                            os.makedirs(output_dir, exist_ok=True)
                        else:
                            output_dir = last_batch_dir
                    else:
                        output_dir = output_base_dir

                base_name = f"{timestamp_name}{ext}"
                output_path = os.path.join(output_dir, base_name)

                counter = 1
                while os.path.exists(output_path):
                    base_name = f"{timestamp_name}_{counter}{ext}"
                    output_path = os.path.join(output_dir, base_name)
                    counter += 1

                try:
                    atomic_write_stream_to_file(
                        lambda temp_path: stream_download_to_path(download_url, temp_path, timeout=60),
                        output_path
                    )
                except ExpiredDownloadLinkError as e:
                    print(f"  ❌ {e}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'Download link expired'})
                    continue
                except requests.exceptions.HTTPError as e:
                    status_code = getattr(getattr(e, 'response', None), 'status_code', None)
                    if status_code is not None:
                        print(f"  ❌ Download failed: HTTP {status_code}", flush=True)
                        stats['errors'] += 1
                        results.append({**entry, 'retry_status': 'Error', 'retry_reason': f'HTTP {status_code}'})
                        continue
                    print(f"  ❌ Download failed: {e}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': f'Download error: {e}'})
                    continue
                except ValueError as e:
                    print(f"  ❌ Download aborted: {e}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': str(e)})
                    continue
                except Exception as e:
                    print(f"  ❌ Download failed: {e}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': f'Download error: {e}'})
                    continue

                if is_zip_file(output_path):
                    overlay_reason = (
                        "Overlay retry unavailable: retry reports do not preserve enough source ZIP/overlay metadata "
                        "to reconstruct overlay media safely."
                    )
                    try:
                        safe_delete(output_path, output_dir)
                    except Exception:
                        pass
                    print(f"  ⚠️ {overlay_reason}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': overlay_reason})
                    continue

                if retry_entry_may_require_overlay_metadata(entry) and not retry_entry_has_overlay_source_metadata(entry):
                    print(
                        "  ⚠️ Overlay retry note: detailed_report.json does not include source ZIP/overlay members; "
                        "retry can only redownload flat media.",
                        flush=True
                    )

                if can_restore_retry_timestamp:
                    try:
                        apply_retry_timestamp(output_path, date_str)
                    except OSError as e:
                        print(f"  ⚠️ Could not restore original timestamp: {e}", flush=True)

                if upload_manager:
                    upload_manager.enqueue(output_path)
                    retry_enqueued += 1
                    if RETRY_UPLOAD_DEBUG_ENABLED:
                        print(f"[RETRY_UPLOAD_DEBUG] enqueued staged file: {short_display_path(output_path)}", flush=True)

                print(f"  ✅ Saved: {base_name}", flush=True)
                stats['success'] += 1
                result_entry = {**entry, 'retry_status': 'Success', 'output_file': base_name}
                if auto_upload_enabled:
                    result_entry['_staged_path'] = output_path
                results.append(result_entry)

            except Exception as e:
                print(f"  ❌ Error: {e}", flush=True)
                stats['errors'] += 1
                results.append({**entry, 'retry_status': 'Error', 'retry_reason': str(e)})

        if upload_manager:
            if RETRY_UPLOAD_DEBUG_ENABLED:
                print(f"[RETRY_UPLOAD_DEBUG] waiting for uploader drain; enqueued={retry_enqueued}", flush=True)
            upload_manager.wait_for_drain()
            upload_manager.stop(wait=True)
            if upload_manager.has_fatal():
                fatal_message = upload_manager.fatal_message() or "Auto upload fatal error during retry"
                upload_manager.mark_remaining_failed(fatal_message)
                raise RuntimeError(fatal_message)

            delivered = 0
            for result in results:
                staged_path = result.get('_staged_path')
                if not staged_path or result.get('retry_status') != 'Success':
                    continue
                done_record = upload_ledger.get_done_record_for_staged_path(staged_path) if upload_ledger else None
                if done_record and done_record.get("dest_path"):
                    result['output_file'] = os.path.basename(done_record.get("dest_path"))
                    delivered += 1
                else:
                    result['retry_status'] = 'Error'
                    result['retry_reason'] = 'Upload to destination did not complete'
                    stats['success'] = max(0, stats['success'] - 1)
                    stats['errors'] += 1

            if RETRY_UPLOAD_DEBUG_ENABLED:
                print(
                    f"[RETRY_UPLOAD_DEBUG] drain complete; attempts={upload_manager.upload_attempts} "
                    f"uploaded={upload_manager.uploaded_count} confirmed={upload_manager.confirmed_count} copied={upload_manager.copied_count} delivered={delivered}",
                    flush=True
                )

            remaining_staged_paths = list_staged_media_files(resolved_staging_dir)
            remaining_staging_bytes = 0
            for staged_path in remaining_staged_paths:
                try:
                    remaining_staging_bytes += os.path.getsize(staged_path)
                except OSError:
                    pass

            stats.update({
                "upload_confirmed_in_destination": int(upload_manager.confirmed_count),
                "upload_copied_this_run": int(upload_manager.copied_count),
                "upload_error_events": int(upload_manager.error_count),
                "upload_attempts": int(upload_manager.upload_attempts),
                "upload_remaining_in_staging": int(len(remaining_staged_paths)),
                "upload_remaining_staging_bytes": int(remaining_staging_bytes),
                "destination_dir": resolved_destination_dir,
                "staging_dir": resolved_staging_dir
            })

    finally:
        if upload_manager:
            upload_manager.stop(wait=True)

    report_path = os.path.join(processing_root, 'detailed_report.json')
    try:
        with open(report_path, 'r') as f:
            full_report = json.load(f)

        for result in results:
            if result.get('retry_status') != 'Success':
                continue
            result_id = result.get('id')
            for i, existing in enumerate(full_report):
                if existing.get('id') == result_id:
                    full_report[i]['status'] = 'Success'
                    full_report[i]['file'] = result.get('output_file')
                    full_report[i]['retry_status'] = 'Success'
                    break

        atomic_write_text(report_path, json.dumps(full_report, indent=2))
        print(f"Updated {report_path}", flush=True)
    except Exception as e:
        print(f"Could not update report: {e}", flush=True)

    print(f"\nRetry Summary: {stats['success']} succeeded, {stats['errors']} failed", flush=True)
    return stats

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Process Snapchat Memories')
    parser.add_argument('--zip', required=True, help='Path to the Snapchat data ZIP file')
    parser.add_argument('--output', required=True, help='Output directory for processed memories')
    parser.add_argument('--pause-batches', action='store_true', help='Pause between batches for iCloud sync')
    parser.add_argument('--trust-manifest', action='store_true', help='Trust manifest file for resume')
    parser.add_argument('--auto-upload', action='store_true', help='Enable automatic upload from staging to destination')
    parser.add_argument('--destination-dir', help='Destination folder for auto upload')
    parser.add_argument('--cache-gb', type=float, default=5.0, help='Pause processing when staging exceeds this size (GB)')
    parser.add_argument('--cache-low-gb', type=float, default=3.0, help='Resume processing when staging drops below this size (GB)')
    parser.add_argument('--upload-mode', choices=['copy', 'move'], default='copy', help='Upload mode for destination adapter')
    parser.add_argument('--staging-dir', help='Optional custom staging directory')
    parser.add_argument('--max-upload-retries', type=int, default=20, help='Maximum upload retries per staged file before fatal exit')
    
    args = parser.parse_args()
    if args.auto_upload and not args.destination_dir:
        parser.error("--destination-dir is required with --auto-upload")

    # Define progress callback for Electron IPC
    def progress_update(data):
        """Send progress updates to Electron via stdout as JSON"""
        if isinstance(data, tuple):
            # (count, total) tuple format
            count, total = data
            msg = json.dumps({"type": "progress", "count": count, "total": total})
            print(msg, flush=True)
            sys.stdout.flush()
        else:
            # Already formatted message (e.g., batch_pause)
            print(json.dumps(data), flush=True)
            sys.stdout.flush()

    # Use the existing process_from_zip function which handles everything correctly
    try:
        result = process_from_zip(
            zip_path=args.zip,
            output_root=args.output,
            progress_callback=progress_update,
            pause_batches=args.pause_batches,
            trust_manifest=args.trust_manifest,
            auto_upload=args.auto_upload,
            destination_dir=args.destination_dir,
            cache_gb=args.cache_gb,
            cache_low_gb=args.cache_low_gb,
            upload_mode=args.upload_mode,
            staging_dir=args.staging_dir,
            max_upload_retries=args.max_upload_retries
        )

        # Send completion message to Electron
        if result:
            completion_msg = json.dumps({"type": "complete", "stats": result})
            print(completion_msg, flush=True)
            sys.stdout.flush()

    except Exception as e:
        print(f"Error: {e}", flush=True)
        sys.exit(1)
