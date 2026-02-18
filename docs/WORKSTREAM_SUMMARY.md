# DateBack Workstream Summary

_Last updated: 2026-02-17_

This document summarizes the major implementation work completed in this iteration across Electron (`main.js` / `preload.js` / `renderer.js`) and Python (`python/cli.py`, `python/process_snapchat_memories.py`).

## 1) Core Architecture Confirmed
- Desktop app: Electron UI + Python worker (`memory-organizer`) subprocess.
- Renderer sends settings via IPC to main process.
- Main process validates paths/options, then spawns Python with CLI flags.
- Python handles ZIP reading, processing, metadata, output writes, resume/progress, and (in cloud mode) upload pipeline.

## 2) Auto Upload Mode Introduced and Hardened

### What was added
- New cloud pipeline behavior: **Process -> Stage -> Upload -> Delete staged**.
- Bounded staging cache with backpressure controls.
- Destination adapter abstraction for sync-folder workflows (Dropbox/Drive/OneDrive/iCloud folder semantics).
- Upload ledger for restart/recovery visibility.
- Cloud delivery counters added to final completion stats.

### Key flags wired end-to-end
- `--auto-upload`
- `--destination-dir`
- `--cache-gb`
- `--cache-low-gb`
- `--upload-mode` (UI constrained to safe copy behavior)
- `--staging-dir`
- `--max-upload-retries`

### Cloud defaults
- If custom staging is not provided: staging defaults to `<working output root>/.staging`.

## 3) Resume/Pause Reliability
- Fixed resume signal mismatch by standardizing around `.dateback_resume_signal`.
- Preserved manual pause-batch behavior (legacy/manual mode) while adding cloud auto mode.
- Retained batch progress persistence (`.batch_progress.json`) and resume semantics.

## 4) Retry Corrupted Files: Cloud Path Fixed
- Retry-corrupted flow now passes cloud arguments through main -> Python.
- Retry path uses uploader pipeline in cloud mode so retried outputs are transferred to destination, not stranded in staging.

## 5) Disk/Cache Preflight Improvements
- Added/used disk free-space IPC (`get-disk-free-bytes`) based on volume containing staging path.
- Preflight checks block starts when staging volume cannot satisfy required cache + safety buffer.
- Automatic cache mode implemented in UI flow (with manual override in Advanced).
- Existing non-cloud low-space checks retained for standard/local processing.

## 6) Success Modal and Cloud Delivery Accuracy
- Cloud completion stats now include delivery-related fields (normal + retry cloud flows), including confirmed destination/copy counters.
- Cloud success copy logic updated to avoid over-claiming and to distinguish cloud delivery outcomes.
- Cloud row labeling clarified (delivered/copied/already in destination style data semantics).

## 7) UI/UX Restructure (Major)

### Mode model and terminology
- Legacy cloud wording cleaned up and restructured into clearer mode choices.
- UI evolved to explicit user intent modes:
  - **Store Memories on Computer**
  - **Store Memories on Cloud**
- Mutual exclusivity enforced in renderer and guarded in main process (`MODE_CONFLICT` protection).

### Mode behavior in UI
- Computer mode can enable pause-after-batch sub-option.
- Cloud mode reveals destination/staging-related controls and preflight messaging.
- Start button gating now depends on required fields for selected mode.

### Layout and clarity updates
- Step labeling and helper copy polished.
- Advanced cloud controls moved/hidden to reduce clutter.
- Mode cards redesigned for stronger single-choice affordance.
- Destination guidance/tooltip improved and provider-aware copy added (Dropbox/Google Drive/OneDrive/iCloud; plus consistency updates including Box mention where UI copy expects it).

## 8) Reliability/Correctness Fixes
- Main `start-processing` handler updated so IPC request always settles (no hanging unresolved Promise paths from early validation exits).
- Atomic write strategy expanded for resume-critical progress files in Python.
- Verify-mode performance optimizations made without changing semantics:
  - consolidated directory scan reuse,
  - reduced repeated set/sort rebuild cost for manifest/progress write path,
  - timestamp parsing reuse.
- Added debug-timing instrumentation for verify/manifest work behind env flag.

## 9) Security Hardening Pass

### Main process + IPC
- Strict sender checks implemented:
  - require `event.sender === mainWindow.webContents`,
  - require main-frame sender,
  - compare normalized renderer document key.
- Added robust URL normalization for trusted renderer document key.
- Hardened to dev + packaged behavior (no hardcoded `__dirname/src/index.html` assumption).
- Rejected/blocked IPC logs include sender/main URLs with redaction for non-debug logs.

### Protocol trust hardening
- Trusted renderer protocol allowlist tightened to active app protocols (`file:`, `app:`).
- Non-renderer protocols (e.g., `about:`, `devtools:`, `chrome:`) do not produce trusted document keys.
- `will-navigate` remains deny-by-default except trusted renderer document, with debug reason logging.

### Filesystem safety
- Canonical path/writability checks for output/destination/staging roots.
- Relationship checks to prevent recursive/unsafe root nesting.
- Symlink-root rejection for sensitive write paths.
- Safe-delete constraints for staged file deletion.

### ZIP safety
- No broad `extractall` style behavior.
- ZIP member handling constrained with path safety and caps; lock scope reduced to reading while downstream processing runs unlocked.

## 10) Performance Improvements
- Reduced ZIP lock contention by minimizing lock-hold scope around member byte reads.
- Preserved output correctness and security constraints while improving parallel throughput.

## 11) Current Mode Semantics (As Implemented)

### Store on Computer
- `autoUpload=false`
- Outputs written under working/output root batch structure.
- Optional pause-after-batch toggle controls manual pausing behavior.

### Store on Cloud
- `autoUpload=true`
- Processed outputs staged under staging root (default `.staging` under output root unless custom staging provided).
- Uploader copies/verifies into selected destination folder.
- Staged files are removed after successful transfer verification.

## 12) Validation/Checks Routinely Used
- `node --check main.js`
- `node --check src/renderer.js`
- `python3 -m py_compile python/process_snapchat_memories.py python/cli.py`

## 13) Notes
- This summary is intentionally implementation-focused and groups many iterative UI/wording refinements into major themes.
- Core processing semantics (resume/trust/verify/start-fresh intent) were kept stable unless explicitly noted above.
