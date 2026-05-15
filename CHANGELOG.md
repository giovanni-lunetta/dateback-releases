# Changelog

All notable changes to this project will be documented in this file.

## [1.5.1] - 2026-05-15
### Security
- ZIP path is now authorized against the file-picker approval set before being passed to the subprocess — paths outside the user's home directory must be explicitly chosen with the picker
- `requireApprovedWritableDirectory`: destination and staging directories are checked against the approval set before being created, preventing unapproved directory creation
- Batch output directories (`Batch_01`, etc.) are now created without following symlink entries; existing symlinked Batch_ directories are rejected at scan time, creation time, and retry time
- ZIP central-directory metadata is validated before indexing: 250 000-member cap, 5 TB declared-size cap, and symlink-member blocking
- Duplicate ZIP member paths across multi-part exports are detected and rejected at index time
- Windows drive roots (`C:\`) and network share roots (`\\server\share`) are now explicitly blocked as output directories
- URL query strings and common secret assignments (`token=`, `sig=`, etc.) are redacted from human-readable error reports

### Fixed
- Overlay merge failure now saves the main image instead of writing an error record — users get the photo even when the overlay cannot be composited
- Manifest index replay is bounded by the actual number of memories in the export, preventing runaway expansion from malformed manifests
- Approved-directory Sets are cleared and correctly repopulated (using canonical paths) at the start of each new run — fixes cloud-mode runs breaking after the first launch of a session
- Logger `redactPath` now strips `/var/folders` and `/Volumes` paths from log output
- Logger `flush()` performs a second drain to capture entries enqueued during the first drain pass
- Python `set_config` validates against sensitive roots before calling `canonical_dir`/`makedirs`
- `getLastTimestamp` in support-logs rewritten with async `fs.promises` (removes sync I/O from thread executor)
- `btnFindZip` handler guards against re-entry while a scan is already running
- Warning modals resolve any prior pending call before opening a new one

### Changed
- Mac release artifacts now include arm64 and x64 DMG + ZIP targets in a single build pass
- Windows GitHub Actions workflow installs Python dependencies from `python/requirements.txt` instead of pinned inline versions
- Success modal elements use stable IDs; approximately 400 lines of dead renderer helper-fallback code removed
- Named constants extracted to `src/constants.js` for cloud defaults and ZIP entry limit

## [1.5.0] - 2026-05-14
### Added
- Windows 10 / 11 (x64) support: NSIS installer, bundled FFmpeg 8.1.1 and memory-organizer.exe for Windows x64
- Intel Mac (x86_64) support: dedicated x64 DMG with bundled x86_64 FFmpeg and memory-organizer binaries
- Sleep prevention on Windows via PowerShell `SetThreadExecutionState` to keep processing alive without screen lock

## [1.4.4] - 2026-05-13
### Fixed
- Bundled Python binary recompiled to include companion ZIP scanning — QA and production builds now find multi-part Snapchat exports (e.g. `mydata~XXXX-2.zip`) that the stale binary was missing
- ZIP file clear button is now disabled during active processing to prevent accidental deselection mid-run

## [1.4.3] - 2026-05-12
### Fixed
- Processing now shows the success modal correctly when some memories are missing (previously exited with code 1 due to `SystemExit` being caught by the broad `BaseException` handler)
- ZIP-not-found error now shows a targeted message asking users to re-select their Snapchat export ZIP, rather than incorrectly blaming the output folder
- "Buy Me a Coffee" button in the success modal no longer overlaps the Next Steps button

## [1.4.2] - 2026-05-12
### Fixed
- Production builds now include macOS folder permission usage descriptions for automatic ZIP discovery in Downloads, Documents, and Desktop
- QA build metadata now mirrors production folder permission descriptions
- Public website license dependency table now matches the app production dependency tree
- Bundled helper binaries now live under an explicit `assets/bin/mac-arm64/` source path for production and QA packaging
- ZIP validation and disk-space IPC now reject unapproved paths outside the user's home folder unless selected through the picker
- Python worker events now include a schema version, large resume manifests use compact processed-index ranges, and ZIP magic-byte checks refuse symlinks
- Electron and dotenv dev tooling were updated to current major versions

## [1.4.1] - 2026-05-09
### Fixed
- Production readiness notices now match the current packaged dependency tree
- GPL written-offer language is present in both bundled license documents
- Build scripts disable hard-link packaging, and bundled helper binaries are signed before app packaging
- Python HEAD retry handling now honors bounded `Retry-After` responses
- Public website social metadata and sitemap priority order corrected
- Regression coverage added for release notices, social metadata, retry handling, and bare exception handlers

## [1.4.0] - 2026-05-06
### Added
- Multi-ZIP Snapchat export processing for companion archives such as `mydata~1234-2.zip` and `mydata~1234-3.zip`
- Recovery for newer top-level `*-main` / `*-overlay` media pairs

### Fixed
- Companion ZIP resume checks now use ZIP-set fingerprints
- Multi-ZIP organize operations reject destination escapes and filename collisions
- Retry-search, overlay, and threaded companion routing edge cases corrected
- Website release copy, changelog, privacy posture, CSP, and release tests aligned with the free/no-tracking model

## [1.3.1] - 2026-05-05
### Fixed
- Snapchat ZIP exports with blank download URL fields now extract matching local `memories/` media files instead of silently skipping them
- Root-level `json/memories_history.json` exports are supported
- Rows with neither local media nor download URL are reported as missing

## [1.3.0] - 2026-05-05
### Changed
- DateBack is now a free Mac download with no purchase, account, activation key, or Polar validation required
- Removed license activation IPC, renderer UI, local license storage, and payment-flow dependencies
- Website download flow now points to GitHub Releases, with optional Buy Me A Coffee support
- Package and legal metadata updated for the proprietary free-to-use distribution model

## [1.2.1] - 2026-04-18
### Added
- Disk-full runtime error handling with clear messages for download, staging, and destination write failures
- Mode-aware Next Steps modal copy for Cloud Mode and Computer Mode

### Changed
- Advanced Cloud Settings panel redesigned with clearer optional controls and inline help

## [1.2.0] - 2026-03-19
### Added
- Organizer worker state tracking via persistent state file — enables reliable cleanup and prevents orphaned processes on quit or restart
- Cloud resume now considers both staged batches and already-delivered `Batch_*` folders in the synced destination; batch numbering continues correctly instead of restarting at `Batch_01`
- IPC lifecycle guards and security checks around process cleanup events

### Fixed
- Cloud resume could incorrectly restart at `Batch_01` when completed batches had already been delivered to the destination folder

### Changed
- Cloud mode tooltip and helper text updated to accurately describe `Batch_*` folder delivery
- `onLogsExported` IPC pattern simplified

## [1.1.4] - 2026-03-12
### Changed
- Improved layout, visual hierarchy, and overall flow of the main interface
- No changes to business logic, IPC, or main process behavior

## [1.1.3] - 2026-03-11
### Fixed
- Replaced directory-glob `extraResources` with explicit per-file mappings for `memory-organizer` and `ffmpeg` — eliminates silent binary drop in QA config override builds
- Corrected Polar sandbox API host from `sandbox.polar.sh` to `sandbox-api.polar.sh` (QA/internal only; no production impact)

## [1.1.2] - 2026-02-21
### Added
- Polar sandbox validation mode for internal QA, double-guarded by `DATEBACK_POLAR_ENV=sandbox` AND `DATEBACK_ALLOW_SANDBOX=1`
- Three new tests for Polar endpoint config (production default, sandbox guard, sandbox enabled)

## [1.1.1] - 2026-02-20
### Fixed
- Packaged app startup crash when `.env` file is absent — dotenv loading now guarded to development only
- Removed last remaining `MemSavr` references from Python CLI module docstring and argparse description

## [1.1.0] - 2026-02-18
### Added
- Cloud Mode: fully automated staging → delivery pipeline for synced cloud folders (iCloud, Dropbox, Google Drive, etc.)
- Cache threshold management: processing pauses when staging cache reaches limit and resumes when it drops below threshold
- Cloud-specific success modal copy with delivery stats (uploaded count, upload errors)
- Cloud storage warning when local disk is low during a cloud run
- Security: renderer document trust verification — IPC calls rejected if renderer document is not trusted

## [1.0.9] - 2026-02-13
### Changed
- **Major Rebrand:** Application renamed from "MemSavr" to "DateBack"
- **Domain:** Migrated to dateback.app
- **Logos:** Updated app icon and UI logos
- **Legal:** Updated Terms of Service and Privacy Policy for GPL compliance
- **Email:** Updated support contact to support@dateback.app

## [1.0.8] - 2026-01-30
### Security
- Fixed critical security vulnerabilities in dependencies
- Updated electron to v39.2.7

## [1.0.7] - 2026-01-15
### Fixed
- Fixed memory leak in photo processing pipeline
