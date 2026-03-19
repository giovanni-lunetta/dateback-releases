# DateBack v1.2.0 - Organizer Worker Tracking and Cloud Resume Continuity

**Release Date:** March 19, 2026
**Download:** [DateBack-1.2.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.2.0/DateBack-1.2.0-arm64.dmg)

---

## What's New

### Organizer Worker State Tracking

The main process now tracks the organizer subprocess via a persistent worker state file. This enables reliable cleanup and prevents orphaned processes when the app quits or restarts mid-processing. Cleanup logic is verification-based — it only terminates a process if the tracked command matches a known DateBack organizer binary, preventing false-positive termination of unrelated processes.

### Cloud Resume Continuity

Cloud resume now considers both staged batches *and* already-delivered `Batch_*` folders in the synced destination folder. Batch numbering continues correctly after a resume rather than restarting at `Batch_01`. Previously, if completed batches had already been delivered to the cloud destination, a resume could reset to `Batch_01` — this is now fixed.

### IPC Hardening

Additional security checks and lifecycle guards around process cleanup events. The `onLogsExported` window event listener was removed in favor of direct IPC patterns.

### Frontend Copy

Cloud mode tooltip and helper text updated to accurately describe `Batch_*` folder delivery: "Finished files are copied into Batch folders inside this synced destination folder."

---

## Migration Notes

No action required. All existing license keys remain valid. No changes to output folder structure or manifest format.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.2.0-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.2.0/DateBack-1.2.0-arm64.dmg) (175 MB)

**SHA256:**
```
5816ebb5185dfe842d19d4d13fbc26a4b8b08fc23093639b5354558efb37cec8
```

### System Requirements
- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3) Mac
- 200 MB free disk space

---

## Technical Details

### Key Commits
| Commit | Description |
|--------|-------------|
| `e737a5d` | Docs: update agent charters and architecture doc for Batch_* folder semantics |
| `5c288d4` | Backend: organizer worker state tracking, cloud resume continuity, and IPC hardening |
| `a1fcd14` | Release: v1.2.0 |

### Changed Files
- `main.js` — organizer worker state tracking, IPC hardening, process lifecycle guards
- `python/process_snapchat_memories.py` — cloud resume batch continuity fix
- `python/batch_resume_logic.py` — batch resume semantic improvements
- `src/renderer.js` — cloud mode copy updates, logs export cleanup
- `test/main.ipc.characterization.test.js` — expanded IPC characterization tests
- `test/python_batch_resume_logic_test.py` — extended batch resume tests
- `test/python_process_snapchat_memories_runtime_test.py` — new runtime tests
- `package.json` — version 1.2.0; check script now includes preload.js and Python syntax check
- `package-lock.json` — version 1.2.0

---

## Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.1.4](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.1.4)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
