import os


def parse_batch_folder_number(batch_folder):
    """Convert a Batch_XX folder name into a zero-based batch index."""
    if not isinstance(batch_folder, str) or not batch_folder.startswith('Batch_'):
        return None
    try:
        return int(batch_folder.split('_', 1)[1]) - 1
    except (IndexError, ValueError):
        return None


def compute_last_completed_batch(batch_num, batch_completed=True):
    """
    Persisted semantics:
    - completed batch: the active batch is fully finalized
    - partial batch: the last completed batch is the previous one
    """
    return batch_num if batch_completed else batch_num - 1


def scan_existing_batch_root(batch_root, batch_size):
    """
    Inspect an output/staging root for existing Batch_* folders.

    The highest existing batch number is authoritative for numbering
    continuity. A batch with fewer than batch_size files is only treated as
    resumable if later logic confirms it is the active current batch.
    """
    scan_result = {
        "orphaned_root_files": 0,
        "existing_batch_files": 0,
        "last_incomplete_batch": None,
        "files_in_incomplete_batch": 0,
        "batch_folders": [],
        "highest_existing_batch_num": None,
        "next_available_batch": 0,
    }

    if not batch_root:
        return scan_result

    try:
        root_entries = os.listdir(batch_root)
    except OSError:
        return scan_result

    scan_result["orphaned_root_files"] = len([
        name for name in root_entries
        if os.path.isfile(os.path.join(batch_root, name)) and not name.startswith('.')
    ])

    batch_folders = sorted(
        [
            name for name in root_entries
            if name.startswith('Batch_') and os.path.isdir(os.path.join(batch_root, name))
        ],
        key=lambda name: (
            parse_batch_folder_number(name) is None,
            parse_batch_folder_number(name) if parse_batch_folder_number(name) is not None else name
        )
    )
    scan_result["batch_folders"] = batch_folders

    for batch_folder in batch_folders:
        batch_num = parse_batch_folder_number(batch_folder)
        if batch_num is not None:
            current_highest = scan_result["highest_existing_batch_num"]
            if current_highest is None or batch_num > current_highest:
                scan_result["highest_existing_batch_num"] = batch_num

        batch_path = os.path.join(batch_root, batch_folder)
        files_in_batch = len([
            name for name in os.listdir(batch_path)
            if os.path.isfile(os.path.join(batch_path, name)) and not name.startswith('.')
        ])
        scan_result["existing_batch_files"] += files_in_batch

        if files_in_batch < batch_size:
            scan_result["last_incomplete_batch"] = batch_folder
            scan_result["files_in_incomplete_batch"] = files_in_batch

    if scan_result["highest_existing_batch_num"] is not None:
        scan_result["next_available_batch"] = scan_result["highest_existing_batch_num"] + 1

    return scan_result


def resolve_resume_batch_state(
    *,
    auto_upload,
    persisted_start_batch,
    total_existing_files,
    last_incomplete_batch,
    files_in_incomplete_batch,
    batch_size,
    next_available_batch,
):
    """
    Determine where a resumed run should continue.

    Completed underfilled batches are allowed and should not be backfilled just
    because they contain fewer than batch_size files. Only the currently active
    incomplete batch should be resumed.
    """
    normalized_start_batch = persisted_start_batch if isinstance(persisted_start_batch, int) else 0
    normalized_next_available_batch = next_available_batch if isinstance(next_available_batch, int) and next_available_batch >= 0 else 0
    incomplete_batch_num = parse_batch_folder_number(last_incomplete_batch)
    has_incomplete_batch = incomplete_batch_num is not None and files_in_incomplete_batch > 0
    files_needed_to_complete = 0
    if has_incomplete_batch:
        files_needed_to_complete = max(0, batch_size - files_in_incomplete_batch)

    if normalized_start_batch > 0:
        resume_incomplete_batch = has_incomplete_batch and incomplete_batch_num == normalized_start_batch
        return {
            "start_batch": incomplete_batch_num if resume_incomplete_batch else max(normalized_start_batch, normalized_next_available_batch),
            "files_to_complete_batch": files_needed_to_complete if resume_incomplete_batch else 0,
            "incomplete_batch_num": incomplete_batch_num,
            "resume_incomplete_batch": resume_incomplete_batch,
        }

    if total_existing_files > 0 or normalized_next_available_batch > 0:
        if has_incomplete_batch:
            return {
                "start_batch": incomplete_batch_num,
                "files_to_complete_batch": files_needed_to_complete,
                "incomplete_batch_num": incomplete_batch_num,
                "resume_incomplete_batch": True,
            }

        return {
            "start_batch": max(0, normalized_next_available_batch),
            "files_to_complete_batch": 0,
            "incomplete_batch_num": None,
            "resume_incomplete_batch": False,
        }

    return {
        "start_batch": 0,
        "files_to_complete_batch": 0,
        "incomplete_batch_num": incomplete_batch_num,
        "resume_incomplete_batch": False,
    }
