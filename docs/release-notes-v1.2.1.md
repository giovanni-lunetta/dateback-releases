# DateBack v1.2.1 - Disk-Full Error Handling and Cloud Settings UX

**Release Date:** April 18, 2026
**Download:** [DateBack-1.2.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.2.1/DateBack-1.2.1-arm64.dmg)

---

## What's New

### Disk-Full Error Handling

DateBack now detects when the working drive runs out of space during processing and surfaces a clear, actionable message instead of silently failing. The error distinguishes between three scenarios — running out of space while downloading, while staging for cloud delivery, or while writing to the destination — and reports each with specific copy. Processing stops cleanly without leaving corrupted output.

### Mode-Aware Next Steps Modal

The Next Steps modal shown after a successful run is now tailored to your mode. Cloud mode users see a "Cloud Delivery Finished" section with guidance on confirming their synced folder and cleaning up local staging space. Computer mode users see the existing local-storage and manual-upload sections unchanged.

### Advanced Cloud Settings Redesign

The Advanced Cloud Settings panel (previously "Advanced Cloud Options") has been redesigned for clarity:
- New summary layout with an "Optional" badge makes it clear most users can skip this section
- Each setting has its own inline help button
- Staging Folder setting is visually de-emphasized as the least-commonly-needed option

---

## Migration Notes

No action required. All existing license keys remain valid. No changes to output folder structure or manifest format.

---

## Download

### macOS (Apple Silicon)
[DateBack-1.2.1-arm64.dmg](https://github.com/giovanni-lunetta/dateback-releases/releases/download/v1.2.1/DateBack-1.2.1-arm64.dmg)

**SHA256:**
```
fe9dcddee4309699d02b6fc4f896175dfa35af8974be629feb82c04f57d94763
```

### System Requirements
- macOS 11.0 (Big Sur) or later
- Apple Silicon (M1/M2/M3/M4) Mac
- 200 MB free disk space

---

## Technical Details

### Key Commits
| Commit | Description |
|--------|-------------|
| `add68ce` | Fix: runtime disk-full error handling with structured events and user-facing messages |
| `61752be` | UX: redesign Advanced Cloud Settings panel and make Next Steps modal mode-aware |
| `e6b6a1d` | Release: v1.2.1 |

### Changed Files
- `main.js` — disk-full event routing from Python subprocess
- `python/process_snapchat_memories.py` — RuntimeDiskFullError, emit_runtime_disk_full(), is_disk_full_error()
- `python/cli.py` — RuntimeDiskFullError catch and structured JSON output
- `src/index.html` — Advanced Cloud Settings panel redesign, mode-aware Next Steps modal sections
- `src/renderer.helpers.js` — buildNextStepsGuideState() for mode-aware Next Steps copy
- `src/styles.css` — Advanced Cloud Settings panel styles
- `test/main.ipc.characterization.test.js` — expanded IPC characterization tests
- `test/python_process_snapchat_memories_runtime_test.py` — disk-full scenario tests
- `test/renderer.helpers.test.js` — buildNextStepsGuideState tests
- `test/renderer.progressUpdate.characterization.test.js` — disk-full progress update tests
- `test/renderer.successModal.characterization.test.js` — success modal characterization tests
- `package.json` — version 1.2.1
- `package-lock.json` — version 1.2.1

---

## Documentation

- **Website:** [dateback.app](https://dateback.app)
- **Support:** support@dateback.app

---

**Previous Version:** [v1.2.0](https://github.com/giovanni-lunetta/dateback-releases/releases/tag/v1.2.0)
**All Releases:** [github.com/giovanni-lunetta/dateback-releases/releases](https://github.com/giovanni-lunetta/dateback-releases/releases)
