import json
import os
import sys
import shutil
import zipfile
import subprocess
import requests
from requests.adapters import HTTPAdapter
import secrets  # For secure random temp file names
from datetime import datetime, timezone
from PIL import Image
import mimetypes
import time
import threading
import re
import errno
import concurrent.futures
import signal

# Global Abort Flag
ABORT_PROCESSING = threading.Event()

# Graceful Pause Flag - stops new work but lets in-flight complete
PAUSE_REQUESTED = threading.Event()

# Disk Space Thresholds (in GB)
MIN_FREE_GB = 2.0      # Pause processing when free space drops below this
RESUME_FREE_GB = 3.0   # Resume processing when free space exceeds this
POLL_INTERVAL_SEC = 10 # Seconds between disk space checks when paused

# Expired Link Detection - abort after N consecutive 403/410 errors
EXPIRED_LINK_THRESHOLD = 5  # Number of consecutive failures before abort
expired_link_counter = 0    # Global counter for consecutive expired link errors
expired_link_lock = threading.Lock()  # Thread-safe counter access

# Download URL Security - prevent SSRF and disk exhaustion
ALLOWED_HOST_SUFFIXES = ("sc-cdn.net", "snapchat.com", "snap-dev.net")  # Snapchat CDNs only
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2GB per file limit

# Configuration
JSON_PATH = 'mydata~1766711891202/json/memories_history.json'
DOWNLOADS_DIR = 'Memories'
OUTPUT_DIR = 'Processed_Memories'
TEMP_DIR = 'temp_processing'
CORRUPTED_DIR = 'Corrupted_Memories'
REPORT_FILE = 'detailed_report.json'
RAW_DL_NAME = 'Raw_Downloads' # Default
FFMPEG_PATH = os.environ.get('FFMPEG_PATH', 'ffmpeg')  # Use bundled ffmpeg if available

# CURRENT_BATCH_DIR: The active batch folder where files should be written
# This is set dynamically during batch processing to avoid orphaned files
CURRENT_BATCH_DIR = None

filename_lock = threading.Lock()
_session_local = threading.local()

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
            if zip_lock:
                with zip_lock:
                    with zip_file.open(file_path) as f:
                        header = f.read(4)
            else:
                with zip_file.open(file_path) as f:
                    header = f.read(4)
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

def is_allowed_download_url(url):
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
        
        # Must match allowed Snapchat CDN suffixes
        return any(hostname.endswith(suffix) for suffix in ALLOWED_HOST_SUFFIXES)
    except Exception:
        return False

def safe_extract(zf, extract_dir):
    """
    Extract ZIP with Zip Slip protection and symlink blocking.
    Validates all paths before extraction to prevent path traversal attacks.
    SECURITY: Blocks symlink entries to prevent local file disclosure.
    """
    for member in zf.namelist():
        # Get the ZipInfo object for this member
        member_info = zf.getinfo(member)
        
        # SECURITY: Check for symlinks (Unix file type in external_attr)
        # Symlinks have file type 0xA (S_IFLNK) in the high byte
        # external_attr format: (file_mode << 16) | dos_attributes
        unix_mode = member_info.external_attr >> 16
        if unix_mode & 0xA000 == 0xA000:  # S_IFLNK = 0xA000
            print(f"⚠️  SECURITY: Blocked symlink entry in ZIP: {member}", flush=True)
            continue  # Skip this entry instead of raising to allow rest of extraction
        
        # Normalize and check for path traversal
        member_path = os.path.normpath(member)
        if member_path.startswith('..') or os.path.isabs(member_path):
            raise ValueError(f"Illegal file path in ZIP: {member}")
        
        target_path = os.path.join(extract_dir, member_path)
        # Double-check: resolved path must be within extract_dir
        if not os.path.abspath(target_path).startswith(os.path.abspath(extract_dir) + os.sep):
            raise ValueError(f"Path traversal detected: {member}")
    
    zf.extractall(extract_dir)

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

def save_batch_progress(batch_num, total_batches, total_files=None, processed_indices=None, zip_fingerprint=None, output_dir=None, icloud_mode=None, actual_file_count=None):
    """Save the current batch progress to disk."""
    try:
        progress_file = get_batch_progress_file()
        data = {
            "last_completed_batch": batch_num,
            "total_batches": total_batches,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if total_files is not None:
            data["total_files"] = total_files
        if processed_indices is not None:
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
        with open(progress_file, 'w') as f:
            json.dump(data, f)
    except Exception as e:
        print(f"Warning: Could not save batch progress: {e}", flush=True)

def load_batch_progress():
    """Load the last batch progress. Returns the batch number to start from (0-indexed)."""
    try:
        data = load_batch_manifest()
        if data:
            last_completed = data.get("last_completed_batch", -1)
            print(f"Resuming: Last completed batch was {last_completed + 1}. Starting from batch {last_completed + 2}.", flush=True)
            return last_completed + 1  # Start from next batch
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
    global JSON_PATH, DOWNLOADS_DIR, OUTPUT_DIR, TEMP_DIR, CORRUPTED_DIR, REPORT_FILE, RAW_DL_NAME
    JSON_PATH = json_path
    DOWNLOADS_DIR = downloads_dir

    if output_dir:
        # Validate output path - prevent path traversal
        abs_output = os.path.abspath(output_dir)
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
                raise ValueError(f"Cannot use external drive root. Please create a subfolder (e.g., /Volumes/{drive_name}/MemSavr_Output)")

        OUTPUT_DIR = abs_output

    if raw_dl_name:
        RAW_DL_NAME = raw_dl_name

    # Determine the root directory for temp/corrupted/report
    # If output_root is provided, use it (for process_from_zip)
    # Otherwise use OUTPUT_DIR (for legacy direct calls)
    base_dir = output_root if output_root else OUTPUT_DIR

    # Update derived paths - place temp/corrupted/report in the base directory (user-selected folder)
    # But processed files go in OUTPUT_DIR (which might be Processed_Memories_YYYY-MM-DD subfolder)
    TEMP_DIR = os.path.join(base_dir, 'temp_processing')
    CORRUPTED_DIR = os.path.join(base_dir, 'Corrupted_Memories')
    REPORT_FILE = os.path.join(base_dir, 'detailed_report.json')
    
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
            print(f"   MemSavr is waiting and checking space every {POLL_INTERVAL_SEC} seconds...", flush=True)
            
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

def build_processed_index(output_dir):
    print("Building processed file index (recursion enabled)...", flush=True)
    global processed_index
    processed_index = {}
    for root, _, files in os.walk(output_dir):
        for f in files:
            if f.startswith('.'): continue
            try:
                p = os.path.join(root, f)
                processed_index[f] = os.path.getsize(p)
            except (OSError, IOError): pass
    print(f"Processed Index built. Found {len(processed_index)} existing files.", flush=True)

def build_file_index_from_zip(zip_file_obj):
    print("Building file index directly from ZIP...", flush=True)
    global file_size_index, zip_name_index
    # We clear it? Or merge? Usually clear for new run.
    file_size_index = {}
    zip_name_index = {}
    
    count = 0
    for info in zip_file_obj.infolist():
        if info.is_dir(): continue
        
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
        count += 1
        
    print(f"ZIP Index built. Found {count} files.", flush=True)

def process_zip(zip_path, output_path, ts_epoch=None):
    zip_name = os.path.basename(zip_path)
    extract_dir = os.path.join(TEMP_DIR, zip_name + "_extract")
    os.makedirs(extract_dir, exist_ok=True)

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
        
        final_output = None
        
        if (mime and mime.startswith('video')) or main_file.endswith('.mp4'):
            ext = ".mp4"
            final_output = base_path_no_ext + ext
            
            # CRITICAL: Re-check collision with lock now that we know it is .mp4
            with filename_lock:
                 base_root = base_path_no_ext
                 counter = 1
                 while os.path.exists(final_output):
                     final_output = f"{base_root}_{counter}{ext}"
                     counter += 1
                 # NOTE: No placeholder needed - atomic move creates file
            
            result_msg = ""
            if overlay_file:
                # Use temp file for atomic write
                temp_output = final_output + ".tmp"
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
                    # Atomic move: only move if ffmpeg succeeded
                    shutil.move(temp_output, final_output)
                    result_msg = "Success (Video Merge)"
                except (subprocess.CalledProcessError, FileNotFoundError) as e:
                    # Cleanup temp file
                    if os.path.exists(temp_output):
                        try:
                            os.remove(temp_output)
                        except: pass
                    
                    # Fallback: copy main file without overlay
                    shutil.copy2(main_file, final_output)
                    result_msg = "Success (Video Extract - No Overlay)"
            else:
                shutil.copy2(main_file, final_output)
                result_msg = "Success (Video Extract)"
            
            if ts_epoch:
                try:
                    os.utime(final_output, (ts_epoch, ts_epoch))
                except (OSError, IOError): pass
            
            return {"status": "Success", "reason": result_msg, "file": os.path.basename(final_output)}
        
        else:
            ext = ".jpg"
            final_output = base_path_no_ext + ext
            
            with filename_lock:
                 base_root = base_path_no_ext
                 
                 # Reserve a unique filename
                 counter = 1
                 final_dest = base_path_no_ext + ext
                 while os.path.exists(final_dest):
                     final_dest = f"{base_root}_{counter}{ext}"
                     counter += 1
                 final_output = final_dest
                 # NOTE: No placeholder needed - atomic move creates file

            result_msg = ""
            if overlay_file:
                # Use temp file to prevent 0-byte files on failure
                temp_output = final_output + ".tmp"
                try:
                    with Image.open(main_file) as main_img:
                        with Image.open(overlay_file) as overlay_img:
                            main_img = main_img.convert("RGBA")
                            overlay_img = overlay_img.convert("RGBA")
                            if main_img.size != overlay_img.size:
                               overlay_img = overlay_img.resize(main_img.size, Image.Resampling.LANCZOS)
                            combined = Image.alpha_composite(main_img, overlay_img)
                            combined = combined.convert("RGB")
                            # Save to temp file first
                            combined.save(temp_output, "JPEG")
                            combined.close()  # Explicit cleanup
                            del combined       # Help GC
                    
                    # Atomic move: only move if save succeeded
                    shutil.move(temp_output, final_output)
                    result_msg = "Success (Image Merge)"
                    
                except Exception as e:
                    # Cleanup temp file if it exists
                    if os.path.exists(temp_output):
                        try:
                            os.remove(temp_output)
                        except: pass
                    
                    # Remove placeholder (0-byte or corrupted)
                    if os.path.exists(final_output):
                        try:
                            os.remove(final_output)
                        except: pass
                    
                    return {"status": "Error", "reason": f"Merge failed: {str(e)}", "file": zip_name}
            else:
                shutil.copy2(main_file, final_output)
                result_msg = "Success (Image Extract)"
            
            if ts_epoch:
                try:
                    os.utime(final_output, (ts_epoch, ts_epoch))
                except (OSError, IOError): pass
                
            return {"status": "Success", "reason": result_msg, "file": os.path.basename(final_output)}

    except zipfile.BadZipFile:
        return {"status": "Error", "reason": "Bad Zip File", "file": zip_name}
    except Exception as e:
        return {"status": "Error", "reason": str(e), "file": zip_name}
    finally:
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

def fast_pass_check(memories, output_dir, progress_callback=None):
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
    
    # Pre-scan existing files under output_dir to avoid repeated disk lookups.
    existing_files = set()
    for root, dirs, files in os.walk(output_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if f.startswith('.'):
                continue
            path = os.path.join(root, f)
            try:
                if os.path.getsize(path) == 0:
                    continue
            except OSError:
                continue
            existing_files.add(f)
    
    for i, memory in enumerate(memories):
        date_str = memory.get('Date')
        media_type = memory.get('Media Type', 'Image')
        
        if not date_str:
            continue
            
        # Construct expected filename using same logic as process_memory
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
            timestamp_name = dt.strftime('%Y-%m-%d_%H-%M-%S')
        except ValueError:
            continue
        
        # Determine extension
        ext = ".mp4" if media_type == "Video" else ".jpg"
        expected_filename = f"{timestamp_name}{ext}"
        expected_path = os.path.join(output_dir, expected_filename)
        
        # Check if file exists (or any numbered variant like _1, _2, etc.)
        file_found = False
        if expected_filename in existing_files:
            existing += 1
            existing_indices.add(i)
            file_found = True
        else:
            # Check for numbered variants (same timestamp = multiple files)
            # This handles cases like 2023-10-01_14-30-00_1.jpg
            for suffix in range(1, 10):  # Check up to _9 variants
                variant_name = f"{timestamp_name}_{suffix}{ext}"
                if variant_name in existing_files:
                    existing += 1
                    existing_indices.add(i)
                    file_found = True
                    break
        
        # Progress update every 500 files
        # DISABLED: Don't send progress during verification as it confuses the UI
        # if progress_callback and i % 500 == 0:
        #     try:
        #         progress_callback((i, total))
        #     except:
        #         pass
    
    all_exist = existing >= total
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
        return {"id": mem_id, "status": "Error", "reason": "DISK_FULL: Processing aborted due to full disk.", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}

    if not date_str or not download_url:
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
        # ZIP workflow: skip HEAD and match by filename when possible
        remote_size = None
        url_name = os.path.basename(download_url.split('?', 1)[0])
        if url_name:
            matches = zip_name_index.get(url_name)
        if not matches:
            # Allow download fallback without HEAD when ZIP lookup fails
            remote_size = 0
    else:
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
                  # SECURITY: Disable redirects during download to prevent redirect-based attacks
                 with session.get(download_url, stream=True, timeout=30, allow_redirects=False) as r:
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
                     with open(dl_path, 'wb') as f:
                         for chunk in r.iter_content(chunk_size=8192):
                             if chunk:  # filter out keep-alive new chunks
                                 downloaded_bytes += len(chunk)
                                 if downloaded_bytes > MAX_DOWNLOAD_BYTES:
                                     # Abort - file exceeds size limit
                                     raise ValueError(f"Download exceeded max size limit: {MAX_DOWNLOAD_BYTES / (1024**3):.2f}GB")
                                 f.write(chunk)
             
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
                ABORT_PROCESSING.set()
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
    # Detect if this is actually a ZIP file by reading magic bytes
    # CRITICAL: Downloaded overlay ZIPs may have .jpg extension based on Media Type
    is_actual_zip = is_zip_file(local_path, zip_file, zip_lock) or local_filename.lower().endswith('.zip')

    if not is_actual_zip:
        # DUPLICATE CHECK FOR NON-ZIP
        # We know local_path exists and has a size
        if zip_file and not os.path.isabs(local_path):
            try:
                local_size = zip_file.getinfo(local_path).file_size
            except KeyError:
                return {"id": mem_id, "status": "Error", "reason": f"ZIP entry not found: {local_path}", "file": None, "date": date_str, "download_url": download_url, "media_type": media_type}
        else:
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

    # CRITICAL: Generate the output path but DON'T create placeholder yet
    # Placeholder will be created inside try block to ensure cleanup coverage
    with filename_lock:
        output_path = os.path.join(target_dir, f"{base_name}{ext}")
        while os.path.exists(output_path):
            output_path = os.path.join(target_dir, f"{base_name}_{counter}{ext}")
            counter += 1
        # NOTE: Removed placeholder creation from here - moved into try block

    try:
        if is_actual_zip:
             # Handle Nested ZIP (Memories Overlay)
             # NOTE: No placeholder needed - process_zip creates its own files atomically
             if zip_file and not os.path.isabs(local_path):
                 # Extract temp
                 temp_zip_path = os.path.join(TEMP_DIR, f"inner_{mem_id}_{secrets.token_hex(4)}.zip")  # Random suffix
                 with zip_file.open(local_path) as src, open(temp_zip_path, 'wb') as dst:
                     shutil.copyfileobj(src, dst)
                 
                 res = process_zip(temp_zip_path, output_path, ts_epoch)
                 res['id'] = mem_id
                 
                 if res['status'] == 'Error':
                     try:
                         shutil.copy2(temp_zip_path, os.path.join(CORRUPTED_DIR, local_filename))
                     except (OSError, IOError): pass
                 
                 try: os.remove(temp_zip_path) 
                 except (OSError, IOError): pass
                 
                 # Cleanup if temp download (the outer zip itself)
                 if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                      try: os.remove(local_path) 
                      except (OSError, IOError): pass
                      
                 return res
             else:
                 res = process_zip(local_path, output_path, ts_epoch)
                 res['id'] = mem_id
                 if res['status'] == 'Error':
                     try:
                         shutil.copy2(local_path, os.path.join(CORRUPTED_DIR, local_filename))
                     except Exception: pass
                 return res

        else:
            # Streaming Copy or FS Copy
            # Create placeholder NOW (only for non-ZIP files, inside try for cleanup)
            open(output_path, 'a').close()
            
            if zip_file and not os.path.isabs(local_path):
                 # local_path is relative ZIP path
                 
                 # Optimization: Chunked Copy with Lock to allow concurrency
                 # If we lock the whole copy, it's sequential. 
                 # If we lock only reads, we interleave.
                 
                 chunk_size = 1024 * 1024 * 2 # 2MB chunks
                 with open(output_path, 'wb') as dst:
                     # We must lock the OPEN as well if it seeks? 
                     # zf.open returns a ZipExtFile. 
                     # We need to lock the creation of the handle AND the reads?
                     # Actually, ZipFile.open modifies the shared file pointer.
                     # So we must lock around 'with zip_file.open(...)'. 
                     # BUT if we hold lock while 'src' is open, we hold it for the whole duration of use?
                     # NO. ZipExtFile maintains its own position? 
                     # Python's zipfile module is NOT thread safe. concurrent reads will corrupt.
                     # The handle returned by open() shares the underlying file object.
                     # So we MUST hold the lock whenever we call read() on the handle.
                     pass 
                     
                     # Wait, if we can't have concurrent open handles, we can't interleave?
                     # Correct. Standard ZipFile cannot support concurrent open handles efficiently because they seek the underlying file.
                     # UNLESS we open the zip file multiple times? (Multiple file handles to disk).
                     # That would allow true concurrency.
                     # But we are passing `zip_file` object.
                     
                     # Fallback: Locked Read, Unlocked Write.
                     # We must acquire lock, create handle, read chunk, release lock?
                     # We can't keep handle open across lock release if other threads seek the file.
                     # This is tricky.
                     
                     # Simple Solution: Lock the ENTIRE extract of one file.
                     # This effectively serializes the ZIP reading part.
                     # But allows writing to disk to happen "concurrently" with OTHER tasks?
                     # No, if we hold lock, other threads wait.
                     # But `process_memory` does other things (metadata, timestamp, DB check).
                     # So locking only the COPY part is better than serializing the whole loop.
                     
                     if zip_lock:
                         with zip_lock:
                             with zip_file.open(local_path) as src:
                                 shutil.copyfileobj(src, dst)
                     else:
                          # Fallback (Safety)
                          with zip_file.open(local_path) as src:
                              shutil.copyfileobj(src, dst)
                              
            else:
                 # Standard copy
                 shutil.copy2(local_path, output_path)

            if ts_epoch:
                try:
                    os.utime(output_path, (ts_epoch, ts_epoch))
                except (OSError, IOError): pass
            # Cleanup if temp download
            if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
                 try: os.remove(local_path) 
                 except (OSError, IOError): pass
            return {"id": mem_id, "status": "Success", "reason": "Processed (Streamed)" if zip_file else "Processed (Local)", "file": os.path.basename(output_path)}
    except Exception as e:
        if os.path.exists(output_path) and os.path.getsize(output_path) == 0:
             try: os.remove(output_path) 
             except (OSError, IOError): pass
        
        try:
             if os.path.exists(local_path):
                 target_corrupt = os.path.join(CORRUPTED_DIR, local_filename)
                 # Ensure unique name in corrupted dir
                 if os.path.exists(target_corrupt):
                     base, ext = os.path.splitext(local_filename)
                     target_corrupt = os.path.join(CORRUPTED_DIR, f"{base}_{int(time.time())}{ext}")
                 shutil.copy2(local_path, target_corrupt)
                 print(f"Saved corrupted file to: {target_corrupt}")
        except Exception as copy_err:
             print(f"Failed to copy to corrupted: {copy_err}")

        if local_path and TEMP_DIR in local_path and os.path.exists(local_path):
            try: os.remove(local_path) 
            except (OSError, IOError): pass
        return {"id": mem_id, "status": "Error", "reason": str(e), "file": local_filename, "date": date_str, "download_url": download_url, "media_type": media_type}

def main(limit=None, clear_output=True, progress_callback=None, zip_file=None, json_data=None, pause_batches=False, trust_manifest=False, zip_fingerprint=None):
    # Declare global variable at the top of the function
    global ORIGINAL_TOTAL_MEMORIES
    
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

    if trust_manifest:
        print("Resume mode: Skip Files Already Processed", flush=True)
        manifest = load_batch_manifest()
        if not manifest:
            print("Warning: Manifest missing or corrupted; falling back to Verify Files.", flush=True)
            trust_manifest = False
        else:
            manifest_zip = manifest.get("zip_fingerprint")
            if manifest_zip and zip_fingerprint and manifest_zip != zip_fingerprint:
                raise ValueError("ZIP export does not match previous run. Please choose Verify Files or Start Fresh.")

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
            else:
                print("Warning: Manifest missing processed indices; falling back to Verify Files.", flush=True)
                trust_manifest = False

        if trust_manifest and processed_indices_set:
            # Note: previously_processed will be updated later after scanning batch folders
            # This ensures we count actual files on disk, not just manifest entries
            ORIGINAL_TOTAL_MEMORIES = len(memories)
            memories_with_index = [(i, m) for i, m in memories_with_index if i not in processed_indices_set]
            print(f"Skip Files Already Processed: Skipping {len(processed_indices_set)} previously processed memories.", flush=True)
    else:
        print("Resume mode: Verify Files", flush=True)

    used_trust_manifest = bool(trust_manifest)

    # === FAST PASS PRE-CHECK ===
    # If not clearing output, check if all files already exist on disk
    existing_indices = set()  # Track which memories already exist
    if not trust_manifest and not clear_output and os.path.exists(OUTPUT_DIR):
        print("Verifying existing files...", flush=True)
        
        # Send status update to UI
        if progress_callback:
            try:
                progress_callback((-1, len(memories)))  # -1 signals "verifying" phase
            except:
                pass
        
        all_exist, existing_count, total_count, existing_indices = fast_pass_check(memories, OUTPUT_DIR, progress_callback)
        
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
    
    # Build File Index
    if zip_file:
        build_file_index_from_zip(zip_file)
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
                raise ValueError(f"Cannot use external drive root. Please create a subfolder (e.g., /Volumes/{drive_name}/MemSavr_Output)")
        
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
    if not clear_output:
        build_processed_index(OUTPUT_DIR)
    else:
        global processed_index
        processed_index = {} # Reset

    print("Starting processing...")
    results = []
    
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
    existing_batch_files = 0
    orphaned_root_files = 0  # Files in OUTPUT_DIR root (not in batch folders)
    last_incomplete_batch = None
    files_in_incomplete_batch = 0
    
    if os.path.exists(OUTPUT_DIR):
        # First, count files in the OUTPUT_DIR ROOT (orphaned from interrupted processing)
        # These are files that were downloaded but never moved into a batch folder
        root_files = [f for f in os.listdir(OUTPUT_DIR) 
                     if os.path.isfile(os.path.join(OUTPUT_DIR, f)) and not f.startswith('.')]
        orphaned_root_files = len(root_files)
        
        if orphaned_root_files > 0:
            print(f"Found {orphaned_root_files} orphaned files in output root (will be organized into batch)")
        
        # Scan for existing Batch_XX folders
        batch_folders = sorted([d for d in os.listdir(OUTPUT_DIR) 
                               if d.startswith('Batch_') and os.path.isdir(os.path.join(OUTPUT_DIR, d))])
        
        if batch_folders:
            # Count total files in all batches
            for batch_folder in batch_folders:
                batch_path = os.path.join(OUTPUT_DIR, batch_folder)
                files_in_batch = len([f for f in os.listdir(batch_path) 
                                     if os.path.isfile(os.path.join(batch_path, f)) and not f.startswith('.')])
                existing_batch_files += files_in_batch
                
                # Check if this batch is incomplete (less than batch_size)
                if files_in_batch < batch_size:
                    last_incomplete_batch = batch_folder
                    files_in_incomplete_batch = files_in_batch
            
            if last_incomplete_batch and files_in_incomplete_batch > 0:
                print(f"Found incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will continue filling it.")
            
            print(f"Found {existing_batch_files} existing files in {len(batch_folders)} batch folder(s).")
    
    # Total existing files = files in batches + orphaned root files
    total_existing_files = existing_batch_files + orphaned_root_files
    print(f"Total existing processed files: {total_existing_files}")

    # Update previously_processed count for ALL modes (trust and verify)
    # This ensures UI displays actual file count (including duplicates) instead of manifest entry count
    if total_existing_files > 0:
        previously_processed = total_existing_files
        print(f"Previously processed count set to {previously_processed} (actual files on disk)")
    
    
    # Adjust batch counting based on existing files / persisted progress
    # The 'total' now only contains NEW files to process (Fast Pass filtered out existing ones)
    files_to_complete_batch = 0
    start_batch = 0
    
    # PRIORITY 1: Use persisted batch progress if available
    # This ensures that if we marked "Batch 3" as complete, we don't try to backfill it
    # even if it has < 500 files (due to duplicates/skips)
    if persisted_start_batch > 0:
        start_batch = persisted_start_batch
        print(f"Resuming from persisted state: Starting at Batch_{start_batch + 1:02d}")

        # CRITICAL: Even with persisted state, check if the current batch is incomplete
        # This handles the case where processing was paused mid-batch
        # Use the actual file count from last_incomplete_batch detection above
        if last_incomplete_batch and files_in_incomplete_batch > 0:
            # Extract batch number from folder name (e.g., "Batch_02" -> 1)
            incomplete_batch_num = int(last_incomplete_batch.split('_')[1]) - 1

            # If the incomplete batch matches where we're resuming
            if incomplete_batch_num == start_batch:
                files_to_complete_batch = batch_size - files_in_incomplete_batch
                print(f"Detected incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will add {files_to_complete_batch} files to complete it.")
            else:
                print(f"Current batch is complete or we're starting a new batch.")
        else:
            print(f"Current batch is complete or we're starting a new batch.")
    
    # PRIORITY 2: Heuristic based on file counts (fallback if no persistence)
    elif total_existing_files > 0:
        # Use the actual incomplete batch detection from above
        if last_incomplete_batch and files_in_incomplete_batch > 0:
            # Extract batch number from folder name (e.g., "Batch_02" -> 1)
            incomplete_batch_num = int(last_incomplete_batch.split('_')[1]) - 1
            files_to_complete_batch = batch_size - files_in_incomplete_batch
            start_batch = incomplete_batch_num  # Continue with the incomplete batch
            print(f"No persisted state found. Detected incomplete {last_incomplete_batch} with {files_in_incomplete_batch} files. Will add {files_to_complete_batch} files to complete it.")
        else:
            # All batches are complete, start a new one
            # Count how many complete batch folders exist
            num_complete_batches = len(batch_folders) if 'batch_folders' in locals() else 0
            start_batch = num_complete_batches
            print(f"No persisted state found. All existing batches valid. Starting at Batch_{start_batch + 1:02d}")
    
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
        batch_dir = os.path.join(OUTPUT_DIR, batch_name)
        os.makedirs(batch_dir, exist_ok=True)

        # Set CURRENT_BATCH_DIR so all files are written directly to this batch folder
        global CURRENT_BATCH_DIR
        CURRENT_BATCH_DIR = batch_dir

        print(f"\n--- Processing {batch_name} ({len(batch_memories)} files) ---", flush=True)
        
        # Check space once per batch to reduce per-file overhead
        check_space_and_wait(os.path.dirname(OUTPUT_DIR))
        
        # Check output directory is still available (detect ejected drives)
        try:
            check_output_directory_available()
        except RuntimeError as e:
            print(f"❌ {e}", flush=True)
            raise
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            # Process this batch
            future_to_mem = {executor.submit(process_memory, m, start_idx + i, progress_callback, zip_file, zip_lock): orig_idx for i, (orig_idx, m) in enumerate(batch_memories)}
            
            batch_count = 0
            pause_detected = False
            processed_orig_indices = []  # Track which indices actually completed
            
            for future in concurrent.futures.as_completed(future_to_mem):
                # Check for hard abort (disk ejection, critical error)
                if ABORT_PROCESSING.is_set():
                    executor.shutdown(wait=False, cancel_futures=True)
                    break
                
                # Check for graceful pause - let this future's result be collected, but stop after
                if PAUSE_REQUESTED.is_set() and not pause_detected:
                    pause_detected = True
                    in_flight_count = len([f for f in future_to_mem if not f.done()])
                    print(f"\n⚠️  Pause requested. Waiting for {in_flight_count} in-flight files to complete...", flush=True)
                    # DON'T cancel or shutdown - let remaining submitted futures complete
                    
                res = future.result()
                results.append(res)
                batch_count += 1
                
                # Track which original index completed successfully
                orig_idx = future_to_mem[future]
                if res.get('status') != 'Error':
                    processed_orig_indices.append(orig_idx)
                
                # DISABLED: Don't send progress during batch (memory entry count)
                # Progress is now sent AFTER batch completes with actual file count
                # global_count = start_idx + batch_count
                # if progress_callback:
                #     try:
                #         progress_callback((global_count, total))
                #     except (OSError, IOError): pass
                
                if batch_count % 100 == 0:
                    print(f"  {batch_name}: {batch_count}/{len(batch_memories)}...")
                    
                    # Check if output directory still exists (mid-batch ejection detection)
                    try:
                        check_output_directory_available()
                    except RuntimeError as e:
                        print(f"❌ {e}", flush=True)
                        executor.shutdown(wait=False, cancel_futures=True)
                        raise
            
            # If pause was requested, handle graceful cleanup after all in-flight completed
            if pause_detected or PAUSE_REQUESTED.is_set():
                print(f"   All in-flight files completed. {batch_count} files processed in this partial batch.", flush=True)
                
                # Update manifest with ONLY the indices that actually completed
                processed_indices_set.update(processed_orig_indices)
                
                # Count files in batch folder
                files_in_batch = len([f for f in os.listdir(batch_dir)
                                     if os.path.isfile(os.path.join(batch_dir, f)) and not f.startswith('.')])
                total_files_organized += files_in_batch
                
                # Save manifest with accurate count
                save_batch_progress(
                    batch_num,
                    num_batches,
                    total_files=manifest_total_files,
                    processed_indices=processed_indices_set,
                    zip_fingerprint=zip_fingerprint,
                    output_dir=OUTPUT_DIR,
                    icloud_mode=pause_batches,
                    actual_file_count=total_files_organized
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
                sys.exit(0)
        
        # Mark these indices as processed for manifest tracking (full batch completed)
        if batch_memories:
            processed_indices_set.update(orig_idx for orig_idx, _ in batch_memories)

        # Count files in batch folder (files are already written directly to batch_dir)
        files_in_batch = len([f for f in os.listdir(batch_dir)
                             if os.path.isfile(os.path.join(batch_dir, f)) and not f.startswith('.')])

        print(f"  {batch_name} complete: {files_in_batch} files processed.", flush=True)

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
            actual_file_count=total_files_organized  # Pass actual file count (includes duplicates)
        )
        
        # === PAUSE FOR CLOUD SYNC ===
        # If pause_batches is True and this is NOT the last batch, pause and wait for resume
        if pause_batches and batch_num < num_batches - 1 and not ABORT_PROCESSING.is_set():
            # Create a signal file path for resume trigger - use PARENT dir (matches main.js)
            resume_signal_file = os.path.join(os.path.dirname(OUTPUT_DIR), ".memsavr_resume_signal")
            
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
    
    # Count TOTAL files across all batch folders to get true success count
    # This includes files from previous runs
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

    # Load manifest to get accurate processed_count (source of truth for total across runs)
    manifest_processed_count = None
    manifest_path = os.path.join(OUTPUT_DIR, '.batch_progress.json')
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, 'r') as f:
                manifest_data = json.load(f)
                manifest_processed_count = manifest_data.get('processed_count')
        except Exception as e:
            print(f"Warning: Could not read manifest processed_count: {e}", flush=True)

    # Count actual files on disk for verification
    actual_files_on_disk = 0
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
        "report_success_count": current_run_success  # Number of success entries in report
    }

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
    total_processed = success_count + duplicate_count + missing_count + skipped_count + error_count

    print(f"   Total memories from export: {manifest_total_files}", flush=True)
    print(f"   Total accounted for: {len(results)} (Success={success_count}, Duplicates={duplicate_count}, Errors={error_count})", flush=True)

    # Check for timestamp collisions (same filename from different memories)
    if report_success_entries > success_count:
        collisions = report_success_entries - success_count
        print(f"   Note: {collisions} memories share identical timestamps (created at exact same second)", flush=True)
        print(f"         The later file overwrote the earlier one. Both are in the report.", flush=True)

    if len(results) == manifest_total_files:
        print(f"   ✅ All {manifest_total_files} memories accounted for!", flush=True)
    else:
        diff = manifest_total_files - len(results)
        if diff > 0:
            print(f"   ⚠️  {diff} memories missing from report (likely had no date in export)", flush=True)
        else:
            print(f"   ⚠️  Report has {-diff} more entries than expected", flush=True)
    
    return stats

def process_from_zip(zip_path, output_root=None, limit=None, progress_callback=None, pause_batches=False, trust_manifest=False):
    """
    Orchestrates the One-Click workflow:
    1. Open Zip (Stream mode)
    2. Find JSON in Zip
    3. Run processing with Zip context
    """
    if not output_root:
        output_root = os.path.dirname(os.path.abspath(zip_path))
        
    try:
        if progress_callback: progress_callback(0.05) # Fake small progress
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # 2. Find JSON
            json_path_in_zip = None
            for name in zf.namelist():
                if name.endswith('memories_history.json'):
                    json_path_in_zip = name
                    break
            
            if not json_path_in_zip:
                raise FileNotFoundError("Could not find 'memories_history.json' inside the ZIP.")
                
            print(f"Found JSON in ZIP at: {json_path_in_zip}", flush=True)
            
            # Read JSON directly from ZIP
            with zf.open(json_path_in_zip) as jf:
                json_content = json.load(jf)
            
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
            result = main(limit=limit, clear_output=False, progress_callback=progress_callback, zip_file=zf, json_data=json_content, pause_batches=pause_batches, trust_manifest=trust_manifest, zip_fingerprint=zip_fingerprint)
            
            result['processed_dir'] = processed_dir
            return result

    except Exception as e:
        print(f"Critical workflow error: {e}")
        raise e

def retry_failed_entries(failed_entries, output_root, progress_callback=None):
    """
    Retry processing only the failed entries from a previous run.
    Downloads from their stored URLs and saves to output folder.
    """
    results = []
    stats = {'success': 0, 'errors': 0, 'duplicates': 0, 'images': 0, 'videos': 0}
    
    # Find or create the processed dir
    processed_dirs = [d for d in os.listdir(output_root) if d.startswith('Processed_Memories')]
    if processed_dirs:
        processed_dir = os.path.join(output_root, sorted(processed_dirs)[-1])
    else:
        processed_dir = os.path.join(output_root, f"Processed_Memories_{datetime.now().strftime('%Y-%m-%d')}")
    
    os.makedirs(processed_dir, exist_ok=True)
    
    total = len(failed_entries)
    print(f"Retrying {total} failed entries...", flush=True)
    
    for idx, entry in enumerate(failed_entries):
        if ABORT_PROCESSING.is_set():
            break
            
        # Report progress
        if progress_callback:
            progress_callback((idx + 1, total))
        
        try:
            # Get data from the detailed report
            download_url = entry.get('download_url')
            date_str = entry.get('date')
            media_type = entry.get('media_type', 'Image')
            original_file = entry.get('file', f"memory_{idx}")
            
            if not download_url:
                print(f"  ⚠️ No download URL for {original_file} - Cannot retry", flush=True)
                stats['errors'] += 1
                results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'No download URL in report'})
                continue
            
            if not date_str:
                print(f"  ⚠️ No date for {original_file} - Using current time", flush=True)
                date_str = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
            
            print(f"  [{idx+1}/{total}] Retrying {original_file}...", flush=True)
            
            # Parse timestamp
            try:
                dt = datetime.strptime(date_str, '%Y-%m-%d %H:%M:%S UTC')
                timestamp_name = dt.strftime('%Y-%m-%d_%H-%M-%S')
            except ValueError:
                # Try to use as-is or generate new
                timestamp_name = date_str.replace(':', '-').replace(' ', '_')
            
            # SECURITY: Validate download URL before attempting download
            if not is_allowed_download_url(download_url):
                print(f"  ❌ Blocked: Invalid download URL (not from Snapchat CDN)", flush=True)
                stats['errors'] += 1
                results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'Blocked: Invalid download URL'})
                continue
            
            # Download the file with size limit
            try:
                response = requests.get(download_url, timeout=60, stream=True)
                if response.status_code == 403 or response.status_code == 410:
                    print(f"  ❌ Download link expired (HTTP {response.status_code})", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': 'Download link expired'})
                    continue
                elif response.status_code != 200:
                    print(f"  ❌ Download failed: HTTP {response.status_code}", flush=True)
                    stats['errors'] += 1
                    results.append({**entry, 'retry_status': 'Error', 'retry_reason': f'HTTP {response.status_code}'})
                    continue
                
                # SECURITY: Track download size to prevent disk exhaustion
                file_content = b""
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file_content += chunk
                        if len(file_content) > MAX_DOWNLOAD_BYTES:
                            raise ValueError(f"Download exceeded max size limit: {MAX_DOWNLOAD_BYTES / (1024**3):.2f}GB")
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
            
            # Determine file extension
            if media_type == 'Video':
                ext = '.mp4'
                stats['videos'] += 1
            else:
                ext = '.jpg'
                stats['images'] += 1
            
            # Detect batch folders (Cloud Mode support)
            batch_folders = sorted([d for d in os.listdir(processed_dir) 
                                  if d.startswith('Batch_') and os.path.isdir(os.path.join(processed_dir, d))])
            
            # Determine output directory (batch folder or root)
            if batch_folders:
                # Cloud Mode: assign to appropriate batch folder
                # Find the last batch and check if it's full
                last_batch = batch_folders[-1]
                last_batch_dir = os.path.join(processed_dir, last_batch)
                files_in_last_batch = len([f for f in os.listdir(last_batch_dir) 
                                          if os.path.isfile(os.path.join(last_batch_dir, f))])
                
                if files_in_last_batch >= 500:
                    # Last batch is full, create new batch
                    batch_num = int(last_batch.split('_')[1])
                    new_batch_name = f"Batch_{batch_num + 1:02d}"
                    output_dir = os.path.join(processed_dir, new_batch_name)
                    os.makedirs(output_dir, exist_ok=True)
                    print(f"  📁 Assigning to new {new_batch_name}", flush=True)
                else:
                    # Use existing incomplete batch
                    output_dir = last_batch_dir
                    print(f"  📁 Assigning to {last_batch} ({files_in_last_batch}/500 files)", flush=True)
            else:
                # No batch folders: regular mode, save to root
                output_dir = processed_dir
            
            # Generate output filename
            base_name = f"{timestamp_name}{ext}"
            output_path = os.path.join(output_dir, base_name)
            
            # Handle duplicates
            counter = 1
            while os.path.exists(output_path):
                base_name = f"{timestamp_name}_{counter}{ext}"
                output_path = os.path.join(output_dir, base_name)
                counter += 1
            
            # Write the file
            with open(output_path, 'wb') as f:
                f.write(file_content)
            
            print(f"  ✅ Saved: {base_name}", flush=True)
            stats['success'] += 1
            results.append({**entry, 'retry_status': 'Success', 'output_file': base_name})
            
        except Exception as e:
            print(f"  ❌ Error: {e}", flush=True)
            stats['errors'] += 1
            results.append({**entry, 'retry_status': 'Error', 'retry_reason': str(e)})
    
    # Update the report with retry results
    report_path = os.path.join(output_root, 'detailed_report.json')
    try:
        with open(report_path, 'r') as f:
            full_report = json.load(f)
        
        # Update entries that were retried
        for result in results:
            if result.get('retry_status') == 'Success':
                # Find and update the matching entry
                result_id = result.get('id')
                for i, existing in enumerate(full_report):
                    if existing.get('id') == result_id:
                        full_report[i]['status'] = 'Success'
                        full_report[i]['file'] = result.get('output_file')
                        full_report[i]['retry_status'] = 'Success'
                        break
        
        with open(report_path, 'w') as f:
            json.dump(full_report, f, indent=2)
        print(f"Updated {report_path}", flush=True)
    except Exception as e:
        print(f"Could not update report: {e}", flush=True)
    
    print(f"\\nRetry Summary: {stats['success']} succeeded, {stats['errors']} failed", flush=True)
    return stats

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Process Snapchat Memories')
    parser.add_argument('--zip', required=True, help='Path to the Snapchat data ZIP file')
    parser.add_argument('--output', required=True, help='Output directory for processed memories')
    parser.add_argument('--pause-batches', action='store_true', help='Pause between batches for iCloud sync')
    parser.add_argument('--trust-manifest', action='store_true', help='Trust manifest file for resume')
    
    args = parser.parse_args()

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
            trust_manifest=args.trust_manifest
        )

        # Send completion message to Electron
        if result:
            completion_msg = json.dumps({"type": "complete", "stats": result})
            print(completion_msg, flush=True)
            sys.stdout.flush()

    except Exception as e:
        print(f"Error: {e}", flush=True)
        sys.exit(1)
